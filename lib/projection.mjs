// lib/projection.mjs — 会话投影单元 'checkpoints'（Web UI 检查点条的宿主侧锚点）。
//
// 折叠 checkpoint/snapshot|bound|prune|rewind 会话事件为全量检查点列表
// （wire 值是完整列表，last-write-wins 语义由事件自身保证）。领域只贡献纯数学
// （init/apply/view 全同步），驱动、水位缓存与变更流归 ctx.sessionProjections。
// 与 lib/domain.mjs 一样，本模块允许 zod（wire 载荷是持久边界校验器）。
//
// rc.2 现实：checkpoint/* 事件经自适应门（lib/gate.mjs）append，当前宿主构建
// 不收录这些类型，因此该单元在 rc.2 上恒为空列表；宿主收录词汇后无需改插件
// 即自动填充（ARCHITECTURE.md 的 TODO 锚点）。

import { z } from 'zod'
import { REWIND_OUTCOMES, SESSION_EVENTS } from './constants.mjs'

/**
 * 一条检查点的 wire 载荷（view 输出单元；进 Web 客户端前按此校验）。
 */
export const checkpointWireSchema = z.object({
  id: z.string().min(1),
  turn: z.number().int().positive(),
  step: z.number().int().positive(),
  time: z.number().int().nonnegative(),
  provider: z.enum(['git', 'copy']),
  // wireOf 恒输出 kind 与 seq（来源事件必填），与 SessionProjectionMap 契约一致。
  kind: z.enum(['manual', 'auto', 'guard', 'mutation']),
  triggerTool: z.string().min(1),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  tree: z.string().nullable().optional(),
  note: z.string().optional(),
  seq: z.number().int().nonnegative(),
  stepEndSeq: z.number().int().nonnegative().optional(),
  sessionBoundary: z.number().int().nonnegative().optional(),
  // 词汇与 REWIND_OUTCOMES 常量一致；字面量元组保持字面量推断（与 types.d.ts 契约同型）。
  rewindOutcome: z.enum(/** @type {['denied', 'failed', 'partial', 'restored']} */ ([
    REWIND_OUTCOMES.DENIED, REWIND_OUTCOMES.FAILED, REWIND_OUTCOMES.PARTIAL, REWIND_OUTCOMES.RESTORED,
  ])).optional(),
  preCheckpointId: z.string().min(1).optional(),
})

/** wire 载荷类型。 */
export const checkpointsWireSchemaList = z.array(checkpointWireSchema)

/**
 * 投影单元状态（id → wire 记录）与 wire 输出类型（与 types.d.ts 契约一致）。
 * @typedef {import('../types.d.ts').CheckpointWireRecord} CheckpointWireRecord
 * @typedef {Record<string, CheckpointWireRecord>} CheckpointProjectionState
 */

/** 投影单元状态：id → wire 记录（普通 JSON 对象，持久缓存前置条件）。 */
/** @type {() => CheckpointProjectionState} */
const init = () => ({})

/** 折叠状态 schema（rc.2 的 stateSchema：校验持久缓存里 id → wire 记录的内部状态）。 */
const stateSchema = z.record(z.string(), checkpointWireSchema)

/**
 * 快照事件 → wire 记录（投影只关心 UI 需要的字段，其余丢弃）。
 * @param {import('../types.d.ts').CheckpointRecord} data - checkpoint/snapshot 载荷。
 * @returns {CheckpointWireRecord} wire 记录。
 */
function wireOf(data) {
  return {
    id: data.id,
    turn: data.turn,
    step: data.step,
    time: data.time,
    provider: data.provider,
    // 防御旧事件缺 kind（v1 兼容介质时代）：回落 'mutation'（与列表渲染同款兜底）。
    kind: data.kind ?? 'mutation',
    triggerTool: data.triggerTool,
    files: data.files,
    bytes: data.bytes,
    seq: data.seq,
    ...(data.tree === undefined || data.tree === null ? {} : { tree: data.tree }),
    ...(typeof data.note === 'string' && data.note.length > 0 ? { note: data.note } : {}),
    ...(data.stepEndSeq === undefined ? {} : { stepEndSeq: data.stepEndSeq }),
    ...(data.sessionBoundary === undefined ? {} : { sessionBoundary: data.sessionBoundary }),
  }
}

/**
 * 纯转移：上一状态 + 一条已提交事件 → 下一状态。
 * 无关事件必须原引用返回（Object.is），否则触发零收益的下游通知。
 * @param {CheckpointProjectionState} state - 覆盖此前全部事件的状态。
 * @param {{type: string, data: object}} event - 下一条会话事件（测试直接合成）。
 * @returns {CheckpointProjectionState} 下一状态（无关事件时同一引用）。
 */
function apply(state, event) {
  switch (event.type) {
    case SESSION_EVENTS.SNAPSHOT: {
      const data = /** @type {import('../types.d.ts').CheckpointRecord} */ (event.data)
      return { ...state, [data.id]: wireOf(data) }
    }
    case SESSION_EVENTS.BOUND: {
      const data = /** @type {{id: string, stepEndSeq?: number}} */ (event.data)
      const current = state[data.id]
      if (current === undefined) return state
      const patched = {
        ...current,
        ...(data.stepEndSeq === undefined ? {} : { stepEndSeq: data.stepEndSeq }),
      }
      return { ...state, [data.id]: patched }
    }
    case SESSION_EVENTS.PRUNE: {
      const data = /** @type {{ids: string[]}} */ (event.data)
      const ids = new Set(data.ids)
      if (!ids.size) return state
      if (![...ids].some(id => id in state)) return state
      const next = { ...state }
      for (const id of ids) delete next[id]
      return next
    }
    case SESSION_EVENTS.REWIND: {
      const data = /** @type {{checkpointId: string, outcome?: 'denied'|'failed'|'partial'|'restored', preCheckpointId?: string}} */ (event.data)
      const current = state[data.checkpointId]
      if (current === undefined) return state
      const patched = {
        ...current,
        rewindOutcome: data.outcome,
        ...(data.preCheckpointId === undefined ? {} : { preCheckpointId: data.preCheckpointId }),
      }
      return { ...state, [data.checkpointId]: patched }
    }
    default:
      return state
  }
}

/**
 * 状态 → wire 载荷：按 (time, id) 升序的全量列表（最新在尾，UI 直接渲染）。
 * @param {CheckpointProjectionState} state - 当前状态。
 * @returns {CheckpointWireRecord[]} 检查点 wire 列表。
 */
function view(state) {
  return Object.values(state).sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * 'checkpoints' 投影单元（ProjectionDefinition，rc.2 契约）。
 * rc.2 拆分了 schema 与客户端 wire：`stateSchema` 校验持久缓存的折叠状态
 * （id → wire 记录），`wire.viewSchema` 校验离开宿主前的 view 输出；`view`
 * 收敛到 `wire` 内。`stateVersion` 为非负整数（必填，rc.2 注册时校验）。
 * 注意：不在此处给整对象加 ProjectionDefinition 注解——wire 在接口里可选，
 * 注解会把 wire 变成可选从而不再满足 register 的 wire-required 交集；由
 * register 调用点按契约校验（key 用 const 断言保住字面量）。
 */
export const checkpointsProjectionDefinition = {
  key: /** @type {const} */ ('checkpoints'),
  // zod 具体 schema 类型（ZodRecord/ZodArray 的 Def 形参）与契约的
  // ZodType<S>（默认 Def）在类泛型不变性下不可直接赋值：运行时语义不变，
  // 类型上按契约收窄。
  stateSchema: /** @type {import('zod').ZodType<CheckpointProjectionState>} */ (/** @type {unknown} */ (stateSchema)),
  stateVersion: 0,
  init,
  apply,
  wire: {
    viewSchema: /** @type {import('zod').ZodType<CheckpointWireRecord[]>} */ (/** @type {unknown} */ (checkpointsWireSchemaList)),
    view,
  },
}

export { apply as applyCheckpointsProjection, view as viewCheckpointsProjection, init as initCheckpointsProjection }
