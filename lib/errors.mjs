// lib/errors.mjs — 结构化领域错误（code + details，零依赖）。

import { ERROR_CODES } from './constants.mjs'

/**
 * 插件领域错误基类：稳定 code 供 UI/日志路由，details 携带机器可读事实。
 */
export class RewindError extends Error {
  /**
   * @param {string} code - ERROR_CODES 之一。
   * @param {string} message - 面向用户的说明。
   * @param {object} [details] - 可选结构化事实。
   */
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'RewindError'
    this.code = code
    this.details = details
  }
}

/**
 * 配置非法（加载期响亮失败用）。
 * @param {string} message - 具体非法项说明。
 * @returns {RewindError} code=BAD_CONFIG。
 */
export function badConfig(message) {
  return new RewindError(ERROR_CODES.BAD_CONFIG, `dsh-checkpoint-rewind config: ${message}`)
}

/**
 * provider 不可用（auto 降级也失败、或显式指定的 provider 不能服务该工作区）。
 * @param {string} provider - provider 名。
 * @param {string} reason - 不可用原因。
 * @returns {RewindError} code=PROVIDER_UNAVAILABLE。
 */
export function providerUnavailable(provider, reason) {
  return new RewindError(ERROR_CODES.PROVIDER_UNAVAILABLE, `snapshot provider "${provider}" unavailable: ${reason}`, { provider, reason })
}

/**
 * provider 执行失败（快照/恢复/清理中途抛错）。
 * @param {string} provider - provider 名。
 * @param {string} operation - snapshot|restore|discard|available。
 * @param {unknown} cause - 底层错误。
 * @returns {RewindError} code=PROVIDER_FAILED。
 */
export function providerFailed(provider, operation, cause) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new RewindError(ERROR_CODES.PROVIDER_FAILED, `snapshot provider "${provider}" ${operation} failed: ${message}`, { provider, operation, message })
}

/**
 * 检查点注册表（存储领域）不可用。
 * @param {string} reason - 打开/读取失败原因。
 * @returns {RewindError} code=REGISTRY_UNAVAILABLE。
 */
export function registryUnavailable(reason) {
  return new RewindError(ERROR_CODES.REGISTRY_UNAVAILABLE, `checkpoint registry unavailable: ${reason}`, { reason })
}

/**
 * 检查点 id 不存在或不属于当前会话/工作区。
 * @param {string} id - 用户输入的 id。
 * @returns {RewindError} code=CHECKPOINT_NOT_FOUND。
 */
export function checkpointNotFound(id) {
  return new RewindError(ERROR_CODES.CHECKPOINT_NOT_FOUND, `unknown checkpoint id "${id}" (run /rewind to list)`, { id })
}

/**
 * 回退被拒绝（确认通道拒绝 / 无回答者失败关闭）。
 * @param {string} reason - 拒绝或不可用原因。
 * @returns {RewindError} code=REWIND_DENIED。
 */
export function rewindDenied(reason) {
  return new RewindError(ERROR_CODES.REWIND_DENIED, `rewind cancelled: ${reason}`, { reason })
}

/**
 * fork 失败（文件已恢复，会话未派生）。
 * @param {string} reason - fork 失败原因。
 * @returns {RewindError} code=FORK_FAILED。
 */
export function forkFailed(reason) {
  return new RewindError(ERROR_CODES.FORK_FAILED, reason, { reason })
}

/**
 * 任意值 → 稳定消息文本（日志/结果用，不信任其字符串转换）。
 * @param {unknown} error - 任意抛出的值。
 * @returns {string} 消息文本。
 */
export function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
