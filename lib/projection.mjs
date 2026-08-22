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
  kind: z.enum(['manual', 'auto', 'guard', 'mutation']).optional(),
  triggerTool: z.string().min(1),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  tree: z.string().nullable().optional(),
  note: z.string().optional(),
  seq: z.number().int().nonnegative().optional(),
  stepEndSeq: z.number().int().nonnegative().optional(),
  sessionBoundary: z.number().int().nonnegative().optional(),
  rewindOutcome: z.enum(Object.values(REWIND_OUTCOMES)).optional(),
  preCheckpointId: z.string().min(1).optional(),
})

/** wire 载荷类型。 */
export const checkpointsWireSchemaList = z.array(checkpointWireSchema)

/** 投影单元状态：id → wire 记录（普通 JSON 对象，持久缓存前置条件）。 */
const init = () => ({})

/** 折叠状态 schema（rc.2 的 stateSchema：校验持久缓存里 id → wire 记录的内部状态）。 */
const stateSchema = z.record(checkpointWireSchema)

/**
 * 快照事件 → wire 记录（投影只关心 UI 需要的字段，其余丢弃）。
 * @param {object} data - checkpoint/snapshot 载荷（CheckpointRecord）。
 * @returns {object} wire 记录。
 */
function wireOf(data) {
  return {
    id: data.id,
    turn: data.turn,
    step: data.step,
    time: data.time,
    provider: data.provider,
    triggerTool: data.triggerTool,
    files: data.files,
    bytes: data.bytes,
    ...(data.kind === undefined ? {} : { kind: data.kind }),
    ...(data.tree === undefined || data.tree === null ? {} : { tree: data.tree }),
    ...(typeof data.note === 'string' && data.note.length > 0 ? { note: data.note } : {}),
    ...(typeof data.seq === 'number' ? { seq: data.seq } : {}),
    ...(data.stepEndSeq === undefined ? {} : { stepEndSeq: data.stepEndSeq }),
    ...(data.sessionBoundary === undefined ? {} : { sessionBoundary: data.sessionBoundary }),
  }
}

/**
 * 纯转移：上一状态 + 一条已提交事件 → 下一状态。
 * 无关事件必须原引用返回（Object.is），否则触发零收益的下游通知。
 * @param {object} state - 覆盖此前全部事件的状态。
 * @param {object} event - 下一条会话事件。
 * @returns {object} 下一状态（无关事件时同一引用）。
 */
function apply(state, event) {
  switch (event.type) {
    case SESSION_EVENTS.SNAPSHOT:
      return { ...state, [event.data.id]: wireOf(event.data) }
    case SESSION_EVENTS.BOUND: {
      const current = state[event.data.id]
      if (current === undefined) return state
      const patched = {
        ...current,
        ...(event.data.stepEndSeq === undefined ? {} : { stepEndSeq: event.data.stepEndSeq }),
      }
      return { ...state, [event.data.id]: patched }
    }
    case SESSION_EVENTS.PRUNE: {
      const ids = new Set(event.data.ids)
      if (!ids.size) return state
      if (![...ids].some(id => id in state)) return state
      const next = { ...state }
      for (const id of ids) delete next[id]
      return next
    }
    case SESSION_EVENTS.REWIND: {
      const current = state[event.data.checkpointId]
      if (current === undefined) return state
      const patched = {
        ...current,
        rewindOutcome: event.data.outcome,
        ...(event.data.preCheckpointId === undefined ? {} : { preCheckpointId: event.data.preCheckpointId }),
      }
      return { ...state, [event.data.checkpointId]: patched }
    }
    default:
      return state
  }
}

/**
 * 状态 → wire 载荷：按 (time, id) 升序的全量列表（最新在尾，UI 直接渲染）。
 * @param {object} state - 当前状态。
 * @returns {object[]} 检查点 wire 列表。
 */
function view(state) {
  return Object.values(state).sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * 'checkpoints' 投影单元（ProjectionDefinition，rc.2 契约）。
 * rc.2 拆分了 schema 与客户端 wire：`stateSchema` 校验持久缓存的折叠状态
 * （id → wire 记录），`wire.viewSchema` 校验离开宿主前的 view 输出；`view`
 * 收敛到 `wire` 内。`stateVersion` 为非负整数（必填，rc.2 注册时校验）。
 */
export const checkpointsProjectionDefinition = {
  key: 'checkpoints',
  stateSchema,
  stateVersion: 0,
  init,
  apply,
  wire: {
    viewSchema: checkpointsWireSchemaList,
    view,
  },
}

export { apply as applyCheckpointsProjection, view as viewCheckpointsProjection, init as initCheckpointsProjection }
