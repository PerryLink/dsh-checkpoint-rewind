// lib/settings-schema.mjs — 'checkpoint-rewind' settings 命名空间 schema
// （Schemastery：settings 注册 schema 是配置持久边界校验器，宿主会把它当
// 函数调用 schema(value)——zod v4 实例不可调用（B4：装上进设置页即
// TypeError: schema is not a function），故与 index.mjs 的 Config 同用
// Schemastery）。宿主 settings 服务存在时，本命名空间以 cordis.yml 配置为
// base 层注册（expose: true → Web 设置页可读可写），实现"Schema 配置"：
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
 * settings 命名空间的 Schemastery schema（与 index.mjs 的 Schemastery Config
 * 同构；测试 test/settings-schema.test.mjs 断言两套 schema 键一致）。Schemastery
 * 无 zod 的 `.int()`/`.enum()` 方法：枚举用 `z.union([...])` 常量并集；整数
 * 语义由下方 validateCheckpointSettings 承担（settings 写与 cordis.yml 加载
 * 共用该校验）。
 */
export const checkpointSettingsSchema = z.object({
  enabled: z.boolean().default(DEFAULTS.ENABLED),
  provider: z.union(Object.values(PROVIDER_MODES)).default(DEFAULTS.PROVIDER),
  gitBin: z.string().min(1).default(DEFAULTS.GIT_BIN),
  snapshotDir: z.string().default(DEFAULTS.SNAPSHOT_DIR),
  maxSnapshots: z.number().min(LIMITS.MIN_MAX_SNAPSHOTS).default(DEFAULTS.MAX_SNAPSHOTS),
  maxSnapshotBytes: z.number().min(LIMITS.MIN_MAX_SNAPSHOT_BYTES).default(DEFAULTS.MAX_SNAPSHOT_BYTES),
  pruneOnTurnEnd: z.boolean().default(DEFAULTS.PRUNE_ON_TURN_END),
  mutationTools: z.array(z.string().min(1)).default([...DEFAULTS.MUTATION_TOOLS]),
  excludeGlobs: z.array(z.string().min(1)).default([...DEFAULTS.EXCLUDE_GLOBS]),
  confirmVia: z.union(Object.values(CONFIRM_CHANNELS)).default(DEFAULTS.CONFIRM_VIA),
  listLimit: z.number().min(LIMITS.MIN_LIST_LIMIT).max(LIMITS.MAX_LIST_LIMIT).default(DEFAULTS.LIST_LIMIT),
  preRewindCheckpoint: z.union(Object.values(PRE_REWIND_MODES)).default(DEFAULTS.PRE_REWIND_CHECKPOINT),
  verifyByHash: z.boolean().default(DEFAULTS.VERIFY_BY_HASH),
  autoCheckpoint: z.object({
    enabled: z.boolean().default(DEFAULTS.AUTO_CHECKPOINT_ENABLED),
    intervalMinutes: z.number()
      .min(LIMITS.MIN_AUTO_INTERVAL_MINUTES)
      .max(LIMITS.MAX_AUTO_INTERVAL_MINUTES)
      .default(DEFAULTS.AUTO_CHECKPOINT_INTERVAL_MINUTES),
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
 * 跨字段校验（schema 已保证类型与数值边界；此处校验 schema 表达不了的语义约束
 * 与整数约束，与 index.mjs resolveConfig 的运行时校验一致）。非法即抛错，
 * settings 写被拒绝（settings 服务保证"最后一次好值"语义）。
 * @param {object} value - settings 解析后的完整配置值。
 */
export function validateCheckpointSettings(value) {
  if (typeof value.enabled !== 'boolean') throw new Error('checkpoint-rewind settings: enabled must be a boolean')
  if (!Number.isInteger(value.maxSnapshots)) {
    throw new Error('checkpoint-rewind settings: maxSnapshots must be an integer')
  }
  if (!Number.isInteger(value.listLimit)) {
    throw new Error('checkpoint-rewind settings: listLimit must be an integer')
  }
  if (!Number.isInteger(value.autoCheckpoint?.intervalMinutes)) {
    throw new Error('checkpoint-rewind settings: autoCheckpoint.intervalMinutes must be an integer')
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
