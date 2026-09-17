// lib/settings-schema.mjs — 'checkpoint-rewind' settings 命名空间 schema
// （Schemastery：宿主 settings 服务把注册 schema 当作可调用校验器
// （schema(value) + toJSON()），zod 实例不可调用，注册即 TypeError）。
// 宿主 settings 服务存在时，本命名空间以 cordis.yml 配置为 base
// 层注册（expose: true → Web 设置页可读可写），实现"Schema 配置"：
// cordis.yml 与设置页双源，settings 用户层覆盖 cordis.yml。

import z from '@deepseek-ai/schemastery'
import {
  CONFIRM_CHANNELS,
  DEFAULTS,
  DIFF_RENDERER_MODES,
  LIMITS,
  PRE_REWIND_MODES,
  PROVIDER_MODES,
  SETTINGS_NS,
  WORKSPACE_RESTORE_MODES,
} from './constants.mjs'

// 与宿主 settingsNamespace() 同源的命名空间形态（小写 kebab-case）。
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * 插件 settings 命名空间名（运行时以普通字符串注册；品牌仅是编译期标注）。
 * @returns {string} 'checkpoint-rewind'。
 */
export function checkpointSettingsNamespace() {
  if (!NAMESPACE_PATTERN.test(SETTINGS_NS)) {
    throw new TypeError(`settings namespace "${SETTINGS_NS}" must match ${String(NAMESPACE_PATTERN)}`)
  }
  return SETTINGS_NS
}

/**
 * settings 命名空间的 Schemastery schema（与 index.mjs 的 Schemastery Config 同构；
 * 测试 test/settings-schema.test.mjs 断言两套 schema 键一致）。Schemastery 无
 * 枚举与边界链式约束，枚举用 union 字面量表达，数值/非空边界由
 * validateCheckpointSettings 在每次解析后校验。
 */
export const checkpointSettingsSchema = z.object({
  enabled: z.boolean().default(DEFAULTS.ENABLED),
  provider: z.union(Object.values(PROVIDER_MODES)).default(DEFAULTS.PROVIDER),
  gitBin: z.string().default(DEFAULTS.GIT_BIN),
  snapshotDir: z.string().default(DEFAULTS.SNAPSHOT_DIR),
  maxSnapshots: z.number().default(DEFAULTS.MAX_SNAPSHOTS),
  maxSnapshotBytes: z.number().default(DEFAULTS.MAX_SNAPSHOT_BYTES),
  pruneOnTurnEnd: z.boolean().default(DEFAULTS.PRUNE_ON_TURN_END),
  mutationTools: z.array(z.string()).default([...DEFAULTS.MUTATION_TOOLS]),
  excludeGlobs: z.array(z.string()).default([...DEFAULTS.EXCLUDE_GLOBS]),
  confirmVia: z.union(Object.values(CONFIRM_CHANNELS)).default(DEFAULTS.CONFIRM_VIA),
  listLimit: z.number().default(DEFAULTS.LIST_LIMIT),
  preRewindCheckpoint: z.union(Object.values(PRE_REWIND_MODES)).default(DEFAULTS.PRE_REWIND_CHECKPOINT),
  verifyByHash: z.boolean().default(DEFAULTS.VERIFY_BY_HASH),
  respectGitignore: z.boolean().default(DEFAULTS.RESPECT_GITIGNORE),
  maxSnapshotFiles: z.number().default(DEFAULTS.MAX_SNAPSHOT_FILES),
  snapshotTimeoutMs: z.number().default(DEFAULTS.SNAPSHOT_TIMEOUT_MS),
  autoCheckpoint: z.object({
    enabled: z.boolean().default(DEFAULTS.AUTO_CHECKPOINT_ENABLED),
    intervalMinutes: z.number().default(DEFAULTS.AUTO_CHECKPOINT_INTERVAL_MINUTES),
  }).default({
    enabled: DEFAULTS.AUTO_CHECKPOINT_ENABLED,
    intervalMinutes: DEFAULTS.AUTO_CHECKPOINT_INTERVAL_MINUTES,
  }),
  workspaceRestore: z.union(Object.values(WORKSPACE_RESTORE_MODES)).default(DEFAULTS.WORKSPACE_RESTORE),
  diffRenderer: z.union(Object.values(DIFF_RENDERER_MODES)).default(DEFAULTS.DIFF_RENDERER),
  selectiveRestore: z.boolean().default(DEFAULTS.SELECTIVE_RESTORE),
  promptSection: z.boolean().default(DEFAULTS.PROMPT_SECTION),
  checkpointTool: z.boolean().default(DEFAULTS.CHECKPOINT_TOOL),
})

/**
 * 跨字段与边界语义校验（Schemastery 保证基础类型与枚举成员；数值范围、非空
 * 字符串、数组元素约束与业务语义在此处校验，与 index.mjs resolveConfig 的
 * 运行时校验一致）。非法即抛错，settings 写被拒绝（settings 服务保证"最后
 * 一次好值"语义）。
 * @param {object} value - settings 解析后的完整配置值。
 */
export function validateCheckpointSettings(value) {
  if (typeof value.enabled !== 'boolean') throw new Error('checkpoint-rewind settings: enabled must be a boolean')
  if (typeof value.gitBin !== 'string' || value.gitBin.length === 0) {
    throw new Error('checkpoint-rewind settings: gitBin must be a non-empty string')
  }
  if (typeof value.snapshotDir !== 'string') {
    throw new Error('checkpoint-rewind settings: snapshotDir must be a string')
  }
  if (!Number.isInteger(value.maxSnapshots) || value.maxSnapshots < LIMITS.MIN_MAX_SNAPSHOTS) {
    throw new Error(`checkpoint-rewind settings: maxSnapshots must be an integer ≥ ${LIMITS.MIN_MAX_SNAPSHOTS}`)
  }
  if (!Number.isFinite(value.maxSnapshotBytes) || value.maxSnapshotBytes < LIMITS.MIN_MAX_SNAPSHOT_BYTES) {
    throw new Error(`checkpoint-rewind settings: maxSnapshotBytes must be ≥ ${LIMITS.MIN_MAX_SNAPSHOT_BYTES}`)
  }
  if (typeof value.pruneOnTurnEnd !== 'boolean') {
    throw new Error('checkpoint-rewind settings: pruneOnTurnEnd must be a boolean')
  }
  if (!Array.isArray(value.mutationTools) || value.mutationTools.some(tool => typeof tool !== 'string' || tool.length === 0)) {
    throw new Error('checkpoint-rewind settings: mutationTools must be an array of non-empty strings')
  }
  if (!Array.isArray(value.excludeGlobs) || value.excludeGlobs.some(glob => typeof glob !== 'string' || glob.length === 0)) {
    throw new Error('checkpoint-rewind settings: excludeGlobs must be an array of non-empty strings')
  }
  if (!Number.isInteger(value.listLimit) || value.listLimit < LIMITS.MIN_LIST_LIMIT || value.listLimit > LIMITS.MAX_LIST_LIMIT) {
    throw new Error(`checkpoint-rewind settings: listLimit must be an integer in [${LIMITS.MIN_LIST_LIMIT}, ${LIMITS.MAX_LIST_LIMIT}]`)
  }
  if (typeof value.verifyByHash !== 'boolean') {
    throw new Error('checkpoint-rewind settings: verifyByHash must be a boolean')
  }
  if (typeof value.respectGitignore !== 'boolean') {
    throw new Error('checkpoint-rewind settings: respectGitignore must be a boolean')
  }
  if (!Number.isInteger(value.maxSnapshotFiles) || value.maxSnapshotFiles < LIMITS.MIN_MAX_SNAPSHOT_FILES) {
    throw new Error(`checkpoint-rewind settings: maxSnapshotFiles must be an integer ≥ ${LIMITS.MIN_MAX_SNAPSHOT_FILES}`)
  }
  if (!Number.isInteger(value.snapshotTimeoutMs) || value.snapshotTimeoutMs < LIMITS.MIN_SNAPSHOT_TIMEOUT_MS) {
    throw new Error(`checkpoint-rewind settings: snapshotTimeoutMs must be an integer ≥ ${LIMITS.MIN_SNAPSHOT_TIMEOUT_MS}`)
  }
  if (value.autoCheckpoint != null) {
    if (typeof value.autoCheckpoint.enabled !== 'boolean') {
      throw new Error('checkpoint-rewind settings: autoCheckpoint.enabled must be a boolean')
    }
    if (!Number.isInteger(value.autoCheckpoint.intervalMinutes)
      || value.autoCheckpoint.intervalMinutes < LIMITS.MIN_AUTO_INTERVAL_MINUTES
      || value.autoCheckpoint.intervalMinutes > LIMITS.MAX_AUTO_INTERVAL_MINUTES) {
      throw new Error(`checkpoint-rewind settings: autoCheckpoint.intervalMinutes must be an integer in [${LIMITS.MIN_AUTO_INTERVAL_MINUTES}, ${LIMITS.MAX_AUTO_INTERVAL_MINUTES}] (0 = every step)`)
    }
  }
  if (typeof value.promptSection !== 'boolean') {
    throw new Error('checkpoint-rewind settings: promptSection must be a boolean')
  }
  if (typeof value.checkpointTool !== 'boolean') {
    throw new Error('checkpoint-rewind settings: checkpointTool must be a boolean')
  }
  if (value.enabled === true) {
    if (!Object.values(PROVIDER_MODES).includes(value.provider)) {
      throw new Error(`checkpoint-rewind settings: provider ${JSON.stringify(value.provider)} must be one of auto|git|copy`)
    }
    if (!Object.values(CONFIRM_CHANNELS).includes(value.confirmVia)) {
      throw new Error(`checkpoint-rewind settings: confirmVia ${JSON.stringify(value.confirmVia)} must be one of auto|userQuestions|approval`)
    }
    if (!Object.values(PRE_REWIND_MODES).includes(value.preRewindCheckpoint)) {
      throw new Error(`checkpoint-rewind settings: preRewindCheckpoint ${JSON.stringify(value.preRewindCheckpoint)} must be one of warn|require|off`)
    }
    if (!Object.values(WORKSPACE_RESTORE_MODES).includes(value.workspaceRestore)) {
      throw new Error(`checkpoint-rewind settings: workspaceRestore ${JSON.stringify(value.workspaceRestore)} must be one of restore|reset-hard`)
    }
    if (!Object.values(DIFF_RENDERER_MODES).includes(value.diffRenderer)) {
      throw new Error(`checkpoint-rewind settings: diffRenderer ${JSON.stringify(value.diffRenderer)} must be one of pairwise|side-by-side`)
    }
    if (typeof value.selectiveRestore !== 'boolean') {
      throw new Error('checkpoint-rewind settings: selectiveRestore must be a boolean')
    }
  }
}
