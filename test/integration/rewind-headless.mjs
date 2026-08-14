// dev/integration/rewind-headless.mjs — 组装式 headless 集成验证（不进发布包）。
//
// 真 cordis + 真 SessionStore + 真 CommandRuntime + 真存储 hub（json 后端）+
// 真 storage-domain + 真 user-questions（测试回答者 + 假 agents 注册表）+
// dsh-checkpoint-rewind。模拟 agent 两个轮次分别改两个文件 →
// /rewind 列表 → /rewind <id> 回退 → 断言文件内容与 fork 会话上下文。
//
// 用法：node dev/integration/rewind-headless.mjs（需先 npm install）。

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { Storage } from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as checkpointRewind from '../../index.mjs'

const log = (...parts) => console.log('[rewind-integration]', ...parts)

async function runGit(repo, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
  })
}

async function gitAvailable() {
  const probe = await runGit(process.cwd(), ['--version']).catch(() => undefined)
  return probe !== undefined
}

/**
 * 组装完整上下文并挂载插件。
 * @param {object} opts - {cwd, snapshotDir, config}。
 */
async function mount(opts) {
  const root = new Context()
  const fibers = []
  const mount = async (plugin, config) => {
    fibers.push(await root.plugin(plugin, config))
  }
  await mount(Storage)
  await mount(Object.assign({}, storageJson), { root: await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-storage-')) })
  await mount(Object.assign({}, storageDomain), { backend: 'json' })
  await mount(SessionStore)
  await mount(CommandRuntime)
  await mount(UserQuestionService)

  const session = root.sessions.create(SessionId('integration-session'), { meta: { cwd: opts.cwd } })
  const agent = { id: session.id, session }
  // 假 agents 注册表：真 user-questions 校验调用方是 live runtime root。
  root.provide('agents', { get: (id) => (id === agent.id ? agent : undefined), roots: () => [agent] })
  root.userQuestions.registerProvider({
    ask: async (request) => {
      log('  [user-questions] asked:', request.questions[0].question)
      return { answers: request.questions.map((question) => ({ id: question.id, selected: ['Restore'] })) }
    },
  })

  const config = {
    enabled: true,
    provider: 'copy',
    snapshotDir: opts.snapshotDir,
    maxSnapshots: 50,
    maxSnapshotBytes: 512 * 1024 * 1024,
    pruneOnTurnEnd: true,
    mutationTools: ['bash', 'write', 'edit', 'str_replace_editor', 'pwsh', 'terminal_send'],
    excludeGlobs: ['node_modules', '.git', 'dist', 'build'],
    confirmVia: 'auto',
    listLimit: 10,
    preRewindCheckpoint: 'warn',
    verifyByHash: false,
    ...opts.config,
  }
  const plugin = { name: checkpointRewind.name, inject: checkpointRewind.inject, apply: (ctx) => checkpointRewind.apply(ctx, config) }
  await mount(plugin)
  const dispose = async () => {
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
  return { root, session, agent, dispose }
}

/** 模拟一个"agent 修改文件"的轮次：开放步骤 → 变更意图 → 写文件 → 关闭。 */
async function agentMutates(root, agent, turn, step, file, content, tool = 'bash') {
  if (agent.session.events.at(-1)?.type !== 'turn/start') agent.session.append('turn/start', { turn })
  agent.session.append('step/start', { turn, step })
  const exec = { agent, name: tool, callId: `call-${turn}-${step}`, signal: new AbortController().signal, arguments: {} }
  await root.waterfall('fs/write-intent', { key: file }, exec, () => undefined)
  await root.waterfall('tools/pre-execute', exec, async () => 'allow')
  await fs.writeFile(file, content)
  agent.session.append('step/end', { turn, step })
  agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return agent.session.events.at(-1).seq
}

async function executeCommand(root, agent, line) {
  const execution = await root.commands.execute(agent, line, new AbortController().signal)
  assert.ok(execution, `command ${line} executed`)
  return execution.result
}

/** 主流程：copy provider（非 git 目录）。 */
async function mainCopyFlow() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-int-ws-'))
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-int-snap-'))
  const fileA = path.join(workspace, 'a.txt')
  const fileB = path.join(workspace, 'b.txt')
  await fs.writeFile(fileA, 'A-v1\n')
  await fs.writeFile(fileB, 'B-v1\n')

  const { root, session, agent, dispose } = await mount({ cwd: workspace, snapshotDir })
  log('copy flow: mounted; workspace', workspace)

  await agentMutates(root, agent, 1, 1, fileA, 'A-v2\n') // turn 1: 改 a.txt
  const forkSeq1 = session.events.at(-1).seq
  await agentMutates(root, agent, 2, 1, fileB, 'B-v2\n') // turn 2: 改 b.txt

  const list = await executeCommand(root, agent, '/rewind')
  assert.equal(list.kind, 'success')
  assert.match(list.text, /2 checkpoints/)
  assert.match(list.text, /trigger: fs\/write-intent/)
  log('  /rewind list:\n' + list.text.split('\n').map((line) => `    ${line}`).join('\n'))

  const firstId = /#([0-9a-f]{8})/.exec(list.text)?.[1]
  assert.ok(firstId, 'list carries short checkpoint ids (usable as addressing prefix)')
  const rewind = await executeCommand(root, agent, `/rewind ${firstId}`)
  assert.equal(rewind.kind, 'success', rewind.text)
  assert.match(rewind.text, /rewind guard: [0-9a-f-]{36}/, '结果携带可撤销本次回退的保护检查点')
  log('  /rewind result:', rewind.text)

  assert.equal(await fs.readFile(fileA, 'utf8'), 'A-v1\n', 'a.txt 恢复')
  assert.equal(await fs.readFile(fileB, 'utf8'), 'B-v1\n', 'b.txt 恢复')

  const childId = /session: (session-[\w-]+)/.exec(rewind.text)?.[1]
  assert.ok(childId, '结果携带新 sessionId')
  const child = root.sessions.get(childId)
  assert.ok(child, 'fork 子会话存活')
  assert.equal(child.header.parentSession, session.id)
  assert.equal(child.header.cwd, workspace)
  assert.equal(child.events.length, forkSeq1 + 3, '种子 = 边界前缀 + session/end-seed + 回退通知')
  assert.equal(child.events.at(-1).type, 'user/message', '子会话收到回退通知')
  assert.match(child.events.at(-1).data.content[0].text, /restored to checkpoint/)
  for (let seq = 0; seq <= forkSeq1; seq += 1) {
    assert.deepEqual(child.events[seq], session.events[seq], `child seed seq ${seq} 与源一致`)
  }
  log('  fork ok: child', childId, 'seedLength', child.events.length - 2, 'parent', child.header.parentSession)

  await dispose()
  log('copy flow: PASS')
}

/** 附流程：git provider（真实 git 仓库，auto 解析为 git）。 */
async function gitFlowIfAvailable() {
  if (!(await gitAvailable())) {
    log('git flow: SKIP (git unavailable in this environment)')
    return
  }
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-int-git-'))
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-int-snap-'))
  await runGit(workspace, ['init', '-q'])
  await runGit(workspace, ['config', 'user.email', 'integration@example.com'])
  await runGit(workspace, ['config', 'user.name', 'integration'])
  // 字节级断言：关闭换行转换，避免 Windows autocrlf 干扰内容比较。
  await runGit(workspace, ['config', 'core.autocrlf', 'false'])
  const fileA = path.join(workspace, 'a.txt')
  await fs.writeFile(fileA, 'A-v1\n')
  await runGit(workspace, ['add', '-A'])
  await runGit(workspace, ['commit', '-q', '-m', 'initial'])
  const headBefore = (await runGit(workspace, ['rev-parse', 'HEAD'])).stdout.trim()

  const { root, session, agent, dispose } = await mount({ cwd: workspace, snapshotDir, config: { provider: 'auto' } })
  log('git flow: mounted; workspace', workspace)

  await agentMutates(root, agent, 1, 1, fileA, 'A-v2\n')
  const list = await executeCommand(root, agent, '/rewind')
  assert.match(list.text, /\(git\)/, 'auto 解析为 git provider 并在列表标注')
  const firstId = /#([0-9a-f]{8})/.exec(list.text)?.[1]
  assert.ok(firstId)

  await fs.writeFile(fileA, 'A-v3\n')
  const rewind = await executeCommand(root, agent, `/rewind ${firstId}`)
  assert.equal(rewind.kind, 'success', rewind.text)
  const restored = (await fs.readFile(fileA, 'utf8')).replace(/\r\n/gu, '\n')
  // 检查点捕获的是变更前的状态（A-v1）；回退后文件回到该状态。
  assert.equal(restored, 'A-v1\n', 'git restore 回到快照（变更前）内容')
  const headAfter = (await runGit(workspace, ['rev-parse', 'HEAD'])).stdout.trim()
  assert.equal(headAfter, headBefore, 'HEAD 未被改写（无副作用原语）')
  const reflog = (await runGit(workspace, ['reflog', '--oneline', '-3'])).stdout
  assert.ok(!reflog.includes('reset'), '无 reset 记录')
  log('  git restore ok; HEAD intact:', headBefore.slice(0, 8))

  await dispose()
  log('git flow: PASS')
}

await mainCopyFlow()
await gitFlowIfAvailable()
log('integration: ALL PASS')
