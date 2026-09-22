// lib/settings-schema.mjs — 'checkpoint-rewind' 配置 schema（单一真源）。
//
// 0.1.7-alpha.1 起宿主删除了整包 @deepseek-ai/dsh-settings-file，并把
// ctx.settings 的契约反转：不再有「插件注册一个 settings 命名空间」的注册面
// （installSection / register / SettingsProvider / settings/updated 全部消失），
// ctx.settings 现在是 SettingsForms —— 它直接把每个 Loader 条目的
// runtime.Config 投影成设置页表单，并在 profile patch 上持久化。因此：
//   - 本 schema 同时是插件的 Config（cordis.yml 与设置页同源，双源合一）；
//   - 只有标了 volatile 的字段进设置页表单（宿主只投影 volatile 字段，编辑后
//     就地更新 Volatile 引用而不重挂插件）；读值必须走 .get()，见 index.mjs。
// 旧宿主行（<= 0.1.6-alpha.2）仍只有 register：那条路径必须拿到「未标 volatile」
// 的等价 schema 副本（旧 provider 把 schema 当函数调用并 deepFreeze 结果，
// volatile 字段会解析成 Volatile 引用——值过不了校验，也过不了设置页 wire），
// 见 checkpointLegacySettingsSchema。
//
// 校验分层：schema 承担类型、枚举、数值边界与整数性（宿主在**持久化之前**
// 用 runtime.Config 校验候选值，见 dsh-config-editor 的 edit()）；跨字段语义
// （enabled=true 时的枚举词汇等）由 validateCheckpointSettings 纯函数承担，
// 在 index.mjs 的 resolveConfig 与配置还原路径上调用。宿主 cookbook 提到的
// schema.check() 在 0.1.7-alpha.1 随包发布的 schemastery 3.18.3 里并不存在
// （全仓无该 API），故不采用。

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
 * 插件配置命名空间名 = Loader 条目 id 约定（bundle 的 cordis.patch.yml 用同名
 * `id: checkpoint-rewind`）。新宿主里设置页按**条目 id** 定位配置，本常量用于
 * /rewind config 的写回寻址；旧宿主里它就是注册用的 settings 命名空间。
 * @returns {string} 'checkpoint-rewind'。
 */
export function checkpointSettingsNamespace() {
  if (!NAMESPACE_PATTERN.test(SETTINGS_NS)) {
    throw new TypeError(`settings namespace "${SETTINGS_NS}" must match ${String(NAMESPACE_PATTERN)}`)
  }
  return SETTINGS_NS
}

/**
 * 标记字段可热改。0.1.7-alpha.1 宿主的 schemastery 3.18.3 有 .volatile()；
 * 旧宿主随包的 3.18.2 没有该方法但有语义等价的 .extra('volatile', true)
 * （3.18.3 的 .volatile() 实现就是 extra('volatile', true)），且旧宿主不认识
 * 该元数据（惰性忽略）——所以同一份声明在两个宿主行上都能装载，绝不因缺方法
 * 而在 import 期抛错。
 * @param {any} schema - 待标记的 schemastery 节点。
 * @returns {any} 标记后的节点（新副本）。
 */
function volatileField(schema) {
  return typeof schema.volatile === 'function'
    ? schema.volatile()
    : /** @type {any} */ (schema).extra('volatile', true)
}

/**
 * 配置形状（Schemastery）。枚举用 z.union 常量并集；数值边界与整数性写进
 * schema，让宿主在持久化前就能拒绝非法值；跨字段语义由
 * validateCheckpointSettings 补齐。
 * @param {(schema: any) => any} mark - 字段标记函数（volatileField 或恒等）。
 * @returns {any} schemastery object schema。
 */
function buildCheckpointSettingsSchema(mark) {
  return z.object({
    enabled: mark(z.boolean().default(DEFAULTS.ENABLED)),
    provider: mark(z.union(Object.values(PROVIDER_MODES)).default(DEFAULTS.PROVIDER)),
    gitBin: mark(z.string().min(1).default(DEFAULTS.GIT_BIN)),
    snapshotDir: mark(z.string().default(DEFAULTS.SNAPSHOT_DIR)),
    maxSnapshots: mark(z.number().min(LIMITS.MIN_MAX_SNAPSHOTS).step(1).default(DEFAULTS.MAX_SNAPSHOTS)),
    maxSnapshotBytes: mark(z.number().min(LIMITS.MIN_MAX_SNAPSHOT_BYTES).default(DEFAULTS.MAX_SNAPSHOT_BYTES)),
    pruneOnTurnEnd: mark(z.boolean().default(DEFAULTS.PRUNE_ON_TURN_END)),
    mutationTools: mark(z.array(z.string().min(1)).default([...DEFAULTS.MUTATION_TOOLS])),
    excludeGlobs: mark(z.array(z.string().min(1)).default([...DEFAULTS.EXCLUDE_GLOBS])),
    confirmVia: mark(z.union(Object.values(CONFIRM_CHANNELS)).default(DEFAULTS.CONFIRM_VIA)),
    listLimit: mark(z.number()
      .min(LIMITS.MIN_LIST_LIMIT)
      .max(LIMITS.MAX_LIST_LIMIT)
      .step(1)
      .default(DEFAULTS.LIST_LIMIT)),
    preRewindCheckpoint: mark(z.union(Object.values(PRE_REWIND_MODES)).default(DEFAULTS.PRE_REWIND_CHECKPOINT)),
    verifyByHash: mark(z.boolean().default(DEFAULTS.VERIFY_BY_HASH)),
    autoCheckpoint: z.object({
      enabled: mark(z.boolean().default(DEFAULTS.AUTO_CHECKPOINT_ENABLED)),
      intervalMinutes: mark(z.number()
        .min(LIMITS.MIN_AUTO_INTERVAL_MINUTES)
        .max(LIMITS.MAX_AUTO_INTERVAL_MINUTES)
        .step(1)
        .default(DEFAULTS.AUTO_CHECKPOINT_INTERVAL_MINUTES)),
    }).default({
      enabled: DEFAULTS.AUTO_CHECKPOINT_ENABLED,
      intervalMinutes: DEFAULTS.AUTO_CHECKPOINT_INTERVAL_MINUTES,
    }),
    workspaceRestore: mark(z.union(Object.values(WORKSPACE_RESTORE_MODES)).default(DEFAULTS.WORKSPACE_RESTORE)),
    diffRenderer: mark(z.union(Object.values(DIFF_RENDERER_MODES)).default(DEFAULTS.DIFF_RENDERER)),
    selectiveRestore: mark(z.boolean().default(DEFAULTS.SELECTIVE_RESTORE)),
    promptSection: mark(z.boolean().default(DEFAULTS.PROMPT_SECTION)),
    checkpointTool: mark(z.boolean().default(DEFAULTS.CHECKPOINT_TOOL)),
  })
}

/**
 * 插件 Config = 设置页表单 schema（新宿主，index.mjs 的 Config 导出即本值）。
 * volatile 字段在 0.1.7+ 宿主上解析为 Volatile 引用：宿主在 profile patch 上
 * 持久化用户层并就地更新引用（不重挂插件），插件侧一律经 .get() 读当前值。
 */
export const checkpointSettingsSchema = buildCheckpointSettingsSchema(volatileField)

/**
 * 同一形状但**不标** volatile 的副本，专供旧宿主（<= 0.1.6-alpha.2）的
 * settings 命名空间注册面：旧 provider 会 schema(...) 调用并 deepFreeze 结果，
 * volatile 字段在那里只会变成解不开的引用。
 */
export const checkpointLegacySettingsSchema = buildCheckpointSettingsSchema(schema => schema)

/**
 * 跨字段语义校验（schema 已保证类型、枚举、数值边界；此处校验 schema 表达不了
 * 的整数约束与 enabled 门控语义），与 index.mjs resolveConfig 的运行时校验一致。
 * 非法即抛错：旧宿主 settings 写被拒绝（最后一次好值语义），新宿主由
 * resolveConfig 在活配置读取与配置还原时响亮失败。
 * @param {Record<string, unknown> & {autoCheckpoint?: {intervalMinutes?: unknown}}} value - 完整配置值。
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
    // includes 的参数类型是各枚举常量并集；此处校验的恰是"未知输入是否命中词汇"，
    // 类型上按 unknown 原样传入（运行时 Object.values 逐项相等比较）。
    if (!Object.values(PROVIDER_MODES).includes(/** @type {any} */ (value.provider))) {
      throw new Error(`checkpoint-rewind settings: provider ${JSON.stringify(value.provider)} must be one of auto|git|copy`)
    }
    if (!Object.values(CONFIRM_CHANNELS).includes(/** @type {any} */ (value.confirmVia))) {
      throw new Error(`checkpoint-rewind settings: confirmVia ${JSON.stringify(value.confirmVia)} must be one of auto|userQuestions|approval`)
    }
    if (!Object.values(PRE_REWIND_MODES).includes(/** @type {any} */ (value.preRewindCheckpoint))) {
      throw new Error(`checkpoint-rewind settings: preRewindCheckpoint ${JSON.stringify(value.preRewindCheckpoint)} must be one of warn|require|off`)
    }
    if (!Object.values(WORKSPACE_RESTORE_MODES).includes(/** @type {any} */ (value.workspaceRestore))) {
      throw new Error(`checkpoint-rewind settings: workspaceRestore ${JSON.stringify(value.workspaceRestore)} must be one of restore|reset-hard`)
    }
    if (!Object.values(DIFF_RENDERER_MODES).includes(/** @type {any} */ (value.diffRenderer))) {
      throw new Error(`checkpoint-rewind settings: diffRenderer ${JSON.stringify(value.diffRenderer)} must be one of pairwise|side-by-side`)
    }
    if (typeof value.selectiveRestore !== 'boolean') {
      throw new Error('checkpoint-rewind settings: selectiveRestore must be a boolean')
    }
  }
}
