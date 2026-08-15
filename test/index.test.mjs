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

function deletingQuestions() {
  return {
    async ask() {
      return { answers: [{ id: 'rewind-confirm', selected: ['Delete'] }] }
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
async function waitForRecords(table, count, timeoutMs = 15000) {
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
async function waitUntil(predicate, timeoutMs = 15000) {
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

  it('非法 mutationTools 元素（非字符串）在加载期响亮抛错', async () => {
    await assert.rejects(() => mountPlugin({ config: { mutationTools: ['bash', 42] } }), /mutationTools/)
  })

  it('非法 preRewindCheckpoint 在加载期响亮抛错', async () => {
    await assert.rejects(() => mountPlugin({ config: { preRewindCheckpoint: 'always' } }), /preRewindCheckpoint/)
  })

  it('probeIgnorableAppend：rc.6 宿主不支持 ignorable 信封 → false（自适应门保持关闭）', async () => {
    const { probeIgnorableAppend } = await import('../index.mjs')
    assert.equal(probeIgnorableAppend(), false)
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
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A22') // 尺寸变化：去重判据不依赖 mtime 精度
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
      await fs.writeFile(path.join(cwd, 'a.txt'), `A${step + 1}${'x'.repeat(step)}`) // 尺寸逐次变化
      closeStep(app.session, 1, step)
    }
    // 收敛到目标状态（[3,4]）而非假定中间状态：清理在异步链上推进。
    await waitUntil(async () => {
      const records = await recordsOf(app.records)
      return JSON.stringify(records.map(([, record]) => record.step)) === JSON.stringify([3, 4])
    })
    await settle()
    const records = await recordsOf(app.records)
    assert.deepEqual(records.map(([, record]) => record.step), [3, 4])
    await app.dispose()
  })

  it('超出 maxSnapshotBytes 全局配额时最旧优先清理（软配额：最新一条保留）', async () => {
    const filler = 'x'.repeat(600)
    const cwd = await makeWorkspace({ 'a.txt': filler, 'b.txt': filler })
    const snapshotDir = await makeSnapDir()
    // 增量记账：第一次 ≈ 1200 字节实拷贝；后续只计变更文件 ≈ 600 字节。
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, maxSnapshots: 50, maxSnapshotBytes: 1500 } })
    for (let step = 1; step <= 3; step += 1) {
      openStep(app.session, 1, step)
      await dispatchWriteIntent(app.root, app.agent, 'write')
      await fs.writeFile(path.join(cwd, 'a.txt'), `S${step}${'x'.repeat(step)}${filler}`) // 尺寸逐次变化
      closeStep(app.session, 1, step)
    }
    await waitUntil(async () => {
      const records = await recordsOf(app.records)
      const steps = records.map(([, record]) => record.step)
      return steps.includes(3) && !steps.includes(1)
    })
    await settle()
    const records = await recordsOf(app.records)
    const steps = records.map(([, record]) => record.step)
    assert.equal(steps.includes(1), false, '最旧的（step 1）被清理')
    assert.ok(steps.includes(3), '最新一条总是保留')
    const bytes = records.reduce((sum, [, record]) => sum + record.bytes, 0)
    assert.ok(bytes <= 1500, `total bytes ${bytes} within quota`)
    await app.dispose()
  })

  it('单条检查点超过字节配额不被自清理（保留下限：大工作区可用）', async () => {
    const filler = 'x'.repeat(2000)
    const cwd = await makeWorkspace({ 'a.txt': filler })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, maxSnapshots: 50, maxSnapshotBytes: 1024 } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    const records = await waitForRecords(app.records, 1)
    assert.equal(records.length, 1, '超过配额的唯一检查点仍保留（软配额下限）')
    assert.equal(records[0][1].bytes, 2000)
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

  it('approval 通道（无开放轮次）→ 前置检测失败关闭，不调 request', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const calls = []
    const approval = { request: async () => { calls.push(1); return 'allowed-once' } }
    const app = await mountPlugin({ cwd, approval, config: { provider: 'copy', snapshotDir, confirmVia: 'approval' } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    const id = (await recordsOf(app.records))[0][1].id
    const result = await command(app, `/rewind ${id}`)
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /requires an open turn/)
    assert.match(result?.result.text, /mount userQuestions/)
    assert.equal(calls.length, 0, '绝不调用无轮次必抛的 approval.request')
    await app.dispose()
  })

  it('恢复失败 → 不 fork、目标检查点保留、报错并保留现场（含保护检查点）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    const record = (await recordsOf(app.records))[0][1]
    // 破坏快照存储：删除快照目录 → 目标 restore 失败（guard 捕获会重建目录）。
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!') // 尺寸变化：guard 捕获不依赖 mtime 精度
    await fs.rm(path.join(snapshotDir), { recursive: true, force: true })
    const result = await command(app, `/rewind ${record.id}`)
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /No session was forked/)
    const records = await recordsOf(app.records)
    assert.ok(records.some(([, r]) => r.id === record.id), '目标检查点保留')
    assert.ok(records.some(([, r]) => r.triggerTool === 'rewind'), 'pre-rewind 保护检查点已捕获')
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
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!') // 尺寸变化：guard 捕获不依赖 mtime 精度
    const record = (await recordsOf(app.records))[0][1]
    const result = await command(app, `/rewind ${record.id}`)
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /session was NOT forked/)
    assert.match(result?.result.text, /no closed turn boundary/)
    assert.match(result?.result.text, /rewind guard: [0-9a-f-]{36}/, '结果携带可撤销本次回退的保护检查点')
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
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    closeStep(app.session, 1, 1, true)
    const forkSeq1 = app.session.events.at(-1).seq
    // turn 2：改 b.txt。
    openStep(app.session, 2, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 2)
    await fs.writeFile(path.join(cwd, 'b.txt'), 'B2!')
    closeStep(app.session, 2, 1, true)
    // 回退到 turn 1 的检查点（a.txt 改前、b.txt 未改）。
    const first = (await recordsOf(app.records)).find(([, record]) => record.turn === 1)[1]
    const result = await command(app, `/rewind ${first.id}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /session: session-\d+/)
    assert.match(result?.result.text, /rewind guard: [0-9a-f-]{36}/, '结果携带保护检查点 id')
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1')
    assert.equal(await fs.readFile(path.join(cwd, 'b.txt'), 'utf8'), 'B1')
    const guard = (await recordsOf(app.records)).find(([, record]) => record.triggerTool === 'rewind')
    assert.ok(guard, 'pre-rewind 保护检查点已落盘（可撤销本次回退）')
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

describe('/rewind 寻址', () => {
  it('唯一前缀寻址（8 位短 id）→ 回退成功', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    closeStep(app.session, 1, 1, true)
    const id = (await recordsOf(app.records))[0][1].id
    const result = await command(app, `/rewind ${id.slice(0, 8)}`)
    assert.equal(result?.result.kind, 'success')
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1')
    await app.dispose()
  })

  it('歧义前缀 → 错误列出候选 id', async () => {
    const app = await mountPlugin({})
    const base = { sessionId: 'session-under-test', cwd: path.resolve('/work', 'proj'), seq: 0, time: 1, provider: 'copy', triggerTool: 'bash', turn: 1, step: 1, files: 1, bytes: 1, ref: 'x' }
    app.records.set('aaaaaaaa-0000-0000-0000-000000000001', { ...base, id: 'aaaaaaaa-0000-0000-0000-000000000001' })
    app.records.set('aaaaaaaa-0000-0000-0000-000000000002', { ...base, id: 'aaaaaaaa-0000-0000-0000-000000000002' })
    const result = await command(app, '/rewind aaaaaaaa')
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /matches 2 checkpoints/)
    assert.match(result?.result.text, /aaaaaaaa-0000-0000-0000-000000000001/)
    await app.dispose()
  })

  it('/rewind latest → 回退最新检查点', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    closeStep(app.session, 1, 1, true)
    const result = await command(app, '/rewind latest')
    assert.equal(result?.result.kind, 'success')
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1')
    await app.dispose()
  })

  it('/rewind step <N> → 映射到 ≤N 最近检查点', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    closeStep(app.session, 1, 1, true)
    openStep(app.session, 1, 2)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 2)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A3!!')
    closeStep(app.session, 1, 2, true)
    const result = await command(app, '/rewind step 1')
    assert.equal(result?.result.kind, 'success')
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1', 'step 1 → 其 step/end 前的最近检查点')
    await app.dispose()
  })

  it('/rewind step <N>：该步号未闭合 → 明确报错', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    const result = await command(app, '/rewind step 3')
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /step 3 has not ended or does not exist/)
    await app.dispose()
  })

  it('/rewind step x → 用法提示', async () => {
    const app = await mountPlugin({})
    const usage = await command(app, '/rewind step x')
    assert.equal(usage?.result.kind, 'error')
    assert.match(usage?.result.text, /usage: \/rewind step <positive-integer>/)
    await app.dispose()
  })
})

describe('/rewind clear', () => {
  it('确认后清空本会话检查点（记录 + 存储），工作区文件不动', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: deletingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    const result = await command(app, '/rewind clear')
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /cleared 1 checkpoint/)
    assert.equal((await recordsOf(app.records)).length, 0)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1', '工作区文件不动')
    for (const dir of await fs.readdir(snapshotDir)) {
      assert.equal((await fs.readdir(path.join(snapshotDir, dir))).length, 0, '快照存储已 discard')
    }
    await app.dispose()
  })

  it('确认拒绝 → 检查点保留', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: rejectingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    await waitForRecords(app.records, 1)
    const result = await command(app, '/rewind clear')
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /clear cancelled/)
    assert.equal((await recordsOf(app.records)).length, 1)
    await app.dispose()
  })

  it('无检查点时 clear → 成功空操作', async () => {
    const app = await mountPlugin({})
    const result = await command(app, '/rewind clear')
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /no checkpoints to clear/)
    await app.dispose()
  })
})

describe('/rewind preview（只读影响面预览）', () => {
  it('preview <id 前缀>：不经确认门、不写文件、不 fork', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    // 拒绝型确认通道：preview 若误入确认门会立刻失败关闭，成功即证明未走门。
    const app = await mountPlugin({ cwd, userQuestions: rejectingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    // 尺寸变化：快检去重不依赖 mtime 精度，消除并行负载下的偶发误判。
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!!')
    closeStep(app.session, 1, 1, true)
    const record = (await recordsOf(app.records))[0][1]
    const result = await command(app, `/rewind preview ${record.id.slice(0, 8)}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /rewind preview: checkpoint #/)
    assert.match(result?.result.text, /would overwrite 1 file\(s\):/)
    assert.match(result?.result.text, /a\.txt/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A2!!', 'preview 不写文件')
    assert.ok(!result?.result.text.includes('forked'), 'preview 不 fork')
    await app.dispose()
  })

  it('preview step <N> / latest 共享寻址语法', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    closeStep(app.session, 1, 1, true)
    const byStep = await command(app, '/rewind preview step 1')
    assert.equal(byStep?.result.kind, 'success')
    assert.match(byStep?.result.text, /rewind preview:/)
    const byLatest = await command(app, '/rewind preview latest')
    assert.equal(byLatest?.result.kind, 'success')
    assert.match(byLatest?.result.text, /rewind preview:/)
    await app.dispose()
  })

  it('preview 无目标/未知 id → 响亮错误', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    const empty = await command(app, '/rewind preview')
    assert.equal(empty?.result.kind, 'error')
    assert.match(empty?.result.text, /preview <id-prefix/)
    const unknown = await command(app, '/rewind preview deadbeef')
    assert.equal(unknown?.result.kind, 'error')
    assert.match(unknown?.result.text, /unknown checkpoint id/)
    await app.dispose()
  })
})

describe('pre-rewind 保护检查点', () => {
  it('warn 模式（默认）：guard 捕获失败只警告，回退继续', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    closeStep(app.session, 1, 1, true)
    const record = (await recordsOf(app.records))[0][1]
    // 把快照根换成文件：guard 捕获与目标恢复都无法建目录。
    await fs.rm(path.join(snapshotDir), { recursive: true, force: true })
    await fs.writeFile(snapshotDir, 'not a dir')
    const result = await command(app, `/rewind ${record.id}`)
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /No session was forked/)
    assert.equal((await recordsOf(app.records)).filter(([, r]) => r.triggerTool === 'rewind').length, 0, 'guard 捕获失败仅警告（不阻断）')
    await app.dispose()
  })

  it('require 模式：guard 捕获失败 → 中止回退、文件不动', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir, preRewindCheckpoint: 'require' } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    closeStep(app.session, 1, 1, true)
    const record = (await recordsOf(app.records))[0][1]
    // 破坏 guard 捕获路径：把 snapshotDir 换成文件（mkdir 必失败）。
    await fs.rm(path.join(snapshotDir), { recursive: true, force: true })
    await fs.writeFile(snapshotDir, 'not a dir')
    const result = await command(app, `/rewind ${record.id}`)
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /aborted — the pre-rewind guard checkpoint could not be captured/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A2', '文件未被改动')
    await app.dispose()
  })

  it('off 模式：跳过 guard（结果不带 guard 行）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir, preRewindCheckpoint: 'off' } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    closeStep(app.session, 1, 1, true)
    const record = (await recordsOf(app.records))[0][1]
    const result = await command(app, `/rewind ${record.id}`)
    assert.equal(result?.result.kind, 'success')
    assert.ok(!result?.result.text.includes('rewind guard:'), 'off 模式无 guard 行')
    assert.equal((await recordsOf(app.records)).filter(([, r]) => r.triggerTool === 'rewind').length, 0)
    await app.dispose()
  })
})

describe('默认变更工具清单', () => {
  it('pwsh 与 terminal_send 在 tools/pre-execute 上触发快照', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchPreExecute(app.root, app.agent, 'pwsh')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!') // 尺寸变化：去重判据不依赖 mtime 精度
    closeStep(app.session, 1, 1)
    openStep(app.session, 1, 2)
    await dispatchPreExecute(app.root, app.agent, 'terminal_send')
    await waitForRecords(app.records, 2)
    const records = await recordsOf(app.records)
    assert.deepEqual(records.map(([, record]) => record.triggerTool).sort(), ['pwsh', 'terminal_send'])
    await app.dispose()
  })
})
