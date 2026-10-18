// lib/projection.mjs — 会话投影单元 'checkpoints'（Web UI 检查点条 + 手机桥 /status 的锚点）。
//
// 折叠 checkpoint/snapshot|bound|prune|rewind 会话事件为 id → wire 记录的普通 JSON
// 状态（持久缓存前置条件），再把这份状态渲染成 **一行有界字符串** 作为 wire 值。
// 领域只贡献纯数学（init/apply/view 全同步），驱动、水位缓存与变更流归
// ctx.sessionProjections。与 lib/domain.mjs 一样，本模块允许 zod（wire 载荷是持久
// 边界校验器）。
//
// 为什么 wire 值不是对象：一条检查点的紧凑 JSON 即使所有可选字段缺席、短号也没有，
// 也要 151 码元（36 字符 UUID 是 id 下限），列表形态再加 2 个方括号 —— 也就是说
// **对象形态对任何真实值都必然超过 120**。而微信桥把投影值渲染成一行并在 120 码元处
// 截断（dsh-wechat src/bridge/slash.ts 的 renderProjectionValue / truncateForWeChat），
// 于是手机上看到的一律是被劈断的 JSON。单行字符串（renderCheckpointsLine）把整个
// 载荷压进任何单行渲染器的第一行。见 CHECKPOINTS_LINE_MAX。
//
// 行渲染器的helper 形状（boundedCount / capText / clampLine / safeEnd）与同族
// dsh-doublecheck 的 src/domain/projection.ts 同款（同一作者、同为 Apache-2.0），
// 按本仓词汇表改写；出处标注见 THIRD_PARTY_NOTICES.md。
//
// rc.2 现实：checkpoint/* 事件经自适应门（lib/gate.mjs）append，当前宿主构建不收录
// 这些类型，因此该单元在 rc.2 上恒为空（`cp:0`）；宿主收录词汇后无需改插件即自动
// 填充（ARCHITECTURE.md 的 TODO 锚点）。

import { z } from 'zod'
import { REWIND_OUTCOMES, SESSION_EVENTS } from './constants.mjs'

/**
 * wire 行的硬预算，单位 UTF-16 码元 —— 与 `String#length` 及一切单行渲染器同单位。
 *
 * 120 不是随手取的：微信桥的通用投影渲染器（`dsh-wechat` `src/bridge/slash.ts` 的
 * `renderProjectionValue` → `truncateForWeChat`）只在 `value.length <= 120` 时原样
 * 保留，否则切成 117 码元 + `…`。旧的列表形态**理论最小值**是 151 码元（36 字符
 * UUID + 一个字段都不带），所以没有「够短的对象形态」这种东西 —— 缺陷是数学上的，
 * 不是调参能绕开的。
 */
export const CHECKPOINTS_LINE_MAX = 120

/**
 * 行上计数字段（记录数、短号、turn、step）的打印上限：超过则打印 `<上限>+`。
 * 这个上限让最坏一行仍有 18 码元余量（推导见 {@link renderCheckpointsLine}）。
 */
export const CHECKPOINTS_COUNT_MAX = 9999

/**
 * 行上 `[kind]` 与 `rw:` 两个枚举位允许的最长文本。两处的运行期取值都不经 schema
 * 校验（投影消费的是事件载荷本身），因此必须自己兜底。
 */
export const CHECKPOINTS_TOKEN_MAX = 12

/** 段分隔符：手机上视觉可辨，且不出现在任何枚举词的字符集里。 */
const SEGMENT = ' | '

/** 标记被本行有意截短的文本。 */
const ELLIPSIS = '…'

/** 无短号可寻址时的占位（旧介质记录尚未补号）。 */
const NO_ADDRESS = '#?'

/**
 * 一条检查点的 wire 载荷（投影单元**状态**的组成单元；进 Web 客户端前按此校验）。
 * 状态形状与 wire 值无关：状态始终是 id → 该记录的普通 JSON 对象。
 */
export const checkpointWireSchema = z.object({
  id: z.string().min(1),
  // 每会话短号（`/rewind <number>` 寻址目标；旧事件载荷可缺失 = 可选项）。
  short: z.number().int().positive().optional(),
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

/**
 * 校验离开宿主前的 wire 载荷：**一行**、至多 {@link CHECKPOINTS_LINE_MAX} 码元。
 * `renderCheckpointsLine` 由构造保证该上界，因此 `.max()` 永远不会把格式回归
 * 变成一次 `viewSchema.parse` 抛错（`viewCheckpoint` / `restore` 都在无 try 的
 * 路径上调用它）——它是把上界钉成契约，不是运行时兜底。
 */
export const checkpointsLineSchema = z.string().max(CHECKPOINTS_LINE_MAX)

/**
 * 投影单元状态（id → wire 记录）与 wire 输出类型（与 types.d.ts 契约一致）。
 * @typedef {import('../types.d.ts').CheckpointWireRecord} CheckpointWireRecord
 * @typedef {import('../types.d.ts').CheckpointsView} CheckpointsView
 * @typedef {Record<string, CheckpointWireRecord>} CheckpointProjectionState
 */

/** 投影单元状态：id → wire 记录（普通 JSON 对象，持久缓存前置条件）。 */
/** @type {() => CheckpointProjectionState} */
const init = () => ({})

/** 折叠状态 schema（rc.2 的 stateSchema：校验持久缓存里 id → wire 记录的内部状态）。 */
const stateSchema = z.record(z.string(), checkpointWireSchema)

/**
 * 快照事件 → wire 记录（状态只关心排布所需字段，其余丢弃）。
 * `short` 紧跟 `id` 是**声明序**：与 types.d.ts 的 CheckpointWireRecord 及上面的
 * checkpointWireSchema 字段序一致。0.6.24 及更早这里曾按「落在微信桥 117 码元
 * 截断内」的理由排序 —— wire 值改成单行字符串后该理由已作废（键序不再影响可读性，
 * 见 test/projection-line.test.mjs 的键序无关断言），保留此位置只为三处声明同序。
 * @param {import('../types.d.ts').CheckpointRecord} data - checkpoint/snapshot 载荷。
 * @returns {CheckpointWireRecord} wire 记录。
 */
function wireOf(data) {
  return {
    id: data.id,
    ...(data.short === undefined ? {} : { short: data.short }),
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
 * 状态 → wire 载荷：一行有界状态串（最新记录在 `last` 段）。
 * @param {CheckpointProjectionState} state - 当前状态。
 * @returns {CheckpointsView} 至多 CHECKPOINTS_LINE_MAX 码元的单行值。
 */
function view(state) {
  return renderCheckpointsLine(state)
}

/**
 * 渲染折叠状态为有界的单行 wire 值。
 *
 * 按优先级拼装，每段各自有界，因此总长不可能超过 {@link CHECKPOINTS_LINE_MAX}：
 *
 * 1. `cp:<n>` —— 本会话现有的检查点数（`cp:0` = 还没有），即 `/rewind list` 的长度。
 * 2. `#<lo>-<hi>` —— 现在可用 `/rewind <n>` 寻址的短号**范围**（只有一条时写
 *    `#<n>`；没有任何记录带短号时写 `#?`）。⚠️ 是范围不是集合：prune / `/rewind clear`
 *    只删记录、从不回收号，所以区间内可以有空洞。
 * 3. `last #<short> [<kind>] t<turn>s<step>` —— 最新一条（`/rewind latest` 的目标）
 *    的短号、来源与位置。短号/位置缺失时写 `#?` 与 `t0s0`。
 * 4. `sess t<turn>s<step>` —— **会话本身（对话重放）能回到的最远处**：带
 *    `sessionBoundary` 的记录里 (turn, step) 最大的那条（该字段是「游标之前最近一条
 *    `turn/end` 的 seq」，存在即表示这一轮的会话边界已知、可作 fork 种子）。一条都
 *    没有时整段省略。
 * 5. `rw:<outcome>` —— 最近一次记录在案的 `/rewind` 结果（`restored` / `partial` /
 *    `failed` / `denied`）；没有时整段省略。
 *
 * 最坏组合（各段可同时取到，见 test/projection-line.test.mjs 的极值样本）：
 *
 * ```text
 * cp:9999+ | #9999-9999+ | last #9999+ [<12 码元>] t9999+s9999+ | sess t9999+s9999+ | rw:<12 码元>
 *    8         11                    39                          17              15            + 4×3 分隔符
 * ```
 *
 * 合计 **102**，余量 18 码元。段 2 的上界是 11 而不是 12：`#<lo>-<hi>` 只在渲染后
 * 两串不同时才带连字符，而 lo/hi 同时超过 {@link CHECKPOINTS_COUNT_MAX} 会渲染成
 * 同一个 `9999+`、退化成单值 `#9999+`。
 *
 * {@link clampLine} 因此今天不可达，只作「未来新增字段不得悄悄逃出预算」的兜底。
 *
 * 纯函数且全域：任何状态 —— 含手工构造的、版本不符的、计数荒谬的、`kind` 不是枚举
 * 而是任意字符串的 —— 都返回至多 {@link CHECKPOINTS_LINE_MAX} 码元的一行字符串，
 * 绝不抛。
 * @param {CheckpointProjectionState} state - 折叠状态。
 * @returns {string} 一行，≤ CHECKPOINTS_LINE_MAX 码元，无换行、无控制字符。
 */
export function renderCheckpointsLine(state) {
  const records = sortByTimeThenId(state)
  const newest = records.at(-1)
  if (newest === undefined) return 'cp:0'
  const parts = [
    `cp:${boundedCount(records.length, CHECKPOINTS_COUNT_MAX)}`,
    shortSpan(records),
    `last ${address(newest.short)} [${token(newest.kind)}] ${position(newest)}`,
  ]
  const replayable = furthestSessionBoundary(records)
  if (replayable !== undefined) parts.push(`sess ${position(replayable)}`)
  const outcome = latestRewindOutcome(records)
  if (outcome !== undefined) parts.push(`rw:${token(outcome)}`)
  return clampLine(parts.join(SEGMENT))
}

/**
 * 状态按 (time, id) 升序排列（最新在尾，与旧的列表 wire 同序）。
 * @param {CheckpointProjectionState} state - 折叠状态。
 * @returns {CheckpointWireRecord[]} 升序副本。
 */
function sortByTimeThenId(state) {
  return Object.values(state).sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * 段 2：可用 `/rewind <n>` 寻址的短号范围。
 * @param {CheckpointWireRecord[]} records - 升序记录。
 * @returns {string} `#<lo>-<hi>` · `#<n>`（区间退化为一点）· `#?`（无短号）。
 */
function shortSpan(records) {
  let low
  let high
  for (const record of records) {
    const short = positiveInt(record.short)
    if (short === undefined) continue
    if (low === undefined || short < low) low = short
    if (high === undefined || short > high) high = short
  }
  if (low === undefined || high === undefined) return NO_ADDRESS
  const lo = boundedCount(low, CHECKPOINTS_COUNT_MAX)
  const hi = boundedCount(high, CHECKPOINTS_COUNT_MAX)
  return lo === hi ? `#${lo}` : `#${lo}-${hi}`
}

/**
 * 一个短号在行上的地址记号（缺失或非正整数 → `#?`）。
 * @param {number|undefined} short - 记录的短号。
 * @returns {string} `#<n>` 或 `#?`。
 */
function address(short) {
  const value = positiveInt(short)
  return value === undefined ? NO_ADDRESS : `#${boundedCount(value, CHECKPOINTS_COUNT_MAX)}`
}

/**
 * 段 3/4 内的位置记号 `t<turn>s<step>`（与 `/rewind step <N>` 及 `list brief` 同词汇）。
 * @param {CheckpointWireRecord} record - 任意记录。
 * @returns {string} 有界的位置记号。
 */
function position(record) {
  return `t${boundedCount(record.turn, CHECKPOINTS_COUNT_MAX)}s${boundedCount(record.step, CHECKPOINTS_COUNT_MAX)}`
}

/**
 * 段 4 的取值：会话重放能回到的最远处。
 * @param {CheckpointWireRecord[]} records - 升序记录。
 * @returns {CheckpointWireRecord|undefined} (turn, step) 最大且带 sessionBoundary 的记录。
 */
function furthestSessionBoundary(records) {
  let best
  for (const record of records) {
    if (record.sessionBoundary === undefined) continue
    if (best === undefined || record.turn > best.turn
      || (record.turn === best.turn && record.step > best.step)) best = record
  }
  return best
}

/**
 * 段 5 的取值：最近一次 `/rewind` 的结果（记录已按 (time, id) 升序，取最后一个带
 * `rewindOutcome` 的）。
 * @param {CheckpointWireRecord[]} records - 升序记录。
 * @returns {string|undefined} 结果词，或 undefined（本次会话还没回退过）。
 */
function latestRewindOutcome(records) {
  let outcome
  for (const record of records) {
    if (record.rewindOutcome !== undefined) outcome = record.rewindOutcome
  }
  return outcome
}

/**
 * 正整数判据（运行期事件载荷未经 schema 校验，一切数值都要先过这里）。
 * @param {unknown} value - 待判定值。
 * @returns {number|undefined} 正整数，或 undefined。
 */
function positiveInt(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined
  return value
}

/**
 * 渲染一个计数字段：非有限、非数值与负数折叠为 `0`，超过 `maximum` 打印
 * `<maximum>+`，使该字段有界。
 * @param {number} value - 折叠出的计数。
 * @param {number} maximum - 行上仍打印精确值的最大计数。
 * @returns {string} 有界的十进制字符串。
 */
function boundedCount(value, maximum) {
  if (!Number.isFinite(value)) return '0'
  const count = Math.max(0, Math.trunc(value))
  return count > maximum ? `${maximum}+` : String(count)
}

/**
 * 渲染一个枚举位：控制字符（`Cc`：含换行与 C1 区）、格式字符（`Cf`）、**落单的
 * 代理项**（`Cs`）与 Unicode 行分隔符（`Zl`/`Zp`）变空格、段分隔符的 `|` 变 `/`、
 * 空白串折叠、去首尾，空串回落 `?`，最后按 {@link CHECKPOINTS_TOKEN_MAX} 截短。
 *
 * wire 值必须是**一行**：微信渲染器只保留多行值的第一行。事件载荷在投影侧没有
 * schema 校验，所以 `kind` / `outcome` 可能是任意文本 —— 这里必须自己兜底。
 *
 * `Cs` 那一类不是可选项，而且它必须在这里、不能在 {@link clampLine} 里做：
 * `/u` 模式下配对完好的代理对是一个码点（不属 `Cs`），所以这个类**只**命中落单的
 * 代理项；而落单代理项会被微信传输层拒绝（`ret=-1 invalid request`），事后
 * {@link safeEnd} 只能避免**新造**落单，救不了本来就落单的输入。
 *
 * 四类替换都是 1:1 或收缩，因此本函数永不把结果变长。
 * @param {unknown} value - 运行期取值。
 * @returns {string} 单行、无控制字符、无落单代理项、至多 CHECKPOINTS_TOKEN_MAX 码元的词。
 */
function token(value) {
  const text = typeof value === 'string' ? value : ''
  const flat = text
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\|/gu, '/')
    .replace(/\s+/gu, ' ')
    .trim()
  return flat === '' ? '?' : capText(flat, CHECKPOINTS_TOKEN_MAX)
}

/**
 * 兜底 {@link CHECKPOINTS_LINE_MAX}：整行由构造保证有界，所以今天不可达；留在这里
 * 是为了未来新增字段不能悄悄逃出预算。
 * @param {string} line - 拼装完成的行。
 * @returns {string} 行本身，或 `…` 结尾的有界前缀。
 */
function clampLine(line) {
  return capText(line, CHECKPOINTS_LINE_MAX)
}

/**
 * 把 `text` 截到至多 `budget` 码元，真的截断时以 `…` 标记，且绝不劈开代理对。
 * @param {string} text - 待限制文本。
 * @param {number} budget - 结果的最大长度。
 * @returns {string} 原文本，或 `…` 结尾的前缀。
 */
function capText(text, budget) {
  if (budget <= 0) return ''
  if (text.length <= budget) return text
  if (budget <= ELLIPSIS.length) return ELLIPSIS
  return `${text.slice(0, safeEnd(text, budget - ELLIPSIS.length))}${ELLIPSIS}`
}

/**
 * 不劈开 UTF-16 代理对的最大截断下标：落单的代理项会被微信传输层拒绝
 * （`ret=-1 invalid request`）。
 * @param {string} text - 被截断的文本。
 * @param {number} end - 拟截断下标。
 * @returns {number} `end`，或会劈开代理对时的 `end - 1`。
 */
function safeEnd(text, end) {
  if (end <= 0) return 0
  const previous = text.charCodeAt(end - 1)
  return previous >= 0xD800 && previous <= 0xDBFF ? end - 1 : end
}

/**
 * 'checkpoints' 投影单元（ProjectionDefinition，rc.2 契约）。
 * rc.2 拆分了 schema 与客户端 wire：`stateSchema` 校验持久缓存的折叠状态
 * （id → wire 记录），`wire.viewSchema` 校验离开宿主前的 view 输出；`view`
 * 收敛到 `wire` 内。`stateVersion` 为非负整数（必填，rc.2 注册时校验）。
 *
 * **`stateVersion` 保持 0，不需要 bump**：它版本化的是**折叠状态**（持久行里的
 * `val`，见宿主 `SessionProjectionRegistry.checkpoint()` / `restore()`），而本次
 * 改动只换了 view 的输出形状，`stateSchema`（id → wire 记录）一字未动 —— 旧行
 * 读回时 `stateSchema.parse` 照旧通过、`ver === stateVersion` 照旧成立，因此既
 * 没有需要迁移的旧值，也没有「版本不符 ⇒ 从 init 重折」的降级路径要走。反过来说，
 * 若为此 bump 版本才是**不安全**的：不匹配的持久行会让 `restoreFloor()` 把下界
 * 拉到 0（全量重折，只是浪费），而任何以 `baseSeq > 0` 起读的调用者会被
 * `restore()` 直接抛错（`cannot restore from seq N`）。
 *
 * 注意：不在此处给整对象加 ProjectionDefinition 注解——wire 在接口里可选，
 * 注解会把 wire 变成可选从而不再满足 register 的 wire-required 交集；由
 * register 调用点按契约校验（key 用 const 断言保住字面量）。
 */
export const checkpointsProjectionDefinition = {
  key: /** @type {const} */ ('checkpoints'),
  // zod 具体 schema 类型（ZodRecord/ZodString 的 Def 形参）与契约的
  // ZodType<S>（默认 Def）在类泛型不变性下不可直接赋值：运行时语义不变，
  // 类型上按契约收窄。
  stateSchema: /** @type {import('zod').ZodType<CheckpointProjectionState>} */ (/** @type {unknown} */ (stateSchema)),
  stateVersion: 0,
  init,
  apply,
  wire: {
    viewSchema: /** @type {import('zod').ZodType<CheckpointsView>} */ (/** @type {unknown} */ (checkpointsLineSchema)),
    view,
  },
}

export { apply as applyCheckpointsProjection, view as viewCheckpointsProjection, init as initCheckpointsProjection }
