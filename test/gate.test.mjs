// test/gate.test.mjs — 确认门（失败关闭矩阵）+ 会话事件自适应门。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { confirmRewind, hasOpenTurn, makeEventGate, maybeAppendSessionEvent, pickChannel } from '../lib/gate.mjs'

function fakeQuestions(answer) {
  return {
    calls: [],
    async ask(request) {
      this.calls.push(request)
      return answer(request)
    },
  }
}

function fakeApproval(outcome) {
  return {
    calls: [],
    async request(req) {
      this.calls.push(req)
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  }
}

const signal = new AbortController().signal
const deps = (ctx, confirmVia = 'auto') => ({ ctx, confirmVia, summary: 'summary-text' })
const agentInTurn = (events = [{ type: 'turn/start', data: { turn: 1 } }]) => ({ id: 'a1', session: { events } })

describe('pickChannel', () => {
  it('auto 优先 userQuestions、其次 approval、皆无 → none', () => {
    assert.equal(pickChannel('auto', { get: (n) => (n === 'userQuestions' ? {} : undefined) }), 'userQuestions')
    assert.equal(pickChannel('auto', { get: (n) => (n === 'approval' ? {} : undefined) }), 'approval')
    assert.equal(pickChannel('auto', { get: () => undefined }), 'none')
  })

  it('显式指定不再自动选择', () => {
    const ctx = { get: (n) => (n === 'userQuestions' ? {} : n === 'approval' ? {} : undefined) }
    assert.equal(pickChannel('userQuestions', ctx), 'userQuestions')
    assert.equal(pickChannel('approval', ctx), 'approval')
  })
})

describe('confirmRewind（userQuestions 通道）', () => {
  it('用户选择 Restore → 放行', async () => {
    const questions = fakeQuestions(() => ({ answers: [{ id: 'rewind-confirm', selected: ['Restore'] }] }))
    const verdict = await confirmRewind(deps({ get: (n) => (n === 'userQuestions' ? questions : undefined) }), agentInTurn(), signal)
    assert.equal(verdict.allowed, true)
    assert.equal(verdict.channel, 'userQuestions')
    assert.equal(questions.calls.length, 1)
    assert.equal(questions.calls[0].questions[0].id, 'rewind-confirm')
  })

  it('用户选择 Cancel → 拒绝', async () => {
    const questions = fakeQuestions(() => ({ answers: [{ id: 'rewind-confirm', selected: ['Cancel'] }] }))
    const verdict = await confirmRewind(deps({ get: () => questions }), agentInTurn(), signal)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /chose not to restore/)
  })

  it('自由文本回答不是批准 → 拒绝', async () => {
    const questions = fakeQuestions(() => ({ answers: [{ id: 'rewind-confirm', selected: [], custom: 'yes do it' }] }))
    const verdict = await confirmRewind(deps({ get: () => questions }), agentInTurn(), signal)
    assert.equal(verdict.allowed, false)
  })

  it('回答者抛错 → 失败关闭', async () => {
    const questions = fakeQuestions(() => { throw new Error('ui exploded') })
    const verdict = await confirmRewind(deps({ get: () => questions }), agentInTurn(), signal)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /ui exploded/)
  })

  it('无 userQuestions 服务 → 失败关闭', async () => {
    const verdict = await confirmRewind(deps({ get: () => undefined }, 'userQuestions'), agentInTurn(), signal)
    assert.equal(verdict.allowed, false)
    assert.equal(verdict.channel, 'userQuestions')
  })

  it('自定义 question/approveLabel（/rewind clear 复用面）', async () => {
    const questions = fakeQuestions(() => ({ answers: [{ id: 'rewind-confirm', selected: ['Delete'] }] }))
    const verdict = await confirmRewind(deps({ get: () => questions }, 'userQuestions'), agentInTurn(), signal)
    assert.equal(verdict.allowed, false, '默认 approveLabel=Restore，Delete 不放行')
    const custom = await confirmRewind({
      ctx: { get: () => questions },
      confirmVia: 'userQuestions',
      summary: 'clear summary',
      question: 'Delete all checkpoints for this session?',
      approveLabel: 'Delete',
      approveDescription: 'Discard all snapshot storage.',
    }, agentInTurn(), signal)
    assert.equal(custom.allowed, true)
    assert.equal(questions.calls[1].questions[0].question, 'Delete all checkpoints for this session?')
  })
})

describe('confirmRewind（approval 通道）', () => {
  it('开放轮次内 allowed-once → 放行', async () => {
    const approval = fakeApproval('allowed-once')
    const verdict = await confirmRewind(deps({ get: () => approval }, 'approval'), agentInTurn(), signal)
    assert.equal(verdict.allowed, true)
    assert.equal(approval.calls[0].toolName, 'rewind')
  })

  it('开放轮次内 rejected → 拒绝', async () => {
    const approval = fakeApproval('rejected')
    const verdict = await confirmRewind(deps({ get: () => approval }, 'approval'), agentInTurn(), signal)
    assert.equal(verdict.allowed, false)
  })

  it('无开放轮次（命令运行于轮次之间）→ 不调 request 直接失败关闭 + 可操作文案', async () => {
    const approval = fakeApproval('allowed-once')
    const closed = agentInTurn([{ type: 'turn/start', data: { turn: 1 } }, { type: 'turn/end', data: { turn: 1 } }])
    const verdict = await confirmRewind(deps({ get: () => approval }, 'approval'), closed, signal)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /approval requires an open turn/)
    assert.match(verdict.reason, /mount userQuestions/)
    assert.equal(approval.calls.length, 0, '绝不调用无轮次必抛的 approval.request')
  })

  it('开放轮次内 request 抛错 → 失败关闭', async () => {
    const approval = fakeApproval(new Error('no open turn'))
    const verdict = await confirmRewind(deps({ get: () => approval }, 'approval'), agentInTurn(), signal)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /no open turn/)
  })
})

describe('hasOpenTurn', () => {
  it('开放轮次检测（turn/start 未被 turn/end 闭合）', () => {
    assert.equal(hasOpenTurn([]), false)
    assert.equal(hasOpenTurn(undefined), false)
    assert.equal(hasOpenTurn([{ type: 'turn/start', data: { turn: 1 } }]), true)
    assert.equal(hasOpenTurn([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1 } },
      { type: 'turn/start', data: { turn: 2 } },
    ]), true)
  })
})

describe('confirmRewind（无回答者）', () => {
  it('任何回答者缺失 → 失败关闭', async () => {
    const verdict = await confirmRewind(deps({ get: () => undefined }), agentInTurn(), signal)
    assert.equal(verdict.allowed, false)
    assert.equal(verdict.channel, 'none')
  })
})

describe('会话事件自适应门', () => {
  it('宿主未收录的类型不 append（rc.2 持久化加载安全）', () => {
    const gate = makeEventGate(new Set(['known/type']))
    const appended = []
    const session = {
      append(type, data) {
        appended.push(type)
        return { type }
      },
    }
    const result = maybeAppendSessionEvent(session, 'checkpoint/snapshot', { id: 'x' }, gate, () => {})
    assert.equal(result, undefined)
    assert.deepEqual(appended, [])
  })

  it('宿主收录的类型正常 append', () => {
    const gate = makeEventGate(new Set(['checkpoint/snapshot']))
    const appended = []
    const session = {
      append(type, data) {
        const event = { type, data }
        appended.push(event)
        return event
      },
    }
    const result = maybeAppendSessionEvent(session, 'checkpoint/snapshot', { id: 'x' }, gate, () => {})
    assert.deepEqual(appended, [{ type: 'checkpoint/snapshot', data: { id: 'x' } }])
    assert.equal(result.type, 'checkpoint/snapshot')
  })

  it('append 抛错只警告不抛出（快照是旁路，绝不破坏会话）', () => {
    const gate = makeEventGate(new Set(['checkpoint/snapshot']))
    const warnings = []
    const session = {
      append() {
        throw new Error('append rejected')
      },
    }
    const result = maybeAppendSessionEvent(session, 'checkpoint/snapshot', { id: 'x' }, gate, (m) => warnings.push(m))
    assert.equal(result, undefined)
    assert.equal(warnings.length, 1)
  })

  it('session 缺失直接跳过', () => {
    const gate = makeEventGate(new Set(['checkpoint/snapshot']))
    assert.equal(maybeAppendSessionEvent(null, 'checkpoint/snapshot', {}, gate, () => {}), undefined)
  })

  it('宿主支持 ignorable 信封：未收录类型以 { ignorable: true } append（投影/审计链点亮）', () => {
    const gate = makeEventGate(new Set(['known/type']), true)
    const appended = []
    const session = {
      append(type, data, options) {
        const event = { type, data, ...(options?.ignorable === true ? { ignorable: true } : {}) }
        appended.push(event)
        return event
      },
    }
    const result = maybeAppendSessionEvent(session, 'checkpoint/snapshot', { id: 'x' }, gate, () => {})
    assert.deepEqual(appended, [{ type: 'checkpoint/snapshot', data: { id: 'x' }, ignorable: true }])
    assert.equal(result.ignorable, true)
  })

  it('宿主支持 ignorable 信封：已收录类型仍直接 append（不带信封）', () => {
    const gate = makeEventGate(new Set(['checkpoint/snapshot']), true)
    const appended = []
    const session = {
      append(type, data, options) {
        appended.push(options ?? null)
        return { type }
      },
    }
    maybeAppendSessionEvent(session, 'checkpoint/snapshot', { id: 'x' }, gate, () => {})
    assert.deepEqual(appended, [null], '已收录类型不带 ignorable 选项')
  })

  it('ignorable append 抛错（宿主拒绝未知选项）→ 只警告不抛出', () => {
    const gate = makeEventGate(new Set(['known/type']), true)
    const warnings = []
    const session = {
      append() {
        throw new Error('unknown append option')
      },
    }
    const result = maybeAppendSessionEvent(session, 'checkpoint/snapshot', { id: 'x' }, gate, (m) => warnings.push(m))
    assert.equal(result, undefined)
    assert.equal(warnings.length, 1)
  })
})
