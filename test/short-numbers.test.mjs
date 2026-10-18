// test/short-numbers.test.mjs — 有界短号（`/rewind <number>`）：每会话单调递增、
// 持久在记录 + 领域 global 槽、prune/clear 后永不复用；数字寻址精确命中且绝不
// 退回 id 前缀匹配；旧记录（无 short 字段）按创建序补号而不是静默错位。
//
// 覆盖：短号纯函数（planShortNumbers / resolveRecordByPrefix / list brief 渲染）、
// 命令层（连续捕获、clear、clear --all、prompt 配额清理、精确恢复、旧记录补号）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  addressOf,
  formatCheckpointBriefList,
  formatCheckpointList,
  isShortNumber,
  parseShortNumber,
  planShortNumbers,
  resolveRecordByPrefix,
} from '../lib/checkpoints.mjs'
import { mountPlugin, openStep, closeStep, dispatchWriteIntent, settle } from './helpers/ctx-harness.mjs'

const SESSION_ID = 'session-under-test'

/** @param {Record<string, string>} files */
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

/** @param {any} app @param {string} line */
function command(app, line) {
  return app.root.commands.execute(app.agent, line, [], new AbortController().signal)
}

/** 当前测试会话的记录数组（时间升序 = 短号升序）。 */
/** @param {Map<string, any>} records */
async function recordsOf(records) {
  return [...records.entries()]
    .filter(([, record]) => record.sessionId === SESSION_ID)
    .map(([, record]) => record)
    .sort((a, b) => a.time - b.time || a.seq - b.seq)
}

/** @param {Map<string, any>} table @param {number} count */
async function waitForRecords(table, count, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const records = [...table.entries()].filter(([, record]) => record.sessionId === SESSION_ID)
    if (records.length >= count) return records
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const records = [...table.entries()].filter(([, record]) => record.sessionId === SESSION_ID)
  throw new Error(`timed out waiting for ${count} records (have ${records.length})`)
}

/** 捕获一个真实快照（每个 step 一个变更窗口；内容逐次变化以避开内容去重）。 */
/** @param {any} app @param {string} cwd @param {number} step @param {string} nextContent @param {number} [expectedCount] */
async function captureAt(app, cwd, step, nextContent, expectedCount) {
  openStep(app.session, 1, step)
  await dispatchWriteIntent(app.root, app.agent, 'write')
  await fs.writeFile(path.join(cwd, 'a.txt'), nextContent)
  closeStep(app.session, 1, step)
  if (expectedCount === undefined) await waitForStep(app, step)
  else await waitForRecords(app.records, expectedCount)
  return recordsOf(app.records)
}

/** 等待某个 step 的检查点落盘（配额清理会删旧记录，不能按记录总数等）。 */
/** @param {any} app @param {number} step */
async function waitForStep(app, step, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await recordsOf(app.records)).some(record => record.turn === 1 && record.step === step)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for a checkpoint at turn 1 step ${step}`)
}

/** 0.4.x/0.6.24 时代的记录形状：无 short 字段（旧介质记录）。 */
/** @param {string} cwd @param {{id: string, time: number, step: number, short?: number}} opts @returns {{id: string} & Record<string, unknown>} */
function legacyRecordOf(cwd, opts) {
  return {
    id: opts.id,
    sessionId: SESSION_ID,
    cwd,
    seq: opts.step,
    time: opts.time,
    provider: 'git',
    triggerTool: 'write',
    turn: 1,
    step: opts.step,
    files: 1,
    bytes: 4,
    ref: 'a'.repeat(40),
    ...(opts.short === undefined ? {} : { short: opts.short }),
  }
}

/** 记录替身（纯函数测试用）。 */
/** @param {{id: string, short?: number, time: number}} opts @returns {import('../types.d.ts').CheckpointRecord} */
function recordOf(opts) {
  return {
    id: opts.id,
    sessionId: 's',
    cwd: '/work/proj',
    seq: 1,
    time: opts.time,
    provider: 'copy',
    kind: 'manual',
    triggerTool: 'checkpoint',
    turn: 1,
    step: 1,
    files: 1,
    bytes: 4,
    ref: 'ref',
    ...(opts.short === undefined ? {} : { short: opts.short }),
  }
}

describe('短号纯函数', () => {
  it('isShortNumber / parseShortNumber：只认正整数短号，0 与超界都不是短号但仍是数字寻址', () => {
    assert.equal(isShortNumber(1), true)
    assert.equal(isShortNumber(0), false)
    assert.equal(isShortNumber(-3), false)
    assert.equal(isShortNumber(1.5), false)
    assert.equal(isShortNumber('3'), false)
    assert.equal(isShortNumber(undefined), false)
    assert.equal(parseShortNumber('3'), 3)
    assert.equal(parseShortNumber(' 12 '), 12)
    assert.equal(parseShortNumber('0'), undefined)
    assert.equal(parseShortNumber('nope'), undefined)
    assert.equal(parseShortNumber('3a'), undefined)
  })

  it('resolveRecordByPrefix：数字输入精确命中短号，绝不退回 id 前缀匹配', () => {
    const records = [
      recordOf({ id: '3aaaaaaa-1111-4111-8111-111111111111', short: 7, time: 1 }),
      recordOf({ id: '7bbbbbbb-2222-4222-8222-222222222222', short: 3, time: 2 }),
      recordOf({ id: 'cccccccc-3333-4333-8333-333333333333', time: 3 }),
    ]
    // 短号 3 的记录 id 以 7 开头；id 以 3 开头的记录短号是 7。
    assert.equal(resolveRecordByPrefix(records, '3').record?.id, '7bbbbbbb-2222-4222-8222-222222222222')
    assert.equal(resolveRecordByPrefix(records, '7').record?.id, '3aaaaaaa-1111-4111-8111-111111111111')
    // 数字输入找不到短号 → notFound（绝不落到前缀匹配上，那会命中错目标）。
    assert.deepEqual(resolveRecordByPrefix(records, '99'), { notFound: true })
    assert.deepEqual(resolveRecordByPrefix(records, '0'), { notFound: true })
    // 非数字输入仍是 id 唯一前缀寻址（大小写不敏感、可消歧）。
    assert.equal(resolveRecordByPrefix(records, '3aaaaaaa').record?.id, '3aaaaaaa-1111-4111-8111-111111111111')
    assert.equal(resolveRecordByPrefix(records, 'CCCCCCCC-3').record?.id, 'cccccccc-3333-4333-8333-333333333333')
    assert.deepEqual(resolveRecordByPrefix(records, 'nope'), { notFound: true })
  })

  it('planShortNumbers：旧记录按创建序补号，起点在 max(水位, 现存最大号) 之后，绝不撞号', () => {
    const legacy = [
      recordOf({ id: 'old-2', time: 200 }),
      recordOf({ id: 'old-1', time: 100 }),
      recordOf({ id: 'old-3', time: 300 }),
    ]
    // 水位 5（clear 之前的分配结果）→ 补号从 6 起，且按创建序而非数组序。
    const plan = planShortNumbers(legacy, 5)
    assert.deepEqual(plan.assignments, [
      { id: 'old-1', short: 6 },
      { id: 'old-2', short: 7 },
      { id: 'old-3', short: 8 },
    ])
    assert.equal(plan.high, 8)
    // 无需补号时零分配、水位不动。
    const numbered = [recordOf({ id: 'n-1', short: 2, time: 1 }), recordOf({ id: 'n-2', short: 4, time: 2 })]
    assert.deepEqual(planShortNumbers(numbered, 1), { assignments: [], high: 4 })
    // 水位高于现存最大号（记录被 clear/prune 掉）→ 仍从水位之后继续。
    assert.deepEqual(planShortNumbers(numbered, 9), { assignments: [], high: 9 })
    assert.equal(addressOf({ ...numbered[1] }), '4')
    assert.equal(addressOf({ ...legacy[0] }), 'old-2'.slice(0, 8))
  })

  it('formatCheckpointBriefList：单行、带短号、最新在前；无短号的旧记录退回 id 前缀', () => {
    const now = 1700000000000
    const text = formatCheckpointBriefList([
      recordOf({ id: 'aaaaaaaa-1111-4111-8111-111111111111', short: 1, time: now - 7200000 }),
      recordOf({ id: 'bbbbbbbb-2222-4222-8222-222222222222', short: 2, time: now - 120000 }),
    ], { now, timeFormatter: () => 'T' })
    const lines = text.split('\n')
    assert.match(lines[0], /2 checkpoints \(newest first/)
    assert.match(lines[1], /^#2 · \[manual\] · turn 1 step 1 · 1 file · 4 B · 2 min ago$/)
    assert.match(lines[2], /^#1 · \[manual\] · turn 1 step 1 · 1 file · 4 B · T$/)
    assert.ok(lines[1].length < 80, `brief 行手机可读（${lines[1].length} 字符）`)
    const legacyText = formatCheckpointBriefList([recordOf({ id: 'deadeeff-3333-4333-8333-333333333333', time: now })], { timeFormatter: () => 'T' })
    assert.match(legacyText, /id deadeeff/)
    assert.equal(formatCheckpointBriefList([]), 'rewind: no checkpoints yet')
  })

  it('formatCheckpointList：既有行格式不变（短号只在末尾提示行里指向 list brief）', () => {
    const now = 1700000000000
    const text = formatCheckpointList([recordOf({ id: 'a1b2c3d4e5f6a7b8', short: 3, time: now })], { timeFormatter: () => 'T', now })
    const lines = text.split('\n')
    assert.match(lines[1], /^#a1b2c3d4 · \[manual\] · \(copy\) · turn 1 step 1 · /)
    assert.equal(lines[1].startsWith('#3'), false, '既有详细列表首 token 仍是 8 位 id')
    assert.match(text, /\/rewind list brief/)
  })
})

describe('短号分配（命令层）', () => {
  it('连续创建 N 个快照：短号严格递增且从 1 起', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'S1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, verifyByHash: true } })
    await captureAt(app, cwd, 1, 'S2', 1)
    await captureAt(app, cwd, 2, 'S3', 2)
    await captureAt(app, cwd, 3, 'S4', 3)
    await settle()
    const records = await recordsOf(app.records)
    assert.deepEqual(records.map(record => record.short), [1, 2, 3])
    for (let index = 1; index < records.length; index += 1) {
      assert.ok(records[index].short > records[index - 1].short, '短号严格递增')
    }
    await app.dispose()
  })

  it('/rewind list brief 列出短号（单行）且与 /rewind list 的短号一致', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'S1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, verifyByHash: true } })
    await captureAt(app, cwd, 1, 'S2', 1)
    await captureAt(app, cwd, 2, 'S3', 2)
    const brief = await command(app, '/rewind list brief')
    assert.equal(brief?.result.kind, 'success')
    assert.match(brief?.result.text, /^rewind: 2 checkpoints \(newest first/)
    assert.match(brief?.result.text, /^#2 · \[mutation\] · turn 1 step 2/m)
    assert.match(brief?.result.text, /^#1 · \[mutation\] · turn 1 step 1/m)
    const full = await command(app, '/rewind list')
    assert.equal(full?.result.kind, 'success')
    assert.match(full?.result.text, /2 checkpoints \(newest last\)/)
    await app.dispose()
  })

  it('/rewind clear 之后新快照的短号大于 clear 前的最大值（计数器不复位）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'S1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: deletingQuestions(), config: { provider: 'copy', snapshotDir, verifyByHash: true } })
    await captureAt(app, cwd, 1, 'S2', 1)
    await captureAt(app, cwd, 2, 'S3', 2)
    await captureAt(app, cwd, 3, 'S4', 3)
    const before = await recordsOf(app.records)
    const maxBefore = Math.max(...before.map(record => record.short))
    assert.equal(maxBefore, 3)

    const cleared = await command(app, '/rewind clear')
    assert.equal(cleared?.result.kind, 'success')
    assert.match(cleared?.result.text, /cleared 3 checkpoint/)
    await settle()
    assert.equal((await recordsOf(app.records)).length, 0, '记录确实被删除')
    assert.equal(app.globalOf()?.shortCounters?.[SESSION_ID], 3, '计数水位未被 clear 清除')

    await captureAt(app, cwd, 4, 'S5', 1)
    const after = await recordsOf(app.records)
    assert.equal(after.length, 1)
    assert.ok(after[0].short > maxBefore, `新短号 ${after[0].short} 必须大于 clear 前的最大值 ${maxBefore}`)
    assert.equal(after[0].short, maxBefore + 1, '只增不回收：接在最大值之后')
    await app.dispose()
  })

  it('/rewind clear --all 之后新快照同样继续递增', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'S1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: deletingQuestions(), config: { provider: 'copy', snapshotDir, verifyByHash: true } })
    await captureAt(app, cwd, 1, 'S2', 1)
    await captureAt(app, cwd, 2, 'S3', 2)
    const cleared = await command(app, '/rewind clear --all')
    assert.equal(cleared?.result.kind, 'success')
    await settle()
    assert.equal((await recordsOf(app.records)).length, 0)
    await captureAt(app, cwd, 3, 'S4', 1)
    const after = await recordsOf(app.records)
    assert.equal(after[0].short, 3, 'clear --all 之后从 3 继续（不是回到 1）')
    await app.dispose()
  })

  it('配额清理（prune）不回收短号：剩下的记录保持原号，新记录继续递增', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'S1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, maxSnapshots: 2, verifyByHash: true } })
    await captureAt(app, cwd, 1, 'S2')
    await captureAt(app, cwd, 2, 'S3')
    await captureAt(app, cwd, 3, 'S4')
    await captureAt(app, cwd, 4, 'S5')
    const deadline = Date.now() + 15000
    while (Date.now() < deadline && (await recordsOf(app.records)).length > 2) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await settle()
    const pruned = await recordsOf(app.records)
    assert.equal(pruned.length, 2, '最旧两条被清理')
    assert.deepEqual(pruned.map(record => record.short), [3, 4], '存活记录保持原短号（不复用、不重排）')
    // 被 prune 掉的短号 1/2 不得再被分配。
    await fs.writeFile(path.join(cwd, 'a.txt'), 'S6')
    const manual = await command(app, '/checkpoint')
    assert.equal(manual?.result.kind, 'success')
    const after = await recordsOf(app.records)
    const fresh = after.find(record => record.triggerTool === 'checkpoint')
    assert.ok(fresh !== undefined, '手动检查点已创建')
    assert.equal(fresh.short, 5, '新短号接在历史最大值之后（1/2 不回收）')
    await app.dispose()
  })
})

describe('短号精确寻址（不再模糊匹配）', () => {
  it('/rewind workspace <短号> 命中该短号的快照（回滚内容正确）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'S1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, userQuestions: approvingQuestions(), config: { provider: 'copy', snapshotDir, verifyByHash: true } })
    await captureAt(app, cwd, 1, 'S2', 1)
    await captureAt(app, cwd, 2, 'S3', 2)
    await captureAt(app, cwd, 3, 'S4', 3)
    await fs.writeFile(path.join(cwd, 'a.txt'), 'S9')

    const result = await command(app, '/rewind workspace 2')
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /workspace: restored 1 file\(s\)/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'S2', '恢复的是 #2 的内容（不是 #1/#3）')
    await app.dispose()
  })

  it('/rewind preview <短号> 命中短号记录，而不是 id 以该数字开头的记录', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'S1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, verifyByHash: true } })
    await captureAt(app, cwd, 1, 'S2', 1)
    await captureAt(app, cwd, 2, 'S3', 2)
    const records = await recordsOf(app.records)
    const target = records.find(record => record.short === 2)
    assert.ok(target !== undefined, '#2 存在')
    // 把 #1 的 id 改写成以 "2" 开头的诱饵（短号前缀寻址若仍生效就会命中它）。
    const decoy = records.find(record => record.short === 1)
    assert.ok(decoy !== undefined, '#1 存在')
    app.records.delete(decoy.id)
    app.records.set('2decoy00-0000-4000-8000-000000000000', { ...decoy, id: '2decoy00-0000-4000-8000-000000000000' })

    const preview = await command(app, '/rewind preview 2')
    assert.equal(preview?.result.kind, 'success')
    assert.match(preview?.result.text, /rewind preview: checkpoint #2 \(id /)
    assert.ok(preview?.result.text.includes(target.id), `preview 命中 #2 的记录 ${target.id}`)
    assert.ok(!preview?.result.text.includes('2decoy00'), '绝不命中 id 以 2 开头的记录')
    await app.dispose()
  })

  it('数字寻址找不到短号 → 明确报错（不落到 id 前缀匹配）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'S1' })
    const snapshotDir = await makeSnapDir()
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir, verifyByHash: true } })
    await captureAt(app, cwd, 1, 'S2', 1)
    const result = await command(app, '/rewind 99')
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /no checkpoint #99 in this session/)
    assert.ok(!result?.result.text.includes('unknown checkpoint id'), '数字输入走短号措辞')
    await app.dispose()
  })
})

describe('旧记录兼容（无 short 字段）', () => {
  it('旧记录按创建序补号并持久化；新捕获接在其后；列表不崩溃', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'S1' })
    const snapshotDir = await makeSnapDir()
    const now = Date.now()
    const legacy = [
      legacyRecordOf(cwd, { id: 'legacy-oldest1', time: now - 3000, step: 1 }),
      legacyRecordOf(cwd, { id: 'legacy-middle2', time: now - 2000, step: 2 }),
      legacyRecordOf(cwd, { id: 'legacy-newest3', time: now - 1000, step: 3 }),
    ]
    const app = await mountPlugin({
      cwd,
      seedRecords: Object.fromEntries(legacy.map(record => [record.id, record])),
      config: { provider: 'copy', snapshotDir, verifyByHash: true },
    })

    // 读路径即补号：升级后的第一次列表就能看到短号，且按创建序（不是插入序）。
    const listed = await command(app, '/rewind list brief')
    assert.equal(listed?.result.kind, 'success')
    assert.match(listed?.result.text, /^#3 · \[mutation\] · turn 1 step 3/m)
    assert.match(listed?.result.text, /^#2 · \[mutation\] · turn 1 step 2/m)
    assert.match(listed?.result.text, /^#1 · \[mutation\] · turn 1 step 1/m)
    await settle()
    assert.deepEqual(
      (await recordsOf(app.records)).map(record => [record.id, record.short]),
      [['legacy-oldest1', 1], ['legacy-middle2', 2], ['legacy-newest3', 3]],
      '补号结果已持久化到记录本身',
    )
    assert.equal(app.globalOf()?.shortCounters?.[SESSION_ID], 3, '水位同步持久化')

    // 详细列表格式不变（旧记录的 8 位 id 前缀照常展示、不崩溃）。
    const full = await command(app, '/rewind list')
    assert.equal(full?.result.kind, 'success')
    assert.match(full?.result.text, /#legacy-o/)

    // 新捕获接在旧记录之后（不撞号、不重用）。
    await captureAt(app, cwd, 4, 'S2', 4)
    const after = await recordsOf(app.records)
    const fresh = after.find(record => record.triggerTool !== 'write' || record.id.startsWith('legacy-') === false)
    assert.ok(fresh !== undefined)
    assert.equal(fresh.short, 4, '新快照接在补号后的水位之后')
    assert.equal((await recordsOf(app.records)).filter(record => record.short === 4).length, 1, '短号唯一')
    await app.dispose()
  })

  it('补号幂等：第二次读取不再改写记录', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'S1' })
    const snapshotDir = await makeSnapDir()
    const now = Date.now()
    const legacy = legacyRecordOf(cwd, { id: 'legacy-solo', time: now - 1000, step: 1 })
    const app = await mountPlugin({
      cwd,
      seedRecords: { [legacy.id]: legacy },
      config: { provider: 'copy', snapshotDir, verifyByHash: true },
    })
    await command(app, '/rewind list brief')
    await settle()
    const first = (await recordsOf(app.records))[0]
    assert.equal(first.short, 1)
    await command(app, '/rewind list brief')
    await settle()
    const second = (await recordsOf(app.records))[0]
    assert.equal(second.short, 1)
    assert.equal(second.id, first.id)
    await app.dispose()
  })
})
