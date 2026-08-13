// test/checkpoints.test.mjs — 检查点纯函数：≤N 映射、清理计划、列表渲染。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatBytes,
  formatCheckpointList,
  nearestCheckpointAtOrBefore,
  prunePlan,
  sortOldestFirst,
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
      record({ id: 'cp-1', time: 1700000000000, forkSeq: 12 }),
      record({ id: 'cp-2', time: 1700000001000, turn: 2, files: 1 }),
    ]
    const text = formatCheckpointList(records, { timeFormatter: () => 'T' })
    assert.match(text, /cp-1/)
    assert.match(text, /cp-2/)
    assert.match(text, /\(copy\)/)
    assert.match(text, /trigger: bash/)
    assert.match(text, /turn 1 step 1/)
    assert.match(text, /fork: ready/)
    assert.match(text, /fork: pending \(turn not closed\)/)
    assert.match(text, /\/rewind <id>/)
    assert.ok(text.indexOf('cp-1') < text.indexOf('cp-2'), '最旧在前')
  })

  it('空列表给出明确提示', () => {
    assert.equal(formatCheckpointList([]), 'rewind: no checkpoints yet')
  })
})
