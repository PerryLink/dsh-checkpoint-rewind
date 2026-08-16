// lib/session.mjs — 会话事件游标与重放边界纯函数（零依赖）。
//
// 一体化 checkpoint 的会话态 = 事件游标（record.seq）+ 重放边界
// （record.sessionBoundary）。边界规则（CC /rewind 语义）：
// - 游标落在轮次之间（手动检查点，命令运行于轮次之间）→ 边界 = 该轮 turn/end；
// - 游标落在开放轮次内（自动/变更前检查点）→ 边界 = 上一个闭合轮的 turn/end，
//   即"回到该轮之前"（CC Checkpoints 的回退语义）；
// - 尚无任何闭合轮（首轮）→ 无边界：重放种子为空（全新子会话）。
// 官方会话重放面：`sessions.create(id, { seed, meta })` 接受从 seq 0 连续的
// 事件前缀，且允许结束于轮次之间（`sessions.fork` 的 OPEN_TURN 限制只约束
// fork 原语，不约束 seed 重放）。

/**
 * 事件游标处（含）之前最近一条 turn/end 的 seq（会话重放边界）。
 * @param {Array<{type: string, seq: number}>} events - 会话事件日志。
 * @param {number} cursor - 捕获时的会话事件游标（record.seq）。
 * @returns {number|undefined} turn/end seq；游标之前无闭合轮时为 undefined。
 */
export function sessionBoundaryAt(events, cursor) {
  let boundary
  for (const event of events) {
    if (event.seq > cursor) break
    if (event.type === 'turn/end') boundary = event.seq
  }
  return boundary
}

/**
 * 重放种子事件：边界存在时取 [0, boundary]（含 turn/end 的稳定前缀，
 * 结束于轮次之间）；无边界时为空数组（全新上下文，仅保留血缘）。
 * @param {Array<object>} events - 会话事件日志（元素含 seq）。
 * @param {number|undefined} boundary - sessionBoundaryAt 的结果。
 * @returns {object[]} 可交给 sessions.create({seed}) 的事件前缀。
 */
export function replaySeedOf(events, boundary) {
  if (typeof boundary !== 'number') return []
  return events.slice(0, boundary + 1)
}

/**
 * 游标所在 turn（列表/摘要渲染：CC 式"turn N"）。
 * @param {Array<{type: string, data?: {turn?: number}}>} events - 会话事件日志。
 * @param {number} cursor - 捕获时的会话事件游标。
 * @returns {number|undefined} 最近一条 turn/start 的 turn 号。
 */
export function turnAt(events, cursor) {
  let turn
  for (const event of events) {
    if (event.seq > cursor) break
    if (event.type === 'turn/start') turn = event.data?.turn
  }
  return turn
}

/**
 * 会话游标差摘要（两两对比/回滚预览共用）：
 * "游标 a → b，turn Ta step Sa → turn Tb step Sb，回退 b→a 将丢弃 N 条事件"。
 * @param {{seq: number, turn?: number, step?: number}} from - 旧检查点。
 * @param {{seq: number, turn?: number, step?: number}} to - 新检查点。
 * @returns {object} {fromSeq, toSeq, fromTurn, fromStep, toTurn, toStep, dropped}。
 */
export function sessionDelta(from, to) {
  const turn = (record, fallback) => (typeof record.turn === 'number' ? record.turn : fallback)
  const step = (record, fallback) => (typeof record.step === 'number' ? record.step : fallback)
  return {
    fromSeq: from.seq,
    toSeq: to.seq,
    fromTurn: turn(from, undefined),
    fromStep: step(from, undefined),
    toTurn: turn(to, undefined),
    toStep: step(to, undefined),
    dropped: Math.max(0, to.seq - from.seq),
  }
}
