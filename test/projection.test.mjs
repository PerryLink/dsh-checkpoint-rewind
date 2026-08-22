// test/projection.test.mjs — 会话投影单元 'checkpoints'：纯折叠 + 真注册表接线。
//
// 真注册表测试用合成事件直接 append 到真实 Session（绕过自适应门，因为
// 投影单元本就只消费事件、不生产事件），证明宿主收录词汇后 UI 检查点条
// 无需改插件即被填充。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import {
  applyCheckpointsProjection,
  checkpointsProjectionDefinition,
  initCheckpointsProjection,
  viewCheckpointsProjection,
} from '../lib/projection.mjs'
import { mountPlugin } from './helpers/ctx-harness.mjs'

const snapshotEvent = (data) => ({ type: 'checkpoint/snapshot', data })
const boundStep = (data) => ({ type: 'checkpoint/bound', data })
const prune = (ids, reason = 'maxSnapshots') => ({ type: 'checkpoint/prune', data: { ids, reason } })
const rewind = (checkpointId, outcome) => ({ type: 'checkpoint/rewind', data: { checkpointId, sessionId: 's1', outcome } })

function record(overrides = {}) {
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
    ref: 'ref',
    ...overrides,
  }
}

describe('checkpoints 投影单元（纯折叠）', () => {
  it('init 为空对象；无关事件原引用返回', () => {
    const state = initCheckpointsProjection()
    assert.deepEqual(state, {})
    const after = applyCheckpointsProjection(state, { type: 'turn/start', data: { turn: 1 } })
    assert.equal(after, state, '无关事件必须原引用返回')
  })

  it('snapshot 添加记录；bound 补 stepEndSeq；rewind 记 outcome；prune 删除', () => {
    let state = initCheckpointsProjection()
    state = applyCheckpointsProjection(state, snapshotEvent(record({ kind: 'manual', tree: null, note: '发布前', sessionBoundary: 9 })))
    assert.deepEqual(viewCheckpointsProjection(state), [{
      id: 'cp-1', turn: 1, step: 1, time: 1000, provider: 'copy', triggerTool: 'bash', files: 2, bytes: 4096,
      kind: 'manual', note: '发布前', seq: 10, sessionBoundary: 9,
    }])
    state = applyCheckpointsProjection(state, boundStep({ id: 'cp-1', turn: 1, step: 1, stepEndSeq: 12 }))
    state = applyCheckpointsProjection(state, rewind('cp-1', 'restored'))
    assert.deepEqual(viewCheckpointsProjection(state), [{
      id: 'cp-1', turn: 1, step: 1, time: 1000, provider: 'copy', triggerTool: 'bash', files: 2, bytes: 4096,
      kind: 'manual', note: '发布前', seq: 10, sessionBoundary: 9,
      stepEndSeq: 12, rewindOutcome: 'restored',
    }])
    state = applyCheckpointsProjection(state, prune(['cp-1']))
    assert.deepEqual(viewCheckpointsProjection(state), [])
  })

  it('未知 id 的 bound/rewind/prune 是安全 no-op', () => {
    let state = initCheckpointsProjection()
    state = applyCheckpointsProjection(state, snapshotEvent(record({ id: 'cp-1' })))
    const before = state
    state = applyCheckpointsProjection(state, boundStep({ id: 'nope', turn: 1, step: 1, stepEndSeq: 12 }))
    assert.equal(state, before, '未知 id 的 bound 原引用返回')
    state = applyCheckpointsProjection(state, rewind('nope', 'denied'))
    assert.equal(state, before, '未知 id 的 rewind 原引用返回')
    state = applyCheckpointsProjection(state, prune(['nope']))
    assert.equal(state, before, '只删未知 id 时原引用返回')
  })

  it('view 按 (time, id) 升序（最新在尾）', () => {
    let state = initCheckpointsProjection()
    state = applyCheckpointsProjection(state, snapshotEvent(record({ id: 'b', time: 2000, turn: 2 })))
    state = applyCheckpointsProjection(state, snapshotEvent(record({ id: 'a', time: 1000, turn: 1 })))
    assert.deepEqual(viewCheckpointsProjection(state).map((entry) => entry.id), ['a', 'b'])
  })

  it('wire schema 校验 view 输出；stateSchema 校验折叠状态', () => {
    let state = initCheckpointsProjection()
    state = applyCheckpointsProjection(state, snapshotEvent(record()))
    const view = viewCheckpointsProjection(state)
    const parsed = checkpointsProjectionDefinition.wire.viewSchema.safeParse(view)
    assert.equal(parsed.success, true)
    // rc.2 契约：stateSchema 校验持久缓存的内部状态（id → wire 记录）。
    const stateParsed = checkpointsProjectionDefinition.stateSchema.safeParse(state)
    assert.equal(stateParsed.success, true)
    assert.equal(checkpointsProjectionDefinition.stateVersion, 0, 'stateVersion 必填且为非负整数')
  })
})

describe('checkpoints 投影单元（真注册表接线）', () => {
  it('插件在注册表存在时注册单元；合成事件驱动后 snapshot 包含 checkpoints', async () => {
    const root = new Context()
    const fibers = []
    const mount = async (plugin, config) => { fibers.push(await root.plugin(plugin, config)) }
    const { facility, records } = await import('./helpers/ctx-harness.mjs').then((m) => m.makeDomainFacility())
    root.provide('storageDomain', facility)
    await mount(SessionStore)
    await mount(SessionProjectionRegistry)
    await import('@deepseek-ai/dsh-commands').then(async ({ default: CommandRuntime }) => mount(CommandRuntime))
    const plugin = await import('../index.mjs')
    await mount({ name: plugin.name, inject: plugin.inject, apply: (ctx) => plugin.apply(ctx, { provider: 'copy', snapshotDir: path.resolve('/tmp', 'unused') }) })

    const session = root.sessions.create(SessionId('proj-session'), { meta: { cwd: path.resolve('/work') } })
    // 合成事件直接 append（绕过自适应门：投影只消费、不生产）。
    session.append('checkpoint/snapshot', record({ id: 'cp-1', sessionBoundary: 5 }))
    session.append('checkpoint/bound', { id: 'cp-1', turn: 1, step: 1, stepEndSeq: 12 })
    session.append('checkpoint/snapshot', record({ id: 'cp-2', time: 2000, turn: 2, step: 1 }))

    const snapshot = root.sessionProjections.snapshot(session)
    const list = snapshot.values.checkpoints
    assert.ok(Array.isArray(list), 'checkpoints 键由本单元供给')
    assert.deepEqual(list.map((entry) => entry.id), ['cp-1', 'cp-2'])
    assert.equal(list[0].stepEndSeq, 12)
    assert.equal(list[0].sessionBoundary, 5)

    for (const fiber of fibers.reverse()) await fiber.dispose()
  })

  it('无 sessionProjections 注册表的组装不受影响（headless 兼容）', async () => {
    // mountPlugin 不提供 sessionProjections —— 插件应正常挂载并注册 /rewind。
    const app = await mountPlugin({})
    const listed = app.root.commands.list(app.agent)
    assert.ok(listed.some((entry) => entry.name === 'rewind'))
    await app.dispose()
  })
})
