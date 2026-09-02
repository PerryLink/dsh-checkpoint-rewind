// dev/integration/rewind-headless.mjs — 组装式 headless 集成验证（不进发布包）。
//
// 真 cordis + 真 SessionStore + 真 CommandRuntime + 真存储 hub（json 后端）+
// 真 storage-domain + 真 user-questions（测试回答者 + 假 agents 注册表）+
// dsh-checkpoint-rewind。模拟 agent 两个轮次分别改两个文件 →
// /rewind 列表 → /rewind <id> 回退 → 断言文件内容与 fork 会话上下文。
// 另有一个 v1 介质流程：预置 0.4.x 时代的 checkpoints.json（unit.version 1 +
// forkSeq 记录），断言真实 json 后端的版本校验下插件回退 v1 容错 spec——
// 旧记录可读、新捕获按 v2 形状写入同一介质、头部保持 v1。
//
// 用法：node test/integration/rewind-headless.mjs（需先 npm install）。

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
import { createScope } from '@deepseek-ai/dsh-scope'
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
 * @param {object} opts - {cwd, snapshotDir, config, storageRoot}。
 */
async function mount(opts) {
  const root = new Context()
  const fibers = []
  const mount = async (plugin, config) => {
    fibers.push(await root.plugin(plugin, config))
  }
  await mount(Storage)
  // storageRoot 可预置（v1 介质流程先写好 checkpoints.json 再挂载）；缺省临时目录。
  const storageRoot = opts.storageRoot ?? await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-storage-'))
  await mount(Object.assign({}, storageJson), { root: storageRoot })
  await mount(Object.assign({}, storageDomain), { backend: 'json' })
  await mount(SessionStore)
  await mount(CommandRuntime)
  await mount(UserQuestionService)

  const session = root.sessions.create(SessionId('integration-session'), { meta: { cwd: opts.cwd } })
  const agent = { id: session.id, session }
  // 假 agents 注册表：真 user-questions 校验调用方是 live runtime root。
  root.provide('agents', { get: (id) => (id === agent.id ? agent : undefined), roots: () => [agent] })
  const state = { asks: 0 }
  // 假 agents 注册表：真 user-questions 校验调用方是 live runtime root。
  // alpha 线的 user-questions 是 agent 作用域 waterfall 服务（registerProvider
  // 已删除）：在 agent 作用域上挂回答者，返回答案即认领请求。
  const scope = createScope(root, agent)
  scope.ctx.on('user-questions/request', async (request) => {
    state.asks += 1
    log('  [user-questions] asked:', request.questions[0].question)
    return { answers: request.questions.map((question) => ({ id: question.id, selected: ['Restore'] })) }
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
    await scope.dispose()
    for (const fiber of fibers.reverse()) await fiber.dispose()
  }
  return { root, session, agent, dispose, asks: () => state.asks }
}

/** 模拟一个"agent 修改文件"的轮次：开放步骤 → 变更意图 → 写文件 → 关闭。 */
async function agentMutates(root, agent, turn, step, file, content, tool = 'bash') {
  if (agent.session.snapshotEvents().at(-1)?.type !== 'turn/start') agent.session.append('turn/start', { turn })
  agent.session.append('step/start', { turn, step })
  const exec = { agent, name: tool, callId: `call-${turn}-${step}`, signal: new AbortController().signal, arguments: {} }
  await root.waterfall('fs/write-intent', { key: file }, exec, () => undefined)
  await root.waterfall('tools/pre-execute', exec, async () => 'allow')
  await fs.writeFile(file, content)
  agent.session.append('step/end', { turn, step })
  agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return agent.session.snapshotEvents().at(-1).seq
}

async function executeCommand(root, agent, line) {
  const execution = await root.commands.execute(agent, line, [], new AbortController().signal)
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

  const { root, session, agent, dispose, asks } = await mount({ cwd: workspace, snapshotDir })
  log('copy flow: mounted; workspace', workspace)

  await agentMutates(root, agent, 1, 1, fileA, 'A-v2!\n') // turn 1: 改 a.txt（尺寸变化，去重不依赖 mtime）
  const forkSeq1 = session.snapshotEvents().at(-1).seq
  await agentMutates(root, agent, 2, 1, fileB, 'B-v2!\n') // turn 2: 改 b.txt
  const fileC = path.join(workspace, 'c.txt')
  await fs.writeFile(fileC, 'C-new\n') // 检查点之后新建的文件：preview 报告、restore 保留

  const list = await executeCommand(root, agent, '/rewind')
  assert.equal(list.kind, 'success')
  assert.match(list.text, /4 checkpoints/, '每轮一个 auto 自动快照 + 一个 fs/write-intent 变更快照')
  assert.match(list.text, /trigger: auto/)
  assert.match(list.text, /trigger: fs\/write-intent/)
  log('  /rewind list:\n' + list.text.split('\n').map((line) => `    ${line}`).join('\n'))

  // 确定性选取"回放就绪"的变更触发检查点（turn 2 的 fs/write-intent 捕获）：
  // 种子 = turn 1 的 turn/end 前缀，文件状态 = a.txt 已改、b.txt 未改。
  const targetLine = list.text.split('\n').find((line) => line.includes('trigger: fs/write-intent') && line.includes('session: replay-ready'))
  const targetId = /#([0-9a-f]{8})/.exec(targetLine ?? '')?.[1]
  assert.ok(targetId, 'list carries a replay-ready checkpoint id (usable as addressing prefix)')

  // preview：只读影响面 —— 不经确认门、不写文件、不 fork。
  assert.equal(asks(), 0, 'preview 之前没有任何确认请求')
  const preview = await executeCommand(root, agent, `/rewind preview ${targetId}`)
  assert.equal(preview.kind, 'success', preview.text)
  assert.match(preview.text, /restoring it would overwrite 1 file\(s\)/)
  assert.match(preview.text, /1 file\(s\) created after the checkpoint would be left in place/)
  assert.match(preview.text, /run "\/rewind <id>" to confirm and apply/)
  assert.equal(asks(), 0, 'preview 不经确认门')
  assert.equal(await fs.readFile(fileA, 'utf8'), 'A-v2!\n', 'preview 不写文件')
  assert.equal(await fs.readFile(fileC, 'utf8'), 'C-new\n', 'preview 不删文件')
  log('  /rewind preview ok (no gate, no writes):', preview.text.split('\n')[0])

  const rewind = await executeCommand(root, agent, `/rewind ${targetId}`)
  assert.equal(asks(), 1, '真正的 rewind 经确认门一次')
  assert.equal(rewind.kind, 'success', rewind.text)
  assert.match(rewind.text, /rewind guard: [0-9a-f-]{36}/, '结果携带可撤销本次回退的保护检查点')
  log('  /rewind result:', rewind.text)

  assert.equal(await fs.readFile(fileA, 'utf8'), 'A-v2!\n', 'a.txt 保留检查点后的 turn 1 修改')
  assert.equal(await fs.readFile(fileB, 'utf8'), 'B-v1\n', 'b.txt 回退到检查点内容')
  assert.equal(await fs.readFile(fileC, 'utf8'), 'C-new\n', '检查点之后新建的 c.txt 保留')

  const childId = /session: replayed as child session (session-[\w-]+)/.exec(rewind.text)?.[1]
  assert.ok(childId, '结果携带新 sessionId')
  const child = root.sessions.get(childId)
  assert.ok(child, 'fork 子会话存活')
  assert.equal(child.header.parentSession, session.id)
  assert.equal(child.header.cwd, workspace)
  assert.equal(child.snapshotEvents().length, forkSeq1 + 3, '种子 = 边界前缀 + session/end-seed + 回退通知')
  assert.equal(child.snapshotEvents().at(-1).type, 'user/message', '子会话收到回退通知')
  assert.match(child.snapshotEvents().at(-1).data.content[0].text, /replayed from checkpoint/)
  for (let seq = 0; seq <= forkSeq1; seq += 1) {
    assert.deepEqual(child.snapshotEvents()[seq], session.snapshotEvents()[seq], `child seed seq ${seq} 与源一致`)
  }
  log('  fork ok: child', childId, 'seedLength', child.snapshotEvents().length - 2, 'parent', child.header.parentSession)

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

  // preview：只读命令序列，不 spawn restore、不改 HEAD。
  const preview = await executeCommand(root, agent, `/rewind preview ${firstId}`)
  assert.equal(preview.kind, 'success', preview.text)
  assert.match(preview.text, /restoring it would overwrite 1 file\(s\)/)
  assert.equal(await fs.readFile(fileA, 'utf8'), 'A-v2\n', 'preview 不写文件')
  log('  /rewind preview ok (git):', preview.text.split('\n')[0])

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

/**
 * 附流程：v1 介质（0.4.x 时代）——真实 json 后端版本校验下的双版本回退。
 * 回归：0.5.3 在 v1 介质上 open 抛 version-mismatch，捕获静默失效。
 */
async function v1MediumFlow() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-int-ws-'))
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-int-snap-'))
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-int-storage-'))
  const fileA = path.join(workspace, 'a.txt')
  await fs.writeFile(fileA, 'A-v1\n')
  // 预置 0.4.x 时代的介质：unit.version 1 + 一条 v1 记录（forkSeq，无 kind/config）。
  const v1Record = {
    id: 'v1-record-0001',
    sessionId: 'integration-session',
    cwd: workspace,
    seq: 1,
    time: Date.now() - 60000,
    provider: 'git',
    triggerTool: 'write',
    turn: 1,
    step: 1,
    files: 1,
    bytes: 4,
    ref: 'a'.repeat(40),
    forkSeq: 0,
  }
  const medium = {
    unit: { name: 'checkpoints', version: 1 },
    global: null,
    tables: { checkpoints: { [v1Record.id]: v1Record } },
  }
  await fs.writeFile(path.join(storageRoot, 'checkpoints.json'), `${JSON.stringify(medium, null, 2)}\n`, 'utf8')

  const { root, agent, dispose } = await mount({ cwd: workspace, snapshotDir, storageRoot })
  log('v1 medium flow: mounted; storage', storageRoot)

  // 回退打开成功：旧记录立即可读（kind 缺失降级 [mutation]）。
  const list0 = await executeCommand(root, agent, '/rewind')
  assert.equal(list0.kind, 'success')
  assert.match(list0.text, /1 checkpoint/)
  assert.match(list0.text, /\[mutation\]/, 'v1 记录无 kind → 降级标签')
  assert.match(list0.text, /\(git\)/)
  log('  /rewind list on v1 medium:\n' + list0.text.split('\n').map((line) => `    ${line}`).join('\n'))

  // 捕获恢复：新记录按 v2 形状写入同一介质；介质头部保持 v1。
  await agentMutates(root, agent, 1, 1, fileA, 'A-v2\n')
  const list1 = await executeCommand(root, agent, '/rewind')
  assert.equal(list1.kind, 'success')
  assert.match(list1.text, /3 checkpoints/, 'v1 种子 + auto + fs/write-intent 各一条')
  assert.match(list1.text, /\(copy\)/, '新捕获经 auto→copy 解析')

  const after = JSON.parse(await fs.readFile(path.join(storageRoot, 'checkpoints.json'), 'utf8'))
  assert.equal(after.unit.version, 1, '介质头部保持 v1（存储层无迁移，兼容模式不升级）')
  const records = after.tables.checkpoints
  assert.equal(records[v1Record.id].forkSeq, 0, '旧 v1 记录原样保留')
  const fresh = Object.values(records).find((record) => record.id !== v1Record.id && record.kind === 'mutation')
  assert.ok(fresh, '新记录已落盘')
  assert.equal(fresh.kind, 'mutation', '新记录为 v2 形状（kind 落盘）')
  assert.equal(typeof fresh.config, 'object', '新记录携带配置快照')
  assert.equal(fresh.forkSeq, undefined, '新记录不带 v1 字段')
  log('  medium header version:', after.unit.version, '· records:', Object.keys(records).length)

  await dispose()
  log('v1 medium flow: PASS')
}

await mainCopyFlow()
await gitFlowIfAvailable()
await v1MediumFlow()
log('integration: ALL PASS')
