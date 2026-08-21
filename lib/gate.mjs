// lib/gate.mjs — 确认门 + 会话事件自适应门（零依赖）。

import { CONFIRM_APPROVE_LABEL, CONFIRM_CANCEL_LABEL, CONFIRM_CHANNELS, CONFIRM_QUESTION_ID } from './constants.mjs'

/**
 * 回退确认结果。
 * @typedef {object} ConfirmVerdict
 * @property {boolean} allowed - 是否放行（false 一律失败关闭）。
 * @property {string} channel - 'userQuestions'|'approval'|'none'。
 * @property {string} [reason] - 拒绝/不可用原因。
 */

/** 确认问题与选项的默认文案（confirmRewind 可整体覆盖，/rewind clear 复用）。 */
export const DEFAULT_CONFIRM_TEXT = Object.freeze({
  question: 'Restore the workspace files to this checkpoint and fork the session?',
  approveLabel: CONFIRM_APPROVE_LABEL,
  approveDescription: 'Overwrite workspace files with the checkpoint content, then fork the session from its turn boundary.',
  cancelLabel: CONFIRM_CANCEL_LABEL,
})

/**
 * 会话当前是否有开放轮次（last turn/start 未被 turn/end 闭合）。
 * @param {Array<{type: string, data?: object}>} [events] - 会话事件。
 * @returns {boolean} 有开放轮次。
 */
export function hasOpenTurn(events) {
  let open = false
  for (const event of events ?? []) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return open
}

/**
 * 选择确认通道：Config.confirmVia 显式指定，'auto' 优先 userQuestions、
 * 其次 approval；两者皆无 → 'none'（失败关闭）。
 * @param {string} confirmVia - CONFIRM_CHANNELS 之一。
 * @param {{get: (name: string) => unknown}} ctx - Cordis ctx（可选服务查找）。
 * @returns {string} 通道名。
 */
export function pickChannel(confirmVia, ctx) {
  if (confirmVia === CONFIRM_CHANNELS.USER_QUESTIONS) return CONFIRM_CHANNELS.USER_QUESTIONS
  if (confirmVia === CONFIRM_CHANNELS.APPROVAL) return CONFIRM_CHANNELS.APPROVAL
  if (ctx.get('userQuestions') !== undefined) return CONFIRM_CHANNELS.USER_QUESTIONS
  if (ctx.get('approval') !== undefined) return CONFIRM_CHANNELS.APPROVAL
  return 'none'
}

/**
 * 向用户确认一次覆盖性回退。任何回答者缺失/抛错/取消 → allowed=false（失败关闭）。
 * approval 通道要求会话有开放轮次：命令运行于轮次之间（宿主 commands 不包
 * turn），无开放轮次时直接失败关闭并给出可操作原因，不调 approval.request。
 * @param {object} deps - {ctx, confirmVia, summary} + 可选 question/approveLabel/
 *   approveDescription/cancelLabel（默认 DEFAULT_CONFIRM_TEXT）。
 * @param {object} agent - 命令所属 agent（userQuestions 路由 + approval 审计归属）。
 * @param {AbortSignal} signal - 取消信号（用户关闭 UI = cancelled）。
 * @returns {Promise<ConfirmVerdict>} 裁决。
 */
export async function confirmRewind(deps, agent, signal) {
  const channel = pickChannel(deps.confirmVia, deps.ctx)
  const text = {
    question: deps.question ?? DEFAULT_CONFIRM_TEXT.question,
    approveLabel: deps.approveLabel ?? DEFAULT_CONFIRM_TEXT.approveLabel,
    approveDescription: deps.approveDescription ?? DEFAULT_CONFIRM_TEXT.approveDescription,
    cancelLabel: deps.cancelLabel ?? DEFAULT_CONFIRM_TEXT.cancelLabel,
  }
  if (channel === CONFIRM_CHANNELS.USER_QUESTIONS) {
    const service = deps.ctx.get('userQuestions')
    if (service === undefined || typeof service.ask !== 'function') {
      return { allowed: false, channel, reason: 'no userQuestions answerer (fail closed)' }
    }
    try {
      const answer = await service.ask({
        questions: [{
          id: CONFIRM_QUESTION_ID,
          question: text.question,
          detail: deps.summary,
          options: [
            { label: text.approveLabel, description: text.approveDescription },
            { label: text.cancelLabel, description: 'Do nothing.' },
          ],
        }],
        agent,
        signal,
      })
      const item = answer?.answers?.find(entry => entry.id === CONFIRM_QUESTION_ID)
      const selected = Array.isArray(item?.selected) ? item.selected : []
      const custom = typeof item?.custom === 'string' && item.custom.length > 0 ? item.custom : undefined
      if (custom !== undefined) {
        return { allowed: false, channel, reason: 'free-text answer is not an approval' }
      }
      if (selected.includes(text.approveLabel)) return { allowed: true, channel }
      return { allowed: false, channel, reason: 'user chose not to restore' }
    } catch (error) {
      return { allowed: false, channel, reason: `userQuestions ask failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  if (channel === CONFIRM_CHANNELS.APPROVAL) {
    // 宿主的 approval.request 无开放轮次即抛（审计对必须包在 turn 内），
    // 而 /rewind 命令运行于轮次之间：这里前置检测并给出可操作文案。
    if (!hasOpenTurn(agent?.session?.events)) {
      return {
        allowed: false,
        channel,
        reason: 'approval requires an open turn; /rewind commands run between turns — mount userQuestions or set confirmVia: userQuestions',
      }
    }
    const service = deps.ctx.get('approval')
    if (service === undefined || typeof service.request !== 'function') {
      return { allowed: false, channel, reason: 'no approval answerer (fail closed)' }
    }
    try {
      const outcome = await service.request({ agent, toolName: 'rewind', reason: deps.summary, signal })
      if (outcome === 'allowed-once') return { allowed: true, channel }
      return { allowed: false, channel, reason: `approval outcome ${JSON.stringify(outcome)}` }
    } catch (error) {
      return { allowed: false, channel, reason: `approval ask failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  return { allowed: false, channel: 'none', reason: 'no confirmation answerer available (fail closed)' }
}

/**
 * 会话事件自适应门：决策函数返回是否 append 以及是否带 ignorable 信封。
 * 宿主 KNOWN_SESSION_EVENT_TYPES 收录的类型直接 append；未收录但宿主 append
 * 支持 ignorable 信封（运行时探测，见 index.mjs 的 probeIgnorableAppend）时
 * 以 { ignorable: true } append；其余拒绝（rc.8：未收录类型落盘会让会话下次
 * 加载被持久化层拒绝）。
 * @param {ReadonlySet<string>} knownTypes - KNOWN_SESSION_EVENT_TYPES。
 * @param {boolean} [ignorableAppend] - 宿主 append 是否盖章 ignorable 信封。
 * @returns {(type: string) => {append: boolean, ignorable: boolean}} 决策函数。
 */
export function makeEventGate(knownTypes, ignorableAppend = false) {
  return (type) => {
    if (knownTypes.has(type)) return { append: true, ignorable: false }
    if (ignorableAppend) return { append: true, ignorable: true }
    return { append: false, ignorable: false }
  }
}

/**
 * 自适应 append：门通过才写会话事件；append 本身失败只警告绝不破坏会话。
 * @param {object|null|undefined} session - Session（缺失即跳过）。
 * @param {string} type - 事件类型。
 * @param {object} data - 载荷。
 * @param {(type: string) => {append: boolean, ignorable: boolean}} gate - makeEventGate 产物。
 * @param {(message: string) => void} warn - 日志警告。
 * @returns {unknown} 已 append 事件或 undefined。
 */
export function maybeAppendSessionEvent(session, type, data, gate, warn) {
  if (session === null || session === undefined) return undefined
  const decision = gate(type)
  if (!decision.append) return undefined
  try {
    return session.append(type, data, decision.ignorable ? { ignorable: true } : undefined)
  } catch (error) {
    warn(`checkpoint session event ${type} append failed: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
