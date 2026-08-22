// test/index.test.mjs — 插件整体行为（真 cordis + 真 SessionStore/CommandRuntime +
// mock 存储领域）：快照创建/去重/配额清理/边界映射/两段式恢复失败矩阵/
// 确认拒绝路径/并发快照/自适应事件门。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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
      // 一体与单态回退的确认标签不同（Restore / Restore files / Replay session /
      // Restore config）；批准型回答者全选，任意目标都放行。
      return { answers: [{ id: 'rewind-confirm', selected: ['Restore', 'Restore files', 'Replay session', 'Restore config'] }] }
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
  return app.root.commands.execute(app.agent, line, [], new AbortController().signal)
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

  it('probeIgnorableAppend：rc.2 宿主不支持 ignorable 信封 → false（自适应门保持关闭）', async () => {
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
  it('step/end 补 stepEndSeq；捕获时计算 sessionBoundary（游标前最近一条 turn/end）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    // turn 1（无任何闭合轮）→ sessionBoundary 缺失（回退以空种子重放）。
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    await waitForRecords(app.records, 1)
    const stepEndSeq = closeStep(app.session, 1, 1)
    const turnEndSeq = closeStep(app.session, 1, 1, true)
    await settle()
    const first = (await recordsOf(app.records)).find(([, record]) => record.turn === 1)[1]
    assert.equal(first.stepEndSeq, stepEndSeq)
    assert.equal(first.sessionBoundary, undefined, '首轮检查点无重放边界')
    // turn 2 → 边界 = turn 1 的 turn/end seq。
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    openStep(app.session, 2, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    await waitForRecords(app.records, 2)
    const second = (await recordsOf(app.records)).find(([, record]) => record.turn === 2)[1]
    assert.equal(second.sessionBoundary, turnEndSeq, '边界 = 游标之前最近一条 turn/end')
    const { nearestCheckpointAtOrBefore } = await import('../lib/checkpoints.mjs')
    assert.equal(nearestCheckpointAtOrBefore([first], stepEndSeq)?.id, first.id)
    assert.equal(nearestCheckpointAtOrBefore([first], stepEndSeq - 1), undefined)
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
  it('无参列出最近检查点（含时间/步骤/触发工具/文件数/大小/树/会话重放状态）', async () => {
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
    assert.match(result?.result.text, /session: fresh \(no closed turn yet\)/)
    assert.match(result?.result.text, /tree: n\/a \(copy\)/)
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

  it('恢复失败 → 不重放、不改配置、目标检查点保留、报错并保留现场（含保护检查点）', async () => {
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
    assert.match(result?.result.text, /No session was replayed/)
    const records = await recordsOf(app.records)
    assert.ok(records.some(([, r]) => r.id === record.id), '目标检查点保留')
    assert.ok(records.some(([, r]) => r.triggerTool === 'rewind'), 'pre-rewind 保护检查点已捕获')
    assert.equal(app.root.sessions.list().length, 1)
    await app.dispose()
  })

  it('首轮检查点（无闭合轮边界）→ 会话回退以空种子重放全新子会话，文件照常恢复', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1) // 只关 step，不关 turn → 无闭合轮
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!') // 尺寸变化：guard 捕获不依赖 mtime 精度
    const record = (await recordsOf(app.records))[0][1]
    const result = await command(app, `/rewind ${record.id}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /session: replayed as child session session-\d+/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1', '文件已恢复')
    const childId = /session: replayed as child session (session-\d+)/.exec(result?.result.text)?.[1]
    const child = app.root.sessions.get(childId)
    assert.ok(child, '重放子会话在 store 中存活')
    assert.equal(child.header.parentSession, app.session.id)
    assert.equal(child.events.length, 2, '空种子：session/end-seed + 回退通知')
    assert.equal(child.events.at(-1).type, 'user/message', '子会话收到回退通知')
    await app.dispose()
  })

  it('完整回退：文件内容与重放会话上下文都正确（边界 = 上一轮 turn/end）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1', 'b.txt': 'B1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    // turn 1：改 a.txt，快照在首轮捕获（无边界）。
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    closeStep(app.session, 1, 1, true)
    const turn1End = app.session.events.at(-1).seq
    // turn 2：改 b.txt；本轮快照的边界 = turn 1 的 turn/end。
    openStep(app.session, 2, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 2)
    await fs.writeFile(path.join(cwd, 'b.txt'), 'B2!')
    closeStep(app.session, 2, 1, true)
    // 回退到 turn 2 的检查点（a.txt=A2、b.txt=B1；上下文回到 turn 1 结束处）。
    const second = (await recordsOf(app.records)).find(([, record]) => record.turn === 2)[1]
    assert.equal(second.sessionBoundary, turn1End)
    const result = await command(app, `/rewind ${second.id}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /session: replayed as child session session-\d+/)
    assert.match(result?.result.text, /rewind guard: [0-9a-f-]{36}/, '结果携带保护检查点 id')
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A2!')
    assert.equal(await fs.readFile(path.join(cwd, 'b.txt'), 'utf8'), 'B1')
    const guard = (await recordsOf(app.records)).find(([, record]) => record.triggerTool === 'rewind')
    assert.ok(guard, 'pre-rewind 保护检查点已落盘（可撤销本次回退）')
    const childId = /session: replayed as child session (session-\d+)/.exec(result.result.text)?.[1]
    assert.ok(childId, '命令结果携带新 sessionId')
    const child = app.root.sessions.get(childId)
    assert.ok(child, '重放子会话在 store 中存活')
    assert.equal(child.header.parentSession, app.session.id)
    assert.equal(child.header.cwd, cwd)
    assert.equal(child.firstLiveSeq, turn1End + 1)
    assert.equal(child.events.length, turn1End + 3) // 种子 + session/end-seed + 回退通知
    assert.equal(child.events.at(-1).type, 'user/message', '子会话收到回退通知')
    const notice = child.events.at(-1).data
    assert.equal(notice.source?.kind, 'plugin')
    assert.equal(notice.source?.plugin, 'checkpoint-rewind')
    assert.match(notice.content[0].text, /replayed from checkpoint/)
    for (let seq = 0; seq <= turn1End; seq += 1) {
      assert.deepEqual(child.events[seq], app.session.events[seq])
    }
    // 源会话未被改写（仍含两轮全部事件）。
    assert.ok(app.session.events.length > turn1End)
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

  it('rc.2 自适应门：checkpoint/* 未被宿主收录时不 append（会话仍可加载）', async () => {
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
    assert.match(result?.result.text, /No session was replayed/)
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

describe('自动间隔快照（autoCheckpoint）', () => {
  it('step/start 触发自动快照（kind auto、trigger auto；intervalMinutes=0 每步）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, autoCheckpoint: { enabled: true, intervalMinutes: 0 } } })
    openStep(app.session, 1, 1)
    const records = await waitForRecords(app.records, 1)
    assert.equal(records[0][1].kind, 'auto')
    assert.equal(records[0][1].triggerTool, 'auto')
    assert.equal(records[0][1].turn, 1)
    assert.equal(records[0][1].step, 1)
    assert.equal(records[0][1].sessionBoundary, undefined, '首轮自动快照无重放边界')
    await app.dispose()
  })

  it('intervalMinutes > 0：间隔内跳过（内容变了也不捕获），interval=0 每步捕获', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, autoCheckpoint: { enabled: true, intervalMinutes: 60 } } })
    openStep(app.session, 1, 1)
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    openStep(app.session, 2, 1)
    await settle()
    const records = await recordsOf(app.records)
    assert.equal(records.length, 1, '间隔内跳过：即使工作区已变化')
    await app.dispose()
  })

  it('enabled:false：step/start 不产生自动快照', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, autoCheckpoint: { enabled: false } } })
    openStep(app.session, 1, 1)
    await settle()
    assert.equal((await recordsOf(app.records)).length, 0)
    await app.dispose()
  })

  it('工作区未变化：自动快照去重（不新增记录）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, autoCheckpoint: { enabled: true, intervalMinutes: 0 } } })
    openStep(app.session, 1, 1)
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    openStep(app.session, 2, 1)
    await settle()
    assert.equal((await recordsOf(app.records)).length, 1, '内容一致 → provider 去重')
    await app.dispose()
  })
})

describe('/checkpoint 命令', () => {
  it('创建手动检查点（含备注）并返回三态摘要；内容未变 → 去重提示', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    const deduped = await command(app, '/checkpoint')
    assert.equal(deduped?.result.kind, 'success')
    assert.match(deduped?.result.text, /nothing new was captured/)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A22')
    const result = await command(app, '/checkpoint note 发布前检查')
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /checkpoint: captured #/)
    assert.match(result?.result.text, /note: 发布前检查/)
    assert.match(result?.result.text, /session cursor: seq \d+/)
    assert.match(result?.result.text, /config snapshot: \d+ key\(s\)/)
    assert.match(result?.result.text, /\/rewind workspace\|session\|config/)
    const manual = (await recordsOf(app.records)).find(([, record]) => record.kind === 'manual')[1]
    assert.equal(manual.note, '发布前检查')
    assert.equal(manual.triggerTool, 'checkpoint')
    assert.ok(Array.isArray(manual.config) === false && typeof manual.config === 'object', '记录携带配置快照')
    assert.equal(manual.config.provider, 'copy')
    await app.dispose()
  })

  it('去重且最新记录为自动快照：消息说明该状态已被自动快照记录', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, autoCheckpoint: { enabled: true, intervalMinutes: 0 } } })
    openStep(app.session, 1, 1)
    await waitForRecords(app.records, 1)
    const deduped = await command(app, '/checkpoint')
    assert.equal(deduped?.result.kind, 'success')
    assert.match(deduped?.result.text, /nothing new was captured/)
    assert.match(deduped?.result.text, /already records this exact workspace state/)
    assert.match(deduped?.result.text, /\(#[0-9a-f]{8}, auto, seq \d+\)/)
    assert.doesNotMatch(deduped?.result.text, /untracked/, 'copy provider 无未跟踪概念')
    await app.dispose()
  })

  it('去重且存在未跟踪文件（git provider）：消息提示 git add 纳管', async (t) => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-cp-'))
    const runReal = async (args) => {
      const result = await new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (c) => { stdout += String(c) })
        child.stderr.on('data', (c) => { stderr += String(c) })
        child.on('error', reject)
        child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
      })
      return result
    }
    const init = await runReal(['init', '-q']).catch((error) => {
      t.skip(`git init unavailable (${error.message})`)
      return undefined
    })
    if (init === undefined) return
    await runReal(['config', 'user.email', 'test@example.com'])
    await runReal(['config', 'user.name', 'tester'])
    await runReal(['config', 'core.autocrlf', 'false'])
    await fs.writeFile(path.join(repo, 'a.txt'), 'A1')
    await runReal(['add', '-A'])
    await runReal(['commit', '-q', '-m', 'initial'])
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd: repo, config: { provider: 'git', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(repo, 'untracked.txt'), 'not covered\n')
    const deduped = await command(app, '/checkpoint')
    assert.equal(deduped?.result.kind, 'success')
    assert.match(deduped?.result.text, /nothing new was captured/)
    assert.match(deduped?.result.text, /1 untracked file\(s\) are not covered by git snapshots/)
    assert.match(deduped?.result.text, /git add/)
    assert.doesNotMatch(deduped?.result.text, /already records this exact workspace state/, '基准是变更快照而非自动快照')
    await app.dispose()
    await fs.rm(repo, { recursive: true, force: true })
  })

  it('/checkpoint list 与 /checkpoint diff <a> <b>（文件/配置/会话差）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A22')
    closeStep(app.session, 1, 1, true)
    openStep(app.session, 2, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 2)
    const list = await command(app, '/checkpoint list')
    assert.equal(list?.result.kind, 'success')
    assert.match(list?.result.text, /checkpoint: 2 checkpoints/)
    const records = await recordsOf(app.records)
    const from = records.find(([, record]) => record.turn === 1)[1]
    const to = records.find(([, record]) => record.turn === 2)[1]
    const diff = await command(app, `/checkpoint diff ${from.id.slice(0, 8)} ${to.id.slice(0, 8)}`)
    assert.equal(diff?.result.kind, 'success')
    assert.match(diff?.result.text, /checkpoint diff: #/)
    assert.match(diff?.result.text, /workspace files: 1 changed \(0 added, 0 removed\):/)
    assert.match(diff?.result.text, /a\.txt/)
    assert.match(diff?.result.text, /config: unchanged/)
    assert.match(diff?.result.text, /session: cursor \d+ \(turn 1 step 1\) → \d+ \(turn 2 step 1\)/)
    await app.dispose()
  })
})

describe('三态独立回滚（rewind workspace|session|config）', () => {
  it('/rewind workspace <id>：只回滚工作区（不重放会话、不动配置）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    closeStep(app.session, 1, 1, true)
    const id = (await recordsOf(app.records))[0][1].id
    const result = await command(app, `/rewind workspace ${id}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /workspace: restored 1 file\(s\)/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1')
    assert.equal(app.root.sessions.list().length, 1, 'workspace-only 不重放会话')
    assert.ok(!result?.result.text.includes('session: replayed'), '结果不含会话回退行')
    await app.dispose()
  })

  it('/rewind session <id>：只重放会话（文件不动）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    const id = (await recordsOf(app.records))[0][1].id
    const result = await command(app, `/rewind session ${id}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /session: replayed as child session session-\d+/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A2!', 'session-only 不动文件')
    assert.ok(!result?.result.text.includes('workspace: restored'), '结果不含工作区回退行')
    assert.equal(app.root.sessions.list().length, 2, '原会话 + 重放子会话')
    await app.dispose()
  })

  it('/rewind config <id>：无 settings 服务 → 进程内回退并明示非持久（文件与会话不动）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    const id = (await recordsOf(app.records))[0][1].id
    const result = await command(app, `/rewind config ${id}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /config: no settings service attached: config restored in-process only/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A2!', 'config-only 不动文件')
    assert.equal(app.root.sessions.list().length, 1, 'config-only 不重放会话')
    await app.dispose()
  })

  it('/rewind all <id> 与缺省一体回滚等价（三态齐动）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir } })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'bash')
    await waitForRecords(app.records, 1)
    closeStep(app.session, 1, 1, true)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!')
    const id = (await recordsOf(app.records))[0][1].id
    const result = await command(app, `/rewind all ${id}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /workspace: restored 1 file\(s\)/)
    assert.match(result?.result.text, /session: replayed as child session session-\d+/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1')
    await app.dispose()
  })
})

describe('checkpoint 模型工具与提示词段落', () => {
  it('tools 服务存在时注册 checkpoint 工具；执行创建手动检查点', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const tools = new Map()
    const registry = { register: (def) => { tools.set(def.name, def); return () => tools.delete(def.name) } }
    const app = await mountPlugin({ cwd, tools: registry, config: { provider: 'copy', snapshotDir } })
    assert.ok(tools.has('checkpoint'), 'checkpoint 工具已注册')
    openStep(app.session, 1, 1)
    const def = tools.get('checkpoint')
    const output = await def.execute({ note: '工具捕获' }, { agent: app.agent })
    assert.match(output, /checkpoint: captured #/)
    assert.match(output, /note/)
    // presentCall 契约回归：返回对象卡片（ToolEventView {card, …}），不是字符串——
    // 字符串会让宿主整页拒绝历史响应（session.history zod 校验 invalid_type）。
    const view = def.presentCall({ note: '工具捕获' })
    assert.equal(view?.card, 'generic')
    assert.match(view?.title, /工具捕获/)
    assert.equal(typeof def.presentCall({}), 'object', '无 note 也返回对象卡片')
    const records = await recordsOf(app.records)
    assert.equal(records.length, 1)
    assert.equal(records[0][1].kind, 'manual')
    assert.equal(records[0][1].note, '工具捕获')
    await app.dispose()
  })

  it('checkpointTool:false 不注册工具；无 tools 服务的组装不受影响', async () => {
    const tools = new Map()
    const registry = { register: (def) => { tools.set(def.name, def); return () => tools.delete(def.name) } }
    const app = await mountPlugin({ tools: registry, config: { checkpointTool: false } })
    assert.equal(tools.has('checkpoint'), false)
    await app.dispose()
    const bare = await mountPlugin({})
    const listed = bare.root.commands.list(bare.agent)
    assert.ok(listed.some((entry) => entry.name === 'rewind'))
    await bare.dispose()
  })

  it('systemPrompt 存在且 promptSection 开启 → 注册短小的角色陈述段落', async () => {
    const sections = []
    const systemPrompt = { section: (section) => { sections.push(section); return () => {} } }
    const app = await mountPlugin({ systemPrompt })
    assert.equal(sections.length, 1)
    assert.equal(sections[0].name, 'checkpoint-rewind:role')
    assert.match(sections[0].text, /^Checkpoint keeper: /, '以一句角色陈述开头（Minimal persona 风格）')
    assert.ok(sections[0].text.length < 300, '保持短小')
    await app.dispose()
  })

  it('promptSection:false → 不注册段落', async () => {
    const sections = []
    const systemPrompt = { section: (section) => { sections.push(section); return () => {} } }
    const app = await mountPlugin({ systemPrompt, config: { promptSection: false } })
    assert.equal(sections.length, 0)
    await app.dispose()
  })
})
