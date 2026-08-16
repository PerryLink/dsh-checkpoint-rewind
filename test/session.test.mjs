// test/session.test.mjs — 会话游标/重放边界纯函数（三态之一：会话态）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { replaySeedOf, sessionBoundaryAt, sessionDelta, turnAt } from '../lib/session.mjs'

/** 合成事件日志：turn 1（含闭合）+ turn 2（开放）。 */
const events = [
  { type: 'turn/start', data: { turn: 1 }, seq: 0 },
  { type: 'step/start', data: { turn: 1, step: 1 }, seq: 1 },
  { type: 'step/end', data: { turn: 1, step: 1 }, seq: 2 },
  { type: 'turn/end', data: { turn: 1 }, seq: 3 },
  { type: 'turn/start', data: { turn: 2 }, seq: 4 },
  { type: 'step/start', data: { turn: 2, step: 1 }, seq: 5 },
]

describe('sessionBoundaryAt（游标处及之前最近一条 turn/end）', () => {
  it('游标落在开放轮次内 → 上一个闭合轮的 turn/end（CC 语义：回到该轮之前）', () => {
    assert.equal(sessionBoundaryAt(events, 5), 3)
  })

  it('游标恰在轮次之间（turn/end 上）→ 该 turn/end', () => {
    assert.equal(sessionBoundaryAt(events, 3), 3)
  })

  it('首轮（无任何闭合轮）→ undefined', () => {
    assert.equal(sessionBoundaryAt(events.slice(0, 3), 2), undefined)
    assert.equal(sessionBoundaryAt([], 0), undefined)
  })
})

describe('replaySeedOf（重放种子）', () => {
  it('边界存在 → [0, boundary] 稳定前缀（含 turn/end，结束于轮次之间）', () => {
    const seed = replaySeedOf(events, 3)
    assert.equal(seed.length, 4)
    assert.equal(seed.at(-1).type, 'turn/end')
    assert.deepEqual(seed, events.slice(0, 4))
  })

  it('无边界 → 空种子（全新上下文，仅保留血缘）', () => {
    assert.deepEqual(replaySeedOf(events, undefined), [])
  })
})

describe('turnAt（游标所在轮）', () => {
  it('开放轮次内 → 当前轮；轮次之间 → 最近闭合轮', () => {
    assert.equal(turnAt(events, 5), 2)
    assert.equal(turnAt(events, 3), 1)
  })
})

describe('sessionDelta（两两对比的会话差）', () => {
  it('计算游标/turn/step 差与回退丢弃事件数', () => {
    const delta = sessionDelta(
      { seq: 3, turn: 1, step: 1 },
      { seq: 7, turn: 2, step: 3 },
    )
    assert.deepEqual(delta, {
      fromSeq: 3, toSeq: 7, fromTurn: 1, fromStep: 1, toTurn: 2, toStep: 3, dropped: 4,
    })
  })

  it('turn/step 缺失时回退 undefined', () => {
    const delta = sessionDelta({ seq: 1 }, { seq: 1 })
    assert.deepEqual(delta, {
      fromSeq: 1, toSeq: 1, fromTurn: undefined, fromStep: undefined, toTurn: undefined, toStep: undefined, dropped: 0,
    })
  })
})
