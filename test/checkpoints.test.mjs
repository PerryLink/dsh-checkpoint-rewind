// test/checkpoints.test.mjs — 检查点纯函数：≤N 映射、清理计划、列表渲染。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatBytes,
  formatCheckpointList,
  formatPreviewResult,
  formatRelativeAge,
  nearestCheckpointAtOrBefore,
  parseCheckpointInput,
  parseRewindInput,
  prunePlan,
  resolveRecordByPrefix,
  sortOldestFirst,
  stepEndSeqOf,
} from '../lib/checkpoints.mjs'

function record(overrides) {
  return {
    id: 'cp-1',
    sessionId: 's1',
    cwd: '/work',
    seq: 10,
    time: 1000,
    provider: 'copy',
    triggerTool: 'bash',
    turn: 1,
    step: 1,
    files: 2,
    bytes: 4096,
    ref: 'ref-1',
    ...overrides,
  }
}

describe('sortOldestFirst', () => {
  it('按 (time, seq) 升序且不修改入参', () => {
    const records = [
      record({ id: 'b', time: 2000, seq: 20 }),
      record({ id: 'a', time: 1000, seq: 10 }),
      record({ id: 'c', time: 2000, seq: 21 }),
    ]
    const sorted = sortOldestFirst(records)
    assert.deepEqual(sorted.map(entry => entry.id), ['a', 'b', 'c'])
    assert.deepEqual(records.map(entry => entry.id), ['b', 'a', 'c'])
  })
})

describe('nearestCheckpointAtOrBefore（回到第 N 步 → 最近的 ≤N 快照）', () => {
  it('取 stepEndSeq ≤ N 中最大的一条', () => {
    const records = [
      record({ id: 's1', stepEndSeq: 10 }),
      record({ id: 's2', stepEndSeq: 20 }),
      record({ id: 's3', stepEndSeq: 30 }),
    ]
    assert.equal(nearestCheckpointAtOrBefore(records, 25)?.id, 's2')
  })

  it('N 恰好等于某步 end seq 时命中该步自己的检查点', () => {
    const records = [
      record({ id: 's1', stepEndSeq: 10 }),
      record({ id: 's2', stepEndSeq: 20 }),
    ]
    assert.equal(nearestCheckpointAtOrBefore(records, 20)?.id, 's2')
  })

  it('未补记 stepEndSeq 的记录不参与映射', () => {
    const records = [
      record({ id: 'bound', stepEndSeq: 10 }),
      record({ id: 'unbound' }),
    ]
    assert.equal(nearestCheckpointAtOrBefore(records, 99)?.id, 'bound')
  })

  it('没有 ≤N 的记录时返回 undefined', () => {
    const records = [record({ id: 'later', stepEndSeq: 50 })]
    assert.equal(nearestCheckpointAtOrBefore(records, 10), undefined)
  })

  it('空列表返回 undefined', () => {
    assert.equal(nearestCheckpointAtOrBefore([], 10), undefined)
  })
})

describe('prunePlan（配额清理计划）', () => {
  it('每会话只保留最近 maxSnapshots 条（最旧优先删除）', () => {
    const entries = [1, 2, 3, 4].map((n) => ({ key: `cp-${n}`, value: record({ id: `cp-${n}`, time: n * 100, bytes: 10 }) }))
    const plan = prunePlan(entries, { maxSnapshots: 2, maxSnapshotBytes: 1024 * 1024 })
    assert.deepEqual(plan.ids, ['cp-1', 'cp-2'])
  })

  it('每会话独立计数（多会话各自保留配额）', () => {
    const entries = [
      { key: 'a1', value: record({ id: 'a1', sessionId: 'a', time: 100, bytes: 10 }) },
      { key: 'a2', value: record({ id: 'a2', sessionId: 'a', time: 200, bytes: 10 }) },
      { key: 'b1', value: record({ id: 'b1', sessionId: 'b', time: 150, bytes: 10 }) },
      { key: 'b2', value: record({ id: 'b2', sessionId: 'b', time: 250, bytes: 10 }) },
    ]
    const plan = prunePlan(entries, { maxSnapshots: 1, maxSnapshotBytes: 1024 * 1024 })
    assert.deepEqual(plan.ids, ['a1', 'b1'])
  })

  it('全局字节配额：保留条目合计超限时按最旧优先继续删除', () => {
    const entries = [
      { key: 'c1', value: record({ id: 'c1', time: 100, bytes: 60 }) },
      { key: 'c2', value: record({ id: 'c2', time: 200, bytes: 60 }) },
      { key: 'c3', value: record({ id: 'c3', time: 300, bytes: 60 }) },
    ]
    const plan = prunePlan(entries, { maxSnapshots: 10, maxSnapshotBytes: 100 })
    assert.deepEqual(plan.ids, ['c1', 'c2'])
  })

  it('预算内不删任何条目', () => {
    const entries = [
      { key: 'c1', value: record({ id: 'c1', time: 100, bytes: 40 }) },
      { key: 'c2', value: record({ id: 'c2', time: 200, bytes: 40 }) },
    ]
    const plan = prunePlan(entries, { maxSnapshots: 10, maxSnapshotBytes: 100 })
    assert.deepEqual(plan.ids, [])
  })

  it('两条约束同时生效时删除并集', () => {
    const entries = [
      { key: 'c1', value: record({ id: 'c1', time: 100, bytes: 90 }) },
      { key: 'c2', value: record({ id: 'c2', time: 200, bytes: 90 }) },
    ]
    const plan = prunePlan(entries, { maxSnapshots: 1, maxSnapshotBytes: 100 })
    assert.deepEqual(plan.ids, ['c1'])
  })

  it('字节配额是软配额：每会话最新一条总是保留（大工作区不自我清理）', () => {
    const entries = [
      { key: 'big', value: record({ id: 'big', time: 100, bytes: 500 }) },
    ]
    const plan = prunePlan(entries, { maxSnapshots: 10, maxSnapshotBytes: 100 })
    assert.deepEqual(plan.ids, [], '唯一（最新）一条不受字节配额删除')
  })

  it('keepNewestPerSession: false 时字节配额可删除最新一条', () => {
    const entries = [
      { key: 'big', value: record({ id: 'big', time: 100, bytes: 500 }) },
    ]
    const plan = prunePlan(entries, { maxSnapshots: 10, maxSnapshotBytes: 100, keepNewestPerSession: false })
    assert.deepEqual(plan.ids, ['big'])
  })

  it('byRule 拆分触发规则（maxSnapshots 与 maxSnapshotBytes 各自成列）', () => {
    const entries = [
      { key: 'a1', value: record({ id: 'a1', sessionId: 'a', time: 100, bytes: 10 }) },
      { key: 'a2', value: record({ id: 'a2', sessionId: 'a', time: 200, bytes: 10 }) },
      { key: 'b1', value: record({ id: 'b1', sessionId: 'b', time: 150, bytes: 50 }) },
      { key: 'b2', value: record({ id: 'b2', sessionId: 'b', time: 250, bytes: 50 }) },
    ]
    const plan = prunePlan(entries, { maxSnapshots: 1, maxSnapshotBytes: 20 })
    // a1/b1 由每会话上限删除；b2 是 b 的最新保留项，字节配额无法再删它。
    assert.deepEqual(plan.byRule.maxSnapshots, ['a1', 'b1'])
    assert.deepEqual(plan.byRule.maxSnapshotBytes, [])
    assert.deepEqual(plan.ids, ['a1', 'b1'])
  })

  it('liveSessionIds: dead session newest records are pruned under byte quota, while live session newest records stay exempt', () => {
    const entries = [
      { key: 'dead-subagent', value: record({ id: 'dead-subagent', sessionId: 'dead-session-1', time: 100, bytes: 500 }) },
      { key: 'live-main', value: record({ id: 'live-main', sessionId: 'live-session-1', time: 200, bytes: 500 }) },
    ]
    const plan = prunePlan(entries, {
      maxSnapshots: 10,
      maxSnapshotBytes: 400,
      liveSessionIds: new Set(['live-session-1']),
    })
    // dead-subagent is pruned because its session is not in liveSessionIds; live-main is preserved
    assert.deepEqual(plan.ids, ['dead-subagent'])
  })
})

describe('parseRewindInput（/rewind 寻址语法）', () => {
  it('空输入 → list；list/latest/last → 对应形态；clear / clear --all → clear', () => {
    assert.deepEqual(parseRewindInput(''), { kind: 'list' })
    assert.deepEqual(parseRewindInput('  '), { kind: 'list' })
    assert.deepEqual(parseRewindInput('list'), { kind: 'list' })
    assert.deepEqual(parseRewindInput('latest'), { kind: 'latest' })
    assert.deepEqual(parseRewindInput('LAST'), { kind: 'latest' })
    assert.deepEqual(parseRewindInput('clear'), { kind: 'clear', all: false })
    assert.deepEqual(parseRewindInput('clear --all'), { kind: 'clear', all: true })
    assert.deepEqual(parseRewindInput('  CLEAR -A  '), { kind: 'clear', all: true })
    assert.deepEqual(parseRewindInput('clear all'), { kind: 'clear', all: true })
  })

  it('step <N> → step；非法 step 语法 → invalid', () => {
    assert.deepEqual(parseRewindInput('step 3'), { kind: 'step', step: 3 })
    assert.deepEqual(parseRewindInput('  STEP 12 '), { kind: 'step', step: 12 })
    assert.deepEqual(parseRewindInput('step 0').kind, 'invalid')
    assert.match(parseRewindInput('step 0').message, /positive-integer/)
    assert.deepEqual(parseRewindInput('step abc').kind, 'invalid')
    assert.deepEqual(parseRewindInput('step').kind, 'invalid')
  })

  it('三态目标：workspace|session|config|all <目标> → target（大小写不敏感）', () => {
    assert.deepEqual(parseRewindInput('workspace a1b2'), { kind: 'target', target: 'workspace', input: 'a1b2' })
    assert.deepEqual(parseRewindInput('SESSION latest'), { kind: 'target', target: 'session', input: 'latest' })
    assert.deepEqual(parseRewindInput('config step 2'), { kind: 'target', target: 'config', input: 'step 2' })
    assert.deepEqual(parseRewindInput('  ALL a1b2 '), { kind: 'target', target: 'all', input: 'a1b2' })
    assert.deepEqual(parseRewindInput('workspace').kind, 'invalid')
    assert.match(parseRewindInput('workspace').message, /usage: \/rewind \[workspace\|session\|config\|all\]/)
  })

  it('diff <a> <b> → diff；缺参数 → invalid', () => {
    assert.deepEqual(parseRewindInput('diff a1b2 c3d4'), { kind: 'diff', a: 'a1b2', b: 'c3d4' })
    assert.deepEqual(parseRewindInput('  DIFF a b '), { kind: 'diff', a: 'a', b: 'b' })
    assert.deepEqual(parseRewindInput('diff a').kind, 'invalid')
    assert.match(parseRewindInput('diff a').message, /diff <checkpoint-a> <checkpoint-b>/)
  })

  it('其余输入 → id', () => {
    assert.deepEqual(parseRewindInput('abc123'), { kind: 'id', input: 'abc123' })
    assert.deepEqual(parseRewindInput('  a1b2c3d4  '), { kind: 'id', input: 'a1b2c3d4' })
  })

  it('preview <目标> → preview；preview 空/非法 → invalid', () => {
    assert.deepEqual(parseRewindInput('preview abc123'), { kind: 'preview', target: 'abc123' })
    assert.deepEqual(parseRewindInput('  PREVIEW step 2 '), { kind: 'preview', target: 'step 2' })
    assert.deepEqual(parseRewindInput('preview latest'), { kind: 'preview', target: 'latest' })
    assert.deepEqual(parseRewindInput('preview').kind, 'invalid')
    assert.match(parseRewindInput('preview').message, /preview <id-prefix/)
  })

  it('--files 选择性恢复过滤器：挂到目标形态（去重、保序）', () => {
    assert.deepEqual(parseRewindInput('workspace a1b2 --files a.txt,b.txt'), {
      kind: 'target', target: 'workspace', input: 'a1b2', files: ['a.txt', 'b.txt'],
    })
    assert.deepEqual(parseRewindInput('abc123 --files=a.txt, b.txt ,a.txt'), {
      kind: 'id', input: 'abc123', files: ['a.txt', 'b.txt'],
    })
    assert.deepEqual(parseRewindInput('latest --files x.txt'), {
      kind: 'latest', files: ['x.txt'],
    })
  })

  it('--files 只对恢复目标有效；空/裸 --files 非法', () => {
    assert.equal(parseRewindInput('list --files a.txt').kind, 'invalid')
    assert.equal(parseRewindInput('diff a b --files a.txt').kind, 'invalid')
    assert.equal(parseRewindInput('preview abc --files a.txt').kind, 'invalid')
    assert.equal(parseRewindInput('abc123 --files').kind, 'invalid')
    assert.equal(parseRewindInput('abc123 --files , ,').kind, 'invalid')
  })
})

describe('parseCheckpointInput（/checkpoint 语法）', () => {
  it('空输入 → create；list → list；diff <a> <b> → diff', () => {
    assert.deepEqual(parseCheckpointInput(''), { kind: 'create' })
    assert.deepEqual(parseCheckpointInput('  '), { kind: 'create' })
    assert.deepEqual(parseCheckpointInput('list'), { kind: 'list' })
    assert.deepEqual(parseCheckpointInput('LIST'), { kind: 'list' })
    assert.deepEqual(parseCheckpointInput('diff a b'), { kind: 'diff', a: 'a', b: 'b' })
  })

  it('note <text> → create 带备注；裸文本 → create 带备注（命令简写）', () => {
    assert.deepEqual(parseCheckpointInput('note 发布前检查'), { kind: 'create', note: '发布前检查' })
    assert.deepEqual(parseCheckpointInput('  NOTE before release '), { kind: 'create', note: 'before release' })
    assert.deepEqual(parseCheckpointInput('before release'), { kind: 'create', note: 'before release' })
    assert.deepEqual(parseCheckpointInput('note').kind, 'invalid')
    assert.match(parseCheckpointInput('note').message, /note <text>/)
    assert.deepEqual(parseCheckpointInput('diff a').kind, 'invalid')
  })
})

describe('formatPreviewResult（/rewind preview 渲染）', () => {
  it('渲染覆盖清单、未变计数、遗留清单与操作指引', () => {
    const target = record({ id: 'cp-9', provider: 'git', turn: 2, step: 3 })
    const preview = { restore: 2, unchanged: 5, leftovers: ['new.txt'], changes: ['a.txt', 'b.txt'] }
    const text = formatPreviewResult(target, preview)
    assert.match(text, /rewind preview: checkpoint #cp-9/)
    assert.match(text, /would overwrite 2 file\(s\):/)
    assert.match(text, /a\.txt/)
    assert.match(text, /5 file\(s\) already match/)
    assert.match(text, /1 file\(s\) created after the checkpoint would be left in place:/)
    assert.match(text, /new\.txt/)
    assert.match(text, /guard checkpoint is captured first/)
  })

  it('无覆盖文件与无遗留时渲染简洁形态；超限截断', () => {
    const target = record({ id: 'cp-9' })
    const preview = { restore: 0, unchanged: 3, leftovers: [] }
    const text = formatPreviewResult(target, preview)
    assert.match(text, /would overwrite 0 file\(s\)/)
    assert.match(text, /0 file\(s\) created after the checkpoint would be left in place\./)
    const many = { restore: 25, unchanged: 0, leftovers: [], changes: Array.from({ length: 25 }, (_, i) => `f${i}.txt`) }
    const capped = formatPreviewResult(target, many)
    assert.match(capped, /… and 5 more/)
    assert.equal((capped.match(/f\d+\.txt/gu) ?? []).length, 20)
  })
})

describe('stepEndSeqOf（/rewind step <N> 的 ≤N 边界）', () => {
  const events = [
    { type: 'turn/start', data: { turn: 1 }, seq: 0 },
    { type: 'step/start', data: { turn: 1, step: 1 }, seq: 1 },
    { type: 'step/end', data: { turn: 1, step: 1 }, seq: 2 },
    { type: 'step/start', data: { turn: 1, step: 2 }, seq: 3 },
    { type: 'step/end', data: { turn: 1, step: 2 }, seq: 4 },
    { type: 'turn/end', data: { turn: 1 }, seq: 5 },
    { type: 'turn/start', data: { turn: 2 }, seq: 6 },
    { type: 'step/start', data: { turn: 2, step: 1 }, seq: 7 },
    { type: 'step/end', data: { turn: 2, step: 1 }, seq: 8 },
  ]

  it('取全日志最近一条该步号的 step/end seq（步号按轮次重复）', () => {
    assert.equal(stepEndSeqOf(events, 1), 8)
    assert.equal(stepEndSeqOf(events, 2), 4)
  })

  it('该步号从未闭合 → undefined', () => {
    assert.equal(stepEndSeqOf(events, 3), undefined)
    assert.equal(stepEndSeqOf([], 1), undefined)
  })
})

describe('resolveRecordByPrefix（id 唯一前缀寻址）', () => {
  const records = [
    record({ id: 'a1b2c3d4-0000' }),
    record({ id: 'a1b2c3d4-1111' }),
  ]

  it('唯一前缀命中（大小写不敏感）', () => {
    const resolved = resolveRecordByPrefix(records, 'a1b2c3d4-0000')
    assert.equal(resolved.record?.id, 'a1b2c3d4-0000')
    assert.equal(resolveRecordByPrefix(records, 'A1B2C3D4-1').record?.id, 'a1b2c3d4-1111')
  })

  it('无匹配 → notFound', () => {
    assert.deepEqual(resolveRecordByPrefix(records, 'nope'), { notFound: true })
  })

  it('多匹配 → ambiguous 列出候选', () => {
    const resolved = resolveRecordByPrefix(records, 'a1b2')
    assert.deepEqual(resolved.ambiguous, ['a1b2c3d4-0000', 'a1b2c3d4-1111'])
  })
})

describe('formatBytes / formatCheckpointList', () => {
  it('字节数人类可读', () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(1023), '1023 B')
    assert.equal(formatBytes(2048), '2.0 KiB')
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MiB')
  })

  it('列表按最旧到最新渲染且包含关键字段', () => {
    const records = [
      record({ id: 'cp-1', time: 1700000000000, sessionBoundary: 12, kind: 'mutation', tree: null, config: {} }),
      record({ id: 'cp-2', time: 1700000001000, turn: 2, files: 1 }),
    ]
    const text = formatCheckpointList(records, { timeFormatter: () => 'T' })
    assert.match(text, /cp-1/)
    assert.match(text, /cp-2/)
    assert.match(text, /\(copy\)/)
    assert.match(text, /trigger: bash/)
    assert.match(text, /turn 1 step 1/)
    assert.match(text, /\[mutation\]/)
    assert.match(text, /tree: n\/a \(copy\)/)
    assert.match(text, /session: replay-ready/)
    assert.match(text, /session: fresh \(no closed turn yet\)/)
    assert.match(text, /\/rewind <id>/)
    assert.match(text, /workspace\|session\|config/)
    assert.ok(text.indexOf('cp-1') < text.indexOf('cp-2'), '最旧在前')
  })

  it('空列表给出明确提示', () => {
    assert.equal(formatCheckpointList([]), 'rewind: no checkpoints yet')
  })

  it('列表展示短 id（前 8 位，可作寻址前缀）', () => {
    const text = formatCheckpointList([record({ id: 'a1b2c3d4e5f6a7b8', time: 1700000000000 })], { timeFormatter: () => 'T' })
    assert.match(text, /#a1b2c3d4/)
    assert.ok(!text.includes('e5f6a7b8'), '列表不展示完整 id')
  })

  it('total 超过展示数时给出 older checkpoints 提示', () => {
    const text = formatCheckpointList([record({ id: 'cp-1' })], { timeFormatter: () => 'T', total: 7 })
    assert.match(text, /and 6 older checkpoint/)
    assert.equal(formatCheckpointList([record({ id: 'cp-1' })], { total: 1 }).includes('older'), false)
  })

  it('1 小时内的条目带相对时间后缀，更早的不带', () => {
    const now = 1700000000000
    const recent = formatCheckpointList([record({ id: 'cp-1', time: now - 60000 })], { timeFormatter: () => 'T', now })
    assert.match(recent, /T \(1 min ago\)/)
    const justNow = formatCheckpointList([record({ id: 'cp-1', time: now - 1000 })], { timeFormatter: () => 'T', now })
    assert.match(justNow, /T \(just now\)/)
    const old = formatCheckpointList([record({ id: 'cp-1', time: now - 3600000 })], { timeFormatter: () => 'T', now })
    assert.ok(!old.includes('ago'))
  })
})

describe('formatRelativeAge', () => {
  it('小于 1 分钟 just now；1 小时内 N min ago；超过 1 小时空串', () => {
    assert.equal(formatRelativeAge(30000), ' (just now)')
    assert.equal(formatRelativeAge(3 * 60000), ' (3 min ago)')
    assert.equal(formatRelativeAge(60 * 60000), '')
    assert.equal(formatRelativeAge(-1000), '')
  })
})
