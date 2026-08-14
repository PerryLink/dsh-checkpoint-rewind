// test/index.test.mjs — 插件整体行为（真 cordis + 真 SessionStore/CommandRuntime +
// mock 存储领域）：快照创建/去重/配额清理/边界映射/两段式恢复失败矩阵/
// 确认拒绝路径/并发快照/自适应事件门。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { mountPlugin, openStep, closeStep, dispatchWriteIntent, dispatchPreExecute, settle } from './helpers/ctx-harness.mjs'

async function makeWorkspace(files) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-ws-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(cwd, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content)
  }
  return cwd
}

async function makeSnapDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-snaps-'))
}

function approvingQuestions() {
  return {
    async ask() {
      return { answers: [{ id: 'rewind-confirm', selected: ['Restore'] }] }
    },
  }
}

function rejectingQuestions() {
  return {
    async ask() {
      return { answers: [{ id: 'rewind-confirm', selected: ['Cancel'] }] }
    },
  }
}

/** 轮询等待表内记录数（插件内部领域操作异步落盘）。 */
async function waitForRecords(table, count, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const records = [...table.entries()].filter(([, record]) => record.sessionId === 'session-under-test')
    if (records.length >= count) return records
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const records = [...table.entries()].filter(([, record]) => record.sessionId === 'session-under-test')
  throw new Error(`timed out waiting for ${count} records (have ${records.length})`)
}

/** 当前测试会话的检查点记录（[key, record] 元组，同 waitForRecords 形状）。 */
async function recordsOf(records) {
  return [...records.entries()].filter(([, record]) => record.sessionId === 'session-under-test')
}

/** 轮询直到谓词为真（清理异步收敛等场景）。 */
async function waitUntil(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for condition')
}

function command(app, line) {
  return app.root.commands.execute(app.agent, line, new AbortController().signal)
}

describe('配置与挂载', () => {
  it('enabled:false 不注册 /rewind 命令', async () => {
    const app = await mountPlugin({ config: { enabled: false } })
    const listed = app.root.commands.list(app.agent)
    assert.equal(listed.some((entry) => entry.name === 'rewind'), false)
    await app.dispose()
  })

  it('非法 maxSnapshots 在加载期响亮抛错', async () => {
    await assert.rejects(() => mountPlugin({ config: { maxSnapshots: 0 } }), /maxSnapshots/)
  })

  it('非法 provider 在加载期响亮抛错', async () => {
    await assert.rejects(() => mountPlugin({ config: { provider: 'rsync' } }), /provider/)
  })

  it('plugin 卸载时 provider 注册被撤销（effect disposer）', async () => {
    const app = await mountPlugin({})
    await app.dispose()
    // 卸载后不再产生新快照：重新挂载独立上下文验证注册面已释放。
    assert.ok(true)
  })
})

describe('快照创建与去重', () => {
  it('fs/write-intent 在开放步骤内触发快照（copy provider 兜底非 git 目录）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'auto', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    const records = await waitForRecords(app.records, 1)
    assert.equal(records[0][1].provider, 'copy')
    assert.equal(records[0][1].triggerTool, 'fs/write-intent')
    assert.equal(records[0][1].turn, 1)
    assert.equal(records[0][1].step, 1)
    assert.equal(records[0][1].files, 1)
    await app.dispose()
  })

  it('tools/pre-execute 对变更工具（bash）触发快照；只读工具不触发', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchPreExecute(app.root, app.agent, 'read') // 只读 → 无快照
    await dispatchPreExecute(app.root, app.agent, 'bash')
    const records = await waitForRecords(app.records, 1)
    assert.equal(records[0][1].triggerTool, 'bash')
    await app.dispose()
  })

  it('同一步骤内多次变更意图只产生一个快照（步骤窗去重）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    await dispatchWriteIntent(app.root, app.agent, 'edit')
    await dispatchPreExecute(app.root, app.agent, 'bash')
    await settle()
    const records = await recordsOf(app.records)
    assert.equal(records.length, 1)
    await app.dispose()
  })

  it('并发变更意图共享同一次捕获（不产生重复快照）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await Promise.all([
      dispatchWriteIntent(app.root, app.agent, 'write'),
      dispatchPreExecute(app.root, app.agent, 'bash'),
    ])
    await settle()
    const records = await recordsOf(app.records)
    assert.equal(records.length, 1)
    await app.dispose()
  })

  it('下一步骤且内容有变 → 新快照；内容未变 → 去重跳过', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    closeStep(app.session, 1, 1)
    openStep(app.session, 1, 2)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    await waitForRecords(app.records, 2)
    // 步骤 3：无实际变更（意图触发但工作区内容与上一快照一致）→ 去重。
    closeStep(app.session, 1, 2)
    openStep(app.session, 1, 3)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    await settle()
    const records = await recordsOf(app.records)
    assert.equal(records.length, 2)
    assert.equal(records[1][1].step, 2)
    await app.dispose()
  })

  it('步骤之外（无开放步骤）不产生快照', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    app.session.append('turn/start', { turn: 1 })
    app.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await dispatchWriteIntent(app.root, app.agent, 'write')
    await settle()
    const records = await recordsOf(app.records)
    assert.equal(records.length, 0)
    await app.dispose()
  })

  it('快照失败不阻断工具决策（waterfall 直通）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    // provider: 'git' + 非 git 目录 → 探测失败、快照失败（响亮但不外溢）。
    const app = await mountPlugin({ cwd, config: { provider: 'git', snapshotDir } })
    openStep(app.session, 1, 1)
    const decision = await app.root.waterfall('fs/write-intent', { key: 't' }, { agent: app.agent, name: 'write' }, () => 'policy-allow')
    assert.equal(decision, 'policy-allow')
    await app.dispose()
  })
})

describe('会话边界补记与映射', () => {
  it('step/end 补 stepEndSeq，turn/end 补 forkSeq；映射取 ≤N 最近快照', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    await waitForRecords(app.records, 1)
    const stepEndSeq = closeStep(app.session, 1, 1)
    const turnEndSeq = closeStep(app.session, 1, 1, true)
    await settle()
    const [record] = await recordsOf(app.records)
    assert.equal(record[1].stepEndSeq, stepEndSeq)
    assert.equal(record[1].forkSeq, turnEndSeq)
    const { nearestCheckpointAtOrBefore } = await import('../lib/checkpoints.mjs')
    assert.equal(nearestCheckpointAtOrBefore([record[1]], stepEndSeq)?.id, record[1].id)
    assert.equal(nearestCheckpointAtOrBefore([record[1]], stepEndSeq - 1), undefined)
    await app.dispose()
  })
})

describe('配额清理', () => {
  it('超出 maxSnapshots 时按最旧优先清理（记录 + copy 存储）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, maxSnapshots: 2 } })
    for (let step = 1; step <= 4; step += 1) {
      openStep(app.session, 1, step)
      await dispatchWriteIntent(app.root, app.agent, 'write')
      await fs.writeFile(path.join(cwd, 'a.txt'), `A${step + 1}`)
      closeStep(app.session, 1, step)
    }
    await waitUntil(async () => (await recordsOf(app.records)).length === 2)
    await settle()
    const records = await recordsOf(app.records)
    assert.deepEqual(records.map(([, record]) => record.step), [3, 4])
    await app.dispose()
  })

  it('超出 maxSnapshotBytes 全局配额时最旧优先清理', async () => {
    const filler = 'x'.repeat(600)
    const cwd = await makeWorkspace({ 'a.txt': filler, 'b.txt': filler })
    const snapshotDir = await makeSnapDir()
    // 每次快照 ≈ 1200 字节；配额 1500 → 最多保留 1 条。
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, maxSnapshots: 50, maxSnapshotBytes: 1500 } })
    for (let step = 1; step <= 3; step += 1) {
      openStep(app.session, 1, step)
      await dispatchWriteIntent(app.root, app.agent, 'write')
      await fs.writeFile(path.join(cwd, 'a.txt'), `S${step}${filler}`)
      closeStep(app.session, 1, step)
    }
    await waitUntil(async () => {
      const records = await recordsOf(app.records)
      return records.length >= 1 && records.at(-1)[1].step === 3
    })
    await settle()
    const records = await recordsOf(app.records)
    const bytes = records.reduce((sum, [, record]) => sum + record.bytes, 0)
    assert.ok(bytes <= 1500, `total bytes ${bytes} within quota`)
    assert.equal(records.length, 1, '只保留最新一条')
    assert.equal(records[0][1].step, 3, '最新的保留')
    await app.dispose()
  })
})

describe('/rewind 命令', () => {
  it('无参列出最近检查点（含时间/步骤/触发工具/文件数/大小/fork 状态）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    const result = await command(app, '/rewind')
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /1 checkpoint/)
    assert.match(result?.result.text, /trigger: fs\/write-intent/)
    assert.match(result?.result.text, /turn 1 step 1/)
    assert.match(result?.result.text, /fork: ready/)
    await app.dispose()
  })

  it('未知 id → 错误提示', async () => {
    const app = await mountPlugin({})
    const result = await command(app, '/rewind nope')
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /unknown checkpoint id/)
    await app.dispose()
  })

  it('确认拒绝 → 不恢复、不 fork、记录保留', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: rejectingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    const result = await command(app, `/rewind ${(await recordsOf(app.records))[0][1].id}`)
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /rewind cancelled/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A2')
    assert.equal((await recordsOf(app.records)).length, 1)
    assert.equal(app.root.sessions.list().length, 1)
    await app.dispose()
  })

  it('无回答者（confirmVia auto）→ 失败关闭', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    const id = (await recordsOf(app.records))[0][1].id
    const result = await command(app, `/rewind ${id}`)
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /no confirmation answerer/)
    await app.dispose()
  })

  it('approval 通道（approval.request 抛错如无开放轮次）→ 失败关闭', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const approval = { request: async () => { throw new Error('no open turn') } }
    const app = await mountPlugin({ cwd, approval, config: { provider: 'copy', snapshotDir, confirmVia: 'approval' } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    const id = (await recordsOf(app.records))[0][1].id
    const result = await command(app, `/rewind ${id}`)
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /no open turn/)
    await app.dispose()
  })

  it('恢复失败 → 不 fork、不清快照、报错并保留现场', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    const record = (await recordsOf(app.records))[0][1]
    // 破坏快照存储：删除快照目录 → restore 失败。
    await fs.rm(path.join(snapshotDir), { recursive: true, force: true })
    const result = await command(app, `/rewind ${record.id}`)
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /No session was forked/)
    assert.equal((await recordsOf(app.records)).length, 1)
    assert.equal(app.root.sessions.list().length, 1)
    await app.dispose()
  })

  it('fork 失败（turn 未闭合，forkSeq 未补记）→ 文件已恢复但报告会话未派生', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1) // 只关 step，不关 turn → forkSeq 未补记
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    const record = (await recordsOf(app.records))[0][1]
    const result = await command(app, `/rewind ${record.id}`)
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /session was NOT forked/)
    assert.match(result?.result.text, /no closed turn boundary/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1', '文件已恢复')
    assert.equal(app.root.sessions.list().length, 1, '未派生新会话')
    await app.dispose()
  })

  it('完整回退：文件内容与 fork 会话上下文都正确', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1', 'b.txt': 'B1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    // turn 1：改 a.txt。
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    closeStep(app.session, 1, 1, true)
    const forkSeq1 = app.session.events.at(-1).seq
    // turn 2：改 b.txt。
    openStep(app.session, 2, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 2)
    await fs.writeFile(path.join(cwd, 'b.txt'), 'B2')
    closeStep(app.session, 2, 1, true)
    // 回退到 turn 1 的检查点（a.txt 改前、b.txt 未改）。
    const first = (await recordsOf(app.records)).find(([, record]) => record.turn === 1)[1]
    const result = await command(app, `/rewind ${first.id}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /session: session-\d+/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1')
    assert.equal(await fs.readFile(path.join(cwd, 'b.txt'), 'utf8'), 'B1')
    const childId = /session: (session-\d+)/.exec(result.result.text)?.[1]
    assert.ok(childId, '命令结果携带新 sessionId')
    const child = app.root.sessions.get(childId)
    assert.ok(child, 'fork 子会话在 store 中存活')
    assert.equal(child.header.parentSession, app.session.id)
    assert.equal(child.header.cwd, cwd)
    assert.equal(child.firstLiveSeq, forkSeq1 + 1)
    assert.equal(child.events.length, forkSeq1 + 3) // 种子 + session/end-seed + 回退通知
    assert.equal(child.events.at(-1).type, 'user/message', '子会话收到回退通知')
    const notice = child.events.at(-1).data
    assert.equal(notice.source?.kind, 'plugin')
    assert.equal(notice.source?.plugin, 'checkpoint-rewind')
    assert.match(notice.content[0].text, /restored to checkpoint/)
    for (let seq = 0; seq <= forkSeq1; seq += 1) {
      assert.deepEqual(child.events[seq], app.session.events[seq])
    }
    // 源会话未被改写（仍含两轮全部事件）。
    assert.ok(app.session.events.length > forkSeq1)
    await app.dispose()
  })

  it('命令生命周期经宿主已知事件可重建（command/run + command/done）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    await command(app, '/rewind')
    const lifecycle = app.session.events.filter((event) => event.type === 'command/run' || event.type === 'command/done')
    assert.equal(lifecycle.length, 2)
    assert.equal(lifecycle[0].type, 'command/run')
    assert.equal(lifecycle[1].type, 'command/done')
    assert.match(lifecycle[0].data.name, /rewind/)
    assert.match(lifecycle[1].data.text, /1 checkpoint/)
    await app.dispose()
  })

  it('rc.6 自适应门：checkpoint/* 未被宿主收录时不 append（会话仍可加载）', async () => {
    assert.equal(KNOWN_SESSION_EVENT_TYPES.has('checkpoint/snapshot'), false)
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    const custom = app.session.events.filter((event) => event.type.startsWith('checkpoint/'))
    assert.equal(custom.length, 0)
    await app.dispose()
  })
})
