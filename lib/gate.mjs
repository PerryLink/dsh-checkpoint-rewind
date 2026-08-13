// lib/gate.mjs — 确认门 + 会话事件自适应门（零依赖）。

import { CONFIRM_APPROVE_LABEL, CONFIRM_CANCEL_LABEL, CONFIRM_CHANNELS, CONFIRM_QUESTION_ID } from './constants.mjs'

/**
 * 回退确认结果。
 * @typedef {object} ConfirmVerdict
 * @property {boolean} allowed - 是否放行（false 一律失败关闭）。
 * @property {string} channel - 'userQuestions'|'approval'|'none'。
 * @property {string} [reason] - 拒绝/不可用原因。
 */

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
 * @param {object} deps - {ctx, confirmVia, summary}：summary 为问题 detail 文本。
 * @param {object} agent - 命令所属 agent（userQuestions 路由 + approval 审计归属）。
 * @param {AbortSignal} signal - 取消信号（用户关闭 UI = cancelled）。
 * @returns {Promise<ConfirmVerdict>} 裁决。
 */
export async function confirmRewind(deps, agent, signal) {
  const channel = pickChannel(deps.confirmVia, deps.ctx)
  if (channel === CONFIRM_CHANNELS.USER_QUESTIONS) {
    const service = deps.ctx.get('userQuestions')
    if (service === undefined || typeof service.ask !== 'function') {
      return { allowed: false, channel, reason: 'no userQuestions answerer (fail closed)' }
    }
    try {
      const answer = await service.ask({
        questions: [{
          id: CONFIRM_QUESTION_ID,
          question: 'Restore the workspace files to this checkpoint and fork the session?',
          detail: deps.summary,
          options: [
            { label: CONFIRM_APPROVE_LABEL, description: 'Overwrite workspace files with the checkpoint content, then fork the session from its turn boundary.' },
            { label: CONFIRM_CANCEL_LABEL, description: 'Do nothing.' },
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
      if (selected.includes(CONFIRM_APPROVE_LABEL)) return { allowed: true, channel }
      return { allowed: false, channel, reason: 'user chose not to restore' }
    } catch (error) {
      return { allowed: false, channel, reason: `userQuestions ask failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  if (channel === CONFIRM_CHANNELS.APPROVAL) {
    const service = deps.ctx.get('approval')
    if (service === undefined || typeof service.request !== 'function') {
      return { allowed: false, channel, reason: 'no approval answerer (fail closed)' }
    }
    try {
      const outcome = await service.request({ agent, toolName: 'rewind', reason: deps.summary, signal })
      if (outcome === 'allowed-once') return { allowed: true, channel }
      return { allowed: false, channel, reason: `approval outcome ${JSON.stringify(outcome)}` }
    } catch (error) {
      // approval.request 在无开放轮次时抛错（命令运行于轮次之间）——失败关闭。
      return { allowed: false, channel, reason: `approval ask failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  return { allowed: false, channel: 'none', reason: 'no confirmation answerer available (fail closed)' }
}

/**
 * 会话事件自适应门：只有宿主构建的 KNOWN_SESSION_EVENT_TYPES 收录了该类型
 * 才 append（rc.6 无插件事件注册面，append 未收录类型会让会话下次加载被
 * 持久化层拒绝）。宿主未来收录 checkpoint/* 后自动开启。
 * @param {ReadonlySet<string>} knownTypes - KNOWN_SESSION_EVENT_TYPES。
 * @returns {(type: string) => boolean} 是否可 append。
 */
export function makeEventGate(knownTypes) {
  return (type) => knownTypes.has(type)
}

/**
 * 自适应 append：门通过才写会话事件；append 本身失败只警告绝不破坏会话。
 * @param {object|null|undefined} session - Session（缺失即跳过）。
 * @param {string} type - 事件类型。
 * @param {object} data - 载荷。
 * @param {(type: string) => boolean} gate - makeEventGate 产物。
 * @param {(message: string) => void} warn - 日志警告。
 * @returns {unknown} 已 append 事件或 undefined。
 */
export function maybeAppendSessionEvent(session, type, data, gate, warn) {
  if (session === null || session === undefined) return undefined
  if (!gate(type)) return undefined
  try {
    return session.append(type, data)
  } catch (error) {
    warn(`checkpoint session event ${type} append failed: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
