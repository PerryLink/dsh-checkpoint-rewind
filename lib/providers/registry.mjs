// lib/providers/registry.mjs — provider 注册表（register 返回 disposer）。

import { PROVIDERS, PROVIDER_MODES } from '../constants.mjs'
import { badConfig, providerUnavailable } from '../errors.mjs'

/**
 * 快照 provider 注册表：持有 git/copy 两个 provider（各由 ctx.effect 注册），
 * 消费方按 Config.provider 解析要用的 provider，绝不硬编码 git 路径。
 */
export class SnapshotProviderRegistry {
  /** @type {Map<string, import('./definition.mjs').SnapshotProvider>} */
  #providers = new Map()

  /**
   * 注册一个 provider（同名重复注册响亮报错）。返回精确撤销 disposer。
   * @param {import('./definition.mjs').SnapshotProvider} provider - provider 实例。
   * @returns {() => void} 注销函数。
   */
  register(provider) {
    if (typeof provider?.name !== 'string' || provider.name.length === 0) {
      throw new Error('snapshot provider registration requires a non-empty name')
    }
    if (this.#providers.has(provider.name)) {
      throw new Error(`snapshot provider "${provider.name}" is already registered`)
    }
    this.#providers.set(provider.name, provider)
    return () => {
      this.#providers.delete(provider.name)
    }
  }

  /**
   * 按名字取 provider（可能未注册）。
   * @param {string} name - provider 名。
   * @returns {import('./definition.mjs').SnapshotProvider|undefined} provider。
   */
  get(name) {
    return this.#providers.get(name)
  }

  /**
   * 按配置解析本次快照使用的 provider：
   * - 'git'：git provider 必须注册且探测可用，否则响亮失败（不静默降级）；
   * - 'copy'：copy provider（总是可用，兜底）；
   * - 'auto'：git 可用则 git，否则 copy。
   * @param {string} mode - PROVIDER_MODES 之一。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {AbortSignal} [signal] - 取消信号。
   * @returns {Promise<import('./definition.mjs').SnapshotProvider>} 选中的 provider。
   */
  async resolve(mode, workspace, signal) {
    switch (mode) {
      case PROVIDER_MODES.GIT: {
        const git = this.#providers.get(PROVIDERS.GIT)
        if (git === undefined) throw providerUnavailable(PROVIDERS.GIT, 'provider not registered')
        const probe = await git.available(workspace, signal)
        if (!probe.ok) throw providerUnavailable(PROVIDERS.GIT, probe.reason ?? 'unavailable')
        return git
      }
      case PROVIDER_MODES.COPY: {
        const copy = this.#providers.get(PROVIDERS.COPY)
        if (copy === undefined) throw providerUnavailable(PROVIDERS.COPY, 'provider not registered')
        return copy
      }
      case PROVIDER_MODES.AUTO: {
        const git = this.#providers.get(PROVIDERS.GIT)
        if (git !== undefined) {
          const probe = await git.available(workspace, signal)
          if (probe.ok) return git
        }
        const copy = this.#providers.get(PROVIDERS.COPY)
        if (copy === undefined) throw providerUnavailable(PROVIDERS.COPY, 'provider not registered (git unavailable)')
        return copy
      }
      default:
        throw badConfig(`unknown provider mode ${JSON.stringify(mode)} (provider ∈ auto|git|copy)`)
    }
  }
}
