// index.mjs — dsh-checkpoint-rewind 插件入口（唯一 host 面文件）。
//
// 功能：DSH 一体化 checkpoint —— 会话 + 工作区 + 配置三态统一快照与一键回滚
// （Claude Code Checkpoints 对标 + 官方会话可重放能力的差异化）。
// - 快照：每次变更型工具执行前（fs/write-intent、fs/edit-intent、tools/pre-execute
//   的变更工具子集，均为 prepend 直通监听）捕获工作区状态；step/start 的自动
//   间隔快照（autoCheckpoint，配置可关）；/checkpoint 命令与 checkpoint 工具的手动
//   快照（可带备注）；回退前的保护快照。provider seam：git（stash create /
//   commit-tree 未引用对象，不动工作树/索引/历史）优先，copy 兜底。配额记账
//   是增量字节（保留数量 maxSnapshots + 总大小 maxSnapshotBytes 双界）。
// - 三态记录：{id, time, seq=会话事件游标, tree=工作区 git tree SHA,
//   config=配置快照, note=备注, kind=manual|auto|guard|mutation}。
// - /rewind：无参列出最近检查点；<id 前缀> / step <N> / latest 寻址；
//   workspace|session|config|all <目标> 三态独立或一体回滚；preview 只读影响面；
//   diff <a> <b> 两两对比；clear 清空。回滚前展示三态 diff 摘要并过确认门
//   （userQuestions/approval，失败关闭），然后：保护检查点 → 工作区恢复
//   （restore 安全覆盖 / reset-hard CC 对标模式）→ 配置还原（settings 命名空间
//   写回，持久）→ 会话回退（sessions.create(id,{seed}) 官方重放：以事件游标
//   为界 seed 出全新子会话，原会话不破坏）。
// - 记录存 ctx.storageDomain 域 'checkpoints'；checkpoint/* 会话事件经自适应门
//   append（宿主收录该类型或支持 ignorable 信封才写，见 lib/gate.mjs）。
// - Schema 配置：settings 命名空间 'checkpoint-rewind'（zod，expose 进设置页），
//   cordis.yml 为 base 层；设置页 Plugins → Checkpoints 标签页展示时间线与两两
//   diff（lib/panel.mjs + typert.host.mjs + client/）。
//
// 只消费公开服务：sessions / commands（inject 声明）；storageDomain /
// userQuestions / approval / sessionProjections / settings / tools /
// systemPrompt 按需可选查找（缺失 = 失败关闭或优雅降级——storageDomain 缺失时
// 插件照常挂载，checkpoint/rewind 路径返回结构化错误并提示组合方式，绝不
// 把 profile 卡在 pending）。

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  AUTO_TRIGGER,
  CHECKPOINT_COMMAND,
  CHECKPOINT_KINDS,
  CHECKPOINT_TOOL,
  COMMAND_NAME,
  CONFIRM_CHANNELS,
  DEFAULTS,
  LIMITS,
  MANUAL_TRIGGER,
  PLUGIN_NAME,
  PRE_REWIND_MODES,
  PRE_REWIND_TRIGGER,
  PRUNE_REASONS,
  PROMPT_SECTION_NAME,
  PROMPT_SECTION_ORDER,
  PROVIDERS,
  PROVIDER_MODES,
  REWIND_OUTCOMES,
  REWIND_TARGETS,
  SESSION_EVENTS,
  WORKSPACE_RESTORE_MODES,
} from './lib/constants.mjs'
import {
  ambiguousCheckpoint,
  badConfig,
  checkpointNotFound,
  diffUnavailable,
  messageOf,
  providerUnavailable,
  rewindDenied,
  registryUnavailable,
} from './lib/errors.mjs'
import { workspaceKeyOf, resolveSnapshotDir } from './lib/workspace.mjs'
import { checkpointsDomainSpec } from './lib/domain.mjs'
import {
  formatCheckpointDiff,
  formatCheckpointList,
  formatPreviewResult,
  formatRewindSummary,
  nearestCheckpointAtOrBefore,
  parseCheckpointInput,
  parseRewindInput,
  prunePlan,
  resolveRecordByPrefix,
  sortOldestFirst,
  stepEndSeqOf,
} from './lib/checkpoints.mjs'
import { configDiff, configLinesOf, diffLines, stableStringify, unifiedDiffLines } from './lib/diff.mjs'
import { replaySeedOf, sessionBoundaryAt, sessionDelta } from './lib/session.mjs'
import { confirmRewind, makeEventGate, maybeAppendSessionEvent } from './lib/gate.mjs'
import { checkpointsProjectionDefinition } from './lib/projection.mjs'
import { SnapshotProviderRegistry } from './lib/providers/registry.mjs'
import { makeGitProvider } from './lib/providers/git.mjs'
import { makeCopyProvider } from './lib/providers/copy.mjs'
import { checkpointSettingsNamespace, checkpointSettingsSchema, validateCheckpointSettings } from './lib/settings-schema.mjs'
import { CheckpointPanelService } from './lib/panel.mjs'

export const name = PLUGIN_NAME

/** 必需服务：缺失即加载失败（响亮）。storageDomain 是可选能力，见 apply 内的降级路径。 */
export const inject = ['sessions', 'commands']

/**
 * 宿主 append 是否盖章 ignorable 信封（运行时能力探测）。
 * 在全新 detached Context 上构造 SessionStore（绝不接入宿主持久化，探测
 * 会话不落盘）：追加一条带 { ignorable: true } 的探测事件并回读信封标记。
 * rc.6 的 append 静默丢弃未知选项键 → 标记缺失 → false（门保持关闭）；
 * 支持 ignorable 信封的宿主 → true（checkpoint/* 以 ignorable 落盘）。
 * 探测留下的空壳 Context/SessionStore 不持有宿主句柄、定时器或监听器，
 * 返回后即成为 GC 垃圾，无需（也没有 API 可）显式收尾。
 * @returns {boolean} 宿主支持 ignorable 信封。
 */
export function probeIgnorableAppend() {
  try {
    const store = new SessionStore(new Context())
    const session = store.create()
    const event = session.append(SESSION_EVENTS.SNAPSHOT, {
      id: 'probe',
      sessionId: 'probe',
      cwd: '/',
      seq: 0,
      time: 0,
      provider: PROVIDERS.COPY,
      triggerTool: 'probe',
      turn: 1,
      step: 1,
      files: 0,
      bytes: 0,
      ref: 'probe',
    }, { ignorable: true })
    return event?.ignorable === true
  } catch {
    return false
  }
}

/**
 * 插件配置（Schemastery，全部可 cordis.yml 覆盖；无硬编码 tunable）。
 * 同构的 zod schema 见 lib/settings-schema.mjs（settings 命名空间，设置页可改）。
 * @typedef {object} Config
 * @property {boolean} [enabled] 整体开关；false 时不注册任何东西。
 * @property {'auto'|'git'|'copy'} [provider] 快照 provider 解析模式。
 * @property {string} [gitBin] git 可执行路径（默认 'git'）。
 * @property {string} [snapshotDir] copy provider 快照根目录；空 = $DSH_HOME/dsh-checkpoint-rewind。
 * @property {number} [maxSnapshots] 每会话保留的检查点上限（默认 50；有界存储·数量界）。
 * @property {number} [maxSnapshotBytes] 全部检查点增量字节总配额（默认 512 MiB；有界存储·大小界；软配额，每会话最新一条总是保留）。
 * @property {boolean} [pruneOnTurnEnd] turn 结束时执行配额清理（默认 true）。
 * @property {string[]} [mutationTools] tools/pre-execute 上视为变更型的工具名。
 * @property {string[]} [excludeGlobs] copy provider 遍历排除的目录/文件名。
 * @property {'auto'|'userQuestions'|'approval'} [confirmVia] 回退确认通道（auto 优先 userQuestions）。
 * @property {number} [listLimit] /rewind 无参列出的最近检查点数（默认 10）。
 * @property {'warn'|'require'|'off'} [preRewindCheckpoint] 回退前的保护检查点策略（默认 warn）。
 * @property {boolean} [verifyByHash] copy provider 内容哈希校验（默认 false）。
 * @property {{enabled: boolean, intervalMinutes: number}} [autoCheckpoint]
 *   自动间隔快照：step/start 时检查；intervalMinutes=0 每步；enabled=false 关闭（默认开、每步）。
 * @property {'restore'|'reset-hard'} [workspaceRestore] 工作区回滚实现（默认 restore 安全覆盖；
 *   reset-hard = git reset --hard <快照提交>，CC 对标，默认关）。
 * @property {boolean} [promptSection] 注入一句角色陈述式短提示词段落（默认 true）。
 * @property {boolean} [checkpointTool] 注册 checkpoint 模型工具（默认 true）。
 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(DEFAULTS.ENABLED),
  provider: Schema.union(Object.values(PROVIDER_MODES)).default(DEFAULTS.PROVIDER),
  gitBin: Schema.string().default(DEFAULTS.GIT_BIN),
  snapshotDir: Schema.string().default(DEFAULTS.SNAPSHOT_DIR),
  maxSnapshots: Schema.number().default(DEFAULTS.MAX_SNAPSHOTS),
  maxSnapshotBytes: Schema.number().default(DEFAULTS.MAX_SNAPSHOT_BYTES),
  pruneOnTurnEnd: Schema.boolean().default(DEFAULTS.PRUNE_ON_TURN_END),
  mutationTools: Schema.array(Schema.string()).default([...DEFAULTS.MUTATION_TOOLS]),
  excludeGlobs: Schema.array(Schema.string()).default([...DEFAULTS.EXCLUDE_GLOBS]),
  confirmVia: Schema.union(Object.values(CONFIRM_CHANNELS)).default(DEFAULTS.CONFIRM_VIA),
  listLimit: Schema.number().default(DEFAULTS.LIST_LIMIT),
  preRewindCheckpoint: Schema.union(Object.values(PRE_REWIND_MODES)).default(DEFAULTS.PRE_REWIND_CHECKPOINT),
  verifyByHash: Schema.boolean().default(DEFAULTS.VERIFY_BY_HASH),
  autoCheckpoint: Schema.object({
    enabled: Schema.boolean().default(DEFAULTS.AUTO_CHECKPOINT_ENABLED),
    intervalMinutes: Schema.number().default(DEFAULTS.AUTO_CHECKPOINT_INTERVAL_MINUTES),
  }).default({
    enabled: DEFAULTS.AUTO_CHECKPOINT_ENABLED,
    intervalMinutes: DEFAULTS.AUTO_CHECKPOINT_INTERVAL_MINUTES,
  }),
  workspaceRestore: Schema.union(Object.values(WORKSPACE_RESTORE_MODES)).default(DEFAULTS.WORKSPACE_RESTORE),
  promptSection: Schema.boolean().default(DEFAULTS.PROMPT_SECTION),
  checkpointTool: Schema.boolean().default(DEFAULTS.CHECKPOINT_TOOL),
})

/**
 * 显式补齐默认 + 加载期校验（非法配置响亮失败）。
 * @param {Partial<Config>|undefined} config - cordis loader 传入的配置。
 * @returns {Required<Config>} 校验后的配置。
 */
export function resolveConfig(config = {}) {
  const resolved = {
    enabled: config.enabled ?? DEFAULTS.ENABLED,
    provider: config.provider ?? DEFAULTS.PROVIDER,
    gitBin: config.gitBin ?? DEFAULTS.GIT_BIN,
    snapshotDir: config.snapshotDir ?? DEFAULTS.SNAPSHOT_DIR,
    maxSnapshots: config.maxSnapshots ?? DEFAULTS.MAX_SNAPSHOTS,
    maxSnapshotBytes: config.maxSnapshotBytes ?? DEFAULTS.MAX_SNAPSHOT_BYTES,
    pruneOnTurnEnd: config.pruneOnTurnEnd ?? DEFAULTS.PRUNE_ON_TURN_END,
    mutationTools: config.mutationTools ?? [...DEFAULTS.MUTATION_TOOLS],
    excludeGlobs: config.excludeGlobs ?? [...DEFAULTS.EXCLUDE_GLOBS],
    confirmVia: config.confirmVia ?? DEFAULTS.CONFIRM_VIA,
    listLimit: config.listLimit ?? DEFAULTS.LIST_LIMIT,
    preRewindCheckpoint: config.preRewindCheckpoint ?? DEFAULTS.PRE_REWIND_CHECKPOINT,
    verifyByHash: config.verifyByHash ?? DEFAULTS.VERIFY_BY_HASH,
    autoCheckpoint: {
      enabled: config.autoCheckpoint?.enabled ?? DEFAULTS.AUTO_CHECKPOINT_ENABLED,
      intervalMinutes: config.autoCheckpoint?.intervalMinutes ?? DEFAULTS.AUTO_CHECKPOINT_INTERVAL_MINUTES,
    },
    workspaceRestore: config.workspaceRestore ?? DEFAULTS.WORKSPACE_RESTORE,
    promptSection: config.promptSection ?? DEFAULTS.PROMPT_SECTION,
    checkpointTool: config.checkpointTool ?? DEFAULTS.CHECKPOINT_TOOL,
  }
  if (resolved.enabled === false) return resolved
  if (!Object.values(PROVIDER_MODES).includes(resolved.provider)) {
    throw badConfig(`provider ${JSON.stringify(resolved.provider)} must be one of auto|git|copy`)
  }
  if (!Object.values(CONFIRM_CHANNELS).includes(resolved.confirmVia)) {
    throw badConfig(`confirmVia ${JSON.stringify(resolved.confirmVia)} must be one of auto|userQuestions|approval`)
  }
  if (!Object.values(PRE_REWIND_MODES).includes(resolved.preRewindCheckpoint)) {
    throw badConfig(`preRewindCheckpoint ${JSON.stringify(resolved.preRewindCheckpoint)} must be one of warn|require|off`)
  }
  if (!Object.values(WORKSPACE_RESTORE_MODES).includes(resolved.workspaceRestore)) {
    throw badConfig(`workspaceRestore ${JSON.stringify(resolved.workspaceRestore)} must be one of restore|reset-hard`)
  }
  if (typeof resolved.gitBin !== 'string' || resolved.gitBin.length === 0) {
    throw badConfig('gitBin must be a non-empty string')
  }
  if (!Number.isInteger(resolved.maxSnapshots) || resolved.maxSnapshots < LIMITS.MIN_MAX_SNAPSHOTS) {
    throw badConfig(`maxSnapshots must be an integer ≥ ${LIMITS.MIN_MAX_SNAPSHOTS}`)
  }
  if (!Number.isFinite(resolved.maxSnapshotBytes) || resolved.maxSnapshotBytes < LIMITS.MIN_MAX_SNAPSHOT_BYTES) {
    throw badConfig(`maxSnapshotBytes must be ≥ ${LIMITS.MIN_MAX_SNAPSHOT_BYTES}`)
  }
  if (!Number.isInteger(resolved.listLimit) || resolved.listLimit < LIMITS.MIN_LIST_LIMIT || resolved.listLimit > LIMITS.MAX_LIST_LIMIT) {
    throw badConfig(`listLimit must be an integer in [${LIMITS.MIN_LIST_LIMIT}, ${LIMITS.MAX_LIST_LIMIT}]`)
  }
  if (typeof resolved.verifyByHash !== 'boolean') {
    throw badConfig('verifyByHash must be a boolean')
  }
  if (typeof resolved.autoCheckpoint.enabled !== 'boolean') {
    throw badConfig('autoCheckpoint.enabled must be a boolean')
  }
  if (!Number.isInteger(resolved.autoCheckpoint.intervalMinutes)
    || resolved.autoCheckpoint.intervalMinutes < LIMITS.MIN_AUTO_INTERVAL_MINUTES
    || resolved.autoCheckpoint.intervalMinutes > LIMITS.MAX_AUTO_INTERVAL_MINUTES) {
    throw badConfig(`autoCheckpoint.intervalMinutes must be an integer in [${LIMITS.MIN_AUTO_INTERVAL_MINUTES}, ${LIMITS.MAX_AUTO_INTERVAL_MINUTES}] (0 = every step)`)
  }
  if (typeof resolved.promptSection !== 'boolean' || typeof resolved.checkpointTool !== 'boolean') {
    throw badConfig('promptSection and checkpointTool must be booleans')
  }
  if (!Array.isArray(resolved.mutationTools) || resolved.mutationTools.some(tool => typeof tool !== 'string' || tool.length === 0)) {
    throw badConfig('mutationTools must be an array of non-empty strings')
  }
  if (!Array.isArray(resolved.excludeGlobs) || resolved.excludeGlobs.some(glob => typeof glob !== 'string' || glob.length === 0)) {
    throw badConfig('excludeGlobs must be an array of non-empty strings')
  }
  return resolved
}

/**
 * 插件挂载。enabled:false 时不注册任何东西；非法配置在加载期响亮抛错。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {Partial<Config>} [config] - 插件配置。
 */
export async function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  if (resolved.enabled === false) return

  const logger = ctx.logger(PLUGIN_NAME)
  const warn = (message) => logger.warn(message)
  const eventGate = makeEventGate(KNOWN_SESSION_EVENT_TYPES, probeIgnorableAppend())
  const appendEvent = (session, type, data) => maybeAppendSessionEvent(session, type, data, eventGate, warn)

  // --- 有效配置：cordis.yml（resolved）为基，settings 命名空间存在时其解析值为活配置。
  // settings 写回（含 /rewind config）经 watch 即时生效；settings 卸载回落到 entry。
  let liveConfig = resolved
  let settingsScope
  const liveListeners = new Set()
  const setLive = (next) => {
    liveConfig = next
    for (const listener of liveListeners) listener()
  }
  const onLiveChange = (listener) => {
    liveListeners.add(listener)
    return () => liveListeners.delete(listener)
  }
  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(checkpointSettingsNamespace(), checkpointSettingsSchema, {
      base: resolved,
      expose: true,
      applies: 'live',
      validate: validateCheckpointSettings,
    })
    settingsScope = scope
    setLive(scope.get())
    const unwatch = scope.watch((next) => setLive(next))
    sctx.effect(() => () => {
      unwatch()
      if (settingsScope === scope) settingsScope = undefined
      setLive(resolved)
    }, `${PLUGIN_NAME}.settings`)
  })

  // --- provider seam：两个 provider 经 registry 注册（注册即 effect，卸载撤销）。
  const registry = new SnapshotProviderRegistry()
  const unregGit = registry.register(makeGitProvider({ gitBin: resolved.gitBin }))
  let snapshotDirCache
  const getSnapshotDir = () => {
    if (snapshotDirCache === undefined) snapshotDirCache = resolveSnapshotDir(resolved.snapshotDir)
    return snapshotDirCache
  }
  const unregCopy = registry.register(makeCopyProvider({
    snapshotDir: getSnapshotDir,
    excludeGlobs: resolved.excludeGlobs,
    verifyByHash: resolved.verifyByHash,
  }))
  ctx.effect(() => () => {
    unregGit()
    unregCopy()
  }, `${PLUGIN_NAME}.providers`)

  // --- 检查点注册表：ctx.storageDomain 域 'checkpoints'（异步打开，命令/快照路径 await）。
  // storageDomain 是可选服务：宿主未组合存储栈时插件照常挂载，绝不把 profile
  // 卡在 pending——checkpoint/rewind 路径按消费方各自处理拒绝（命令返回结构化
  // 错误并说明组合方法，自动快照/补记/清理只记日志），失败大声、优雅降级。
  const storageDomain = ctx.get('storageDomain')
  const tablePromise = storageDomain === undefined
    ? Promise.reject(registryUnavailable(
      'the storageDomain service is not composed in this profile — add the storage stack rows '
      + '(@deepseek-ai/dsh-storage + @deepseek-ai/dsh-storage-json with config.root + '
      + '@deepseek-ai/dsh-storage-domain with config.backend: json) to enable checkpoints',
    ))
    : storageDomain.open(checkpointsDomainSpec).then((domain) => {
        ctx.effect(() => () => { void domain.close() }, `${PLUGIN_NAME}.domain.close`)
        return domain.table('checkpoints')
      })
  if (storageDomain === undefined) {
    warn('storageDomain service not composed: checkpoints/rewind stay unavailable (add @deepseek-ai/dsh-storage + @deepseek-ai/dsh-storage-json + @deepseek-ai/dsh-storage-domain rows with backend json to enable them)')
  }
  tablePromise.catch(() => {}) // 消费方各自处理拒绝；此处仅避免未处理拒绝告警。

  // 领域写操作链：快照落盘、边界补记、清理按序执行；命令执行前先 await 排空。
  let ops = Promise.resolve()
  const schedule = (fn) => {
    const run = ops.then(fn, fn)
    ops = run.then(() => undefined, () => undefined)
    return run
  }

  // --- 每会话运行时状态（turn/step 跟踪 + 每步去重窗 + 捕获互斥 + 自动间隔时钟）。
  const stateBySession = new WeakMap()
  const ensureState = (session) => {
    let state = stateBySession.get(session)
    if (state === undefined) {
      state = {
        turn: undefined,
        step: undefined,
        snapshotKey: undefined,
        inFlight: undefined,
        autoInFlight: undefined,
        lastAutoAt: undefined,
      }
      stateBySession.set(session, state)
    }
    return state
  }

  // --- 会话事件：turn/step 跟踪 + 自动间隔快照 + 边界补记 + turn 结束清理。
  ctx.on('session/event', (session, event) => {
    switch (event.type) {
      case 'turn/start': {
        const state = ensureState(session)
        state.turn = event.data.turn
        state.step = undefined
        break
      }
      case 'step/start': {
        const state = ensureState(session)
        state.turn = event.data.turn
        state.step = event.data.step
        void autoCheckpointOnStep(session)
        break
      }
      case 'step/end': {
        const state = ensureState(session)
        state.step = undefined // 步骤闭合后不再是当前步骤
        backfillStepEnd(session, event.data.turn, event.data.step, event.seq)
        break
      }
      case 'turn/end': {
        const state = ensureState(session)
        state.turn = undefined
        state.step = undefined
        if (liveConfig.pruneOnTurnEnd) pruneAll(session, PRUNE_REASONS.TURN_END)
        break
      }
      default:
        break
    }
  })

  /**
   * 当前开放 turn/step。事件跟踪失效（插件晚于会话挂载）时回退折叠日志尾部；
   * 已闭合的 step/turn 一律返回 undefined（没有可关联的边界）。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @returns {{turn: number, step: number}|undefined} 开放步骤或 undefined。
   */
  function currentStepOf(session) {
    const state = ensureState(session)
    if (state.turn !== undefined && state.step !== undefined) {
      return { turn: state.turn, step: state.step }
    }
    let turn
    let step
    let turnEnded = false
    let stepEnded = true
    for (const event of session.events) {
      if (event.type === 'turn/start') {
        turn = event.data.turn
        step = undefined
        turnEnded = false
        stepEnded = true
      } else if (event.type === 'turn/end') {
        turnEnded = true
      } else if (event.type === 'step/start') {
        turn = event.data.turn
        step = event.data.step
        stepEnded = false
      } else if (event.type === 'step/end') {
        stepEnded = true
      }
    }
    if (turnEnded || stepEnded || turn === undefined || step === undefined) return undefined
    return { turn, step }
  }

  /**
   * 最近一个出现过的 turn/step（开放或已闭合；手动/保护检查点的定位用）。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @returns {{turn: number, step: number}|undefined} 最近位置或 undefined。
   */
  function latestStepOf(session) {
    let turn
    let step
    for (const event of session.events) {
      if (event.type === 'turn/start') {
        turn = event.data.turn
        step = undefined
      } else if (event.type === 'step/start') {
        turn = event.data.turn
        step = event.data.step
      }
    }
    if (turn === undefined || step === undefined) return undefined
    return { turn, step }
  }

  /**
   * 该会话最近一条检查点（去重基准：同 provider 才可比）。
   * @param {import('@deepseek-ai/dsh-storage-domain').KvTable<string, object>} table - 检查点表。
   * @param {string} sessionId - 会话 id。
   * @param {string} cwd - 工作区绝对路径。
   * @returns {object|undefined} 最近记录。
   */
  function latestRecordFor(table, sessionId, cwd) {
    const key = workspaceKeyOf(cwd)
    const mine = [...table.entries()]
      .filter(([, record]) => record.sessionId === sessionId && workspaceKeyOf(record.cwd) === key)
      .map(([, record]) => record)
    return sortOldestFirst(mine).at(-1)
  }

  /** 配置快照（普通 JSON 深拷贝，进入检查点记录）。 */
  const snapshotConfigOf = (config) => structuredClone(config)

  /**
   * 统一捕获：工作区快照 + 三态记录落盘。返回 {record}（成功）/ {deduped}
   * （与上一检查点内容一致）/ {failed: message}（已警告）。绝不抛出。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @param {object} opts - {kind, triggerTool, note?, retryWithoutBaseline?}。
   * @returns {Promise<{record?: object, deduped?: boolean, failed?: string}|undefined>} 捕获结果；会话无 cwd 时为 undefined。
   */
  async function captureCheckpoint(session, opts) {
    const cwd = session.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) {
      warn('checkpoint skipped: session has no cwd')
      return undefined
    }
    const pos = currentStepOf(session) ?? latestStepOf(session)
    if (pos === undefined) {
      logger.debug(`checkpoint skipped: session has no turn/step history yet (trigger ${opts.triggerTool})`)
      return undefined
    }
    try {
      const cursor = session.seq
      const boundary = sessionBoundaryAt(session.events, cursor)
      const table = await tablePromise
      const provider = await registry.resolve(liveConfig.provider, { cwd, key: workspaceKeyOf(cwd) })
      const previous = latestRecordFor(table, session.id, cwd)
      const previousRef = previous !== undefined && previous.provider === provider.name ? previous.ref : undefined
      let result
      try {
        result = await provider.snapshot(
          { cwd, key: workspaceKeyOf(cwd) },
          { triggerTool: opts.triggerTool, previousRef },
        )
      } catch (error) {
        // 保护检查点不能依赖上一检查点的存储完整性（去重基线不可读时整条
        // 捕获会失败）：退化为无基线重捕，保证回退仍可撤回。
        if (opts.retryWithoutBaseline !== true || previousRef === undefined) throw error
        logger.warn(`checkpoint dedup baseline unreadable (${messageOf(error)}), capturing without dedup`)
        result = await provider.snapshot({ cwd, key: workspaceKeyOf(cwd) }, { triggerTool: opts.triggerTool })
      }
      if (result === null) {
        logger.debug(`checkpoint deduped: workspace unchanged (trigger ${opts.triggerTool})`)
        return { deduped: true }
      }
      const note = typeof opts.note === 'string' && opts.note.trim().length > 0
        ? opts.note.trim().slice(0, LIMITS.MAX_NOTE_LENGTH)
        : undefined
      const record = {
        id: randomUUID(),
        sessionId: session.id,
        cwd,
        seq: cursor,
        time: Date.now(),
        provider: provider.name,
        kind: opts.kind,
        triggerTool: opts.triggerTool,
        turn: pos.turn,
        step: pos.step,
        files: result.files,
        bytes: result.bytes,
        ref: result.ref,
        tree: result.tree ?? null,
        config: snapshotConfigOf(liveConfig),
        ...(note === undefined ? {} : { note }),
        ...(typeof boundary === 'number' ? { sessionBoundary: boundary } : {}),
      }
      await schedule(() => table.put(record.id, record))
      if (record.bytes > liveConfig.maxSnapshotBytes) {
        warn(`checkpoint ${record.id} alone exceeds maxSnapshotBytes (${record.bytes} > ${liveConfig.maxSnapshotBytes}); the per-session newest-retained floor keeps it, older checkpoints will be pruned`)
      }
      appendEvent(session, SESSION_EVENTS.SNAPSHOT, record)
      logger.info(`checkpoint ${record.id} captured (${record.kind}, ${record.provider}, turn ${record.turn} step ${record.step}, cursor seq ${record.seq}, ${record.files} files, ${record.bytes} bytes, trigger ${record.triggerTool})`)
      await pruneAll(session)
      return { record }
    } catch (error) {
      warn(`checkpoint capture failed (trigger ${opts.triggerTool}): ${messageOf(error)}`)
      return { failed: messageOf(error) }
    }
  }

  /**
   * 变更前快照（安全网）：每 (session, turn, step) 最多一次；并发意图共享
   * 同一次捕获。失败只记日志，绝不阻断工具执行（快照是安全网，不是策略）。
   * @param {import('@deepseek-ai/dsh-session').Session|null|undefined} session - 会话。
   * @param {string} triggerTool - 触发工具名。
   * @returns {Promise<void>} 完成（含失败）。
   */
  async function snapshotForMutation(session, triggerTool) {
    if (session === null || session === undefined) return
    const pos = currentStepOf(session)
    if (pos === undefined) return // 不在开放步骤内：没有可关联的边界。
    const state = ensureState(session)
    const windowKey = `${pos.turn}:${pos.step}`
    if (state.snapshotKey === windowKey) return
    if (state.inFlight !== undefined) {
      await state.inFlight.catch(() => {})
      return // 并发意图：共享同一捕获（成功与否都不重试本步骤）。
    }
    const run = (async () => {
      try {
        await captureCheckpoint(session, { kind: CHECKPOINT_KINDS.MUTATION, triggerTool })
      } finally {
        state.inFlight = undefined
        state.snapshotKey = windowKey
      }
    })()
    state.inFlight = run
    await run
  }

  /**
   * 自动间隔快照（step/start 触发）：autoCheckpoint.enabled 开启时，每步或按
   * intervalMinutes 间隔捕获。与变更安全网互不阻塞（独立串行链）；失败不重试
   * 本步（下一间隔再试）。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @returns {Promise<void>} 完成。
   */
  async function autoCheckpointOnStep(session) {
    const auto = liveConfig.autoCheckpoint
    if (auto.enabled !== true) return
    const state = ensureState(session)
    const now = Date.now()
    if (auto.intervalMinutes > 0 && state.lastAutoAt !== undefined
      && now - state.lastAutoAt < auto.intervalMinutes * 60000) {
      return
    }
    if (state.autoInFlight !== undefined) {
      await state.autoInFlight.catch(() => {})
      return
    }
    const run = (async () => {
      const result = await captureCheckpoint(session, { kind: CHECKPOINT_KINDS.AUTO, triggerTool: AUTO_TRIGGER })
      if (result?.failed === undefined) state.lastAutoAt = Date.now()
    })()
    state.autoInFlight = run
    try {
      await run
    } finally {
      state.autoInFlight = undefined
    }
  }

  /**
   * pre-rewind 保护检查点：确认通过后、恢复之前捕获当前三态，让本次回退
   * 可撤回（/rewind <guard-id> 即可撤销）。命令运行于轮次之间，定位用
   * latestStepOf（最近出现的 turn/step），不要求开放步骤。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @returns {Promise<{record: object}|undefined>} 捕获的记录；跳过/去重为 undefined。
   */
  async function captureRewindGuard(session) {
    if (liveConfig.preRewindCheckpoint === PRE_REWIND_MODES.OFF) return undefined
    if (latestStepOf(session) === undefined) return undefined // 无轮次历史：没有检查点可回退，无需保护
    const result = await captureCheckpoint(session, {
      kind: CHECKPOINT_KINDS.GUARD,
      triggerTool: PRE_REWIND_TRIGGER,
      retryWithoutBaseline: true,
    })
    // 保护检查点失败必须上抛（require → 中止；warn → 降级继续），
    // 与"保护失败只警告"的语义区分由 handleRewind 的 catch 承担。
    if (result?.failed !== undefined) throw new Error(result.failed)
    if (result === undefined || result.record === undefined) return undefined
    return result
  }

  /** step/end 补记：该 step 内未关联的检查点获得 stepEndSeq（"回到第 N 步"映射）。 */
  function backfillStepEnd(session, turn, step, endSeq) {
    schedule(async () => {
      const table = await tablePromise
      for (const [key, record] of table.entries()) {
        if (record.sessionId !== session.id || record.turn !== turn || record.step !== step || record.stepEndSeq !== undefined) continue
        await table.put(key, { ...record, stepEndSeq: endSeq })
        appendEvent(session, SESSION_EVENTS.BOUND, { id: record.id, turn, step, stepEndSeq: endSeq })
      }
    }).catch(error => warn(`checkpoint step/end backfill failed: ${messageOf(error)}`))
  }

  /**
   * 删除记录及其 provider 存储（先记录后 discard，逐条隔离失败）。
   * @param {Array<{key: string, value: object}>} entries - 全表快照条目。
   * @param {string[]} ids - 待删记录 id。
   * @returns {Promise<void>} 完成（单条失败已警告）。
   */
  async function removeRecords(entries, ids) {
    for (const id of ids) {
      const record = entries.find(entry => entry.key === id)?.value
      try {
        const table = await tablePromise
        await table.delete(id)
      } catch (error) {
        warn(`checkpoint ${id} record deletion failed: ${messageOf(error)}`)
        continue
      }
      if (record === undefined) continue
      const provider = registry.get(record.provider)
      if (provider === undefined) continue
      try {
        await provider.discard({ cwd: record.cwd, key: workspaceKeyOf(record.cwd) }, record.ref)
      } catch (error) {
        warn(`checkpoint ${id} storage discard failed (record removed; files may linger until cleanup): ${messageOf(error)}`)
      }
    }
  }

  /**
   * 配额清理（有界存储）：每会话保留最近 maxSnapshots，全局增量字节不超
   * maxSnapshotBytes（软配额，每会话最新一条总是保留），最旧优先。
   * @param {import('@deepseek-ai/dsh-session').Session} triggerSession - 触发会话（事件归属）。
   * @param {string} [reason] - 覆盖触发原因（turn/end 用）；缺省按计划实际规则。
   * @returns {Promise<void>} 完成。
   */
  function pruneAll(triggerSession, reason) {
    return schedule(async () => {
      const table = await tablePromise
      const entries = [...table.entries()].map(([key, value]) => ({ key, value }))
      const plan = prunePlan(entries, { maxSnapshots: liveConfig.maxSnapshots, maxSnapshotBytes: liveConfig.maxSnapshotBytes })
      if (plan.ids.length === 0) return
      await removeRecords(entries, plan.ids)
      const eventReason = reason ?? (plan.byRule.maxSnapshots.length > 0 ? PRUNE_REASONS.MAX_SNAPSHOTS : PRUNE_REASONS.MAX_SNAPSHOT_BYTES)
      appendEvent(triggerSession, SESSION_EVENTS.PRUNE, { ids: plan.ids, reason: eventReason })
      logger.info(`pruned ${plan.ids.length} checkpoint(s) (${eventReason})`)
    }).catch(error => warn(`checkpoint prune failed: ${messageOf(error)}`))
  }

  // --- 变更前快照监听：fs seam（所有经 ctx.fs 的写入/编辑）——prepend 直通，
  // 不占据决策槽（策略插件仍作唯一决策方）。
  const sessionOfActor = (actor) => {
    if (actor === null || typeof actor !== 'object') return undefined
    return actor.agent?.session
  }
  const snapshotPassThrough = async (session, trigger, next) => {
    await snapshotForMutation(session, trigger)
    return next()
  }
  ctx.on('fs/write-intent', (target, actor, next) => snapshotPassThrough(sessionOfActor(actor), 'fs/write-intent', next), { prepend: true })
  ctx.on('fs/edit-intent', (target, actor, next) => snapshotPassThrough(sessionOfActor(actor), 'fs/edit-intent', next), { prepend: true })
  ctx.on('tools/pre-execute', (exec, next) => {
    if (liveConfig.mutationTools.includes(exec?.name)) {
      return snapshotPassThrough(exec?.agent?.session, exec.name, next)
    }
    return next()
  }, { prepend: true })

  // --- 会话投影单元 'checkpoints'（可选能力：宿主装配注册表时经 inject 注册，
  // 无注册表的 headless 组装不受影响；注册随插件 fiber 卸载撤销）。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(checkpointsProjectionDefinition)
  })

  // --- 提示词段落：一句角色陈述开头、保持短小（对齐官方 Minimal persona 风格）。
  // promptSection 配置可关；设置页修改即时生效（段落重新注册）。
  ctx.inject(['systemPrompt'], (promptCtx) => {
    let dispose
    const update = () => {
      dispose?.()
      dispose = undefined
      if (liveConfig.promptSection === true) {
        dispose = promptCtx.systemPrompt.section({
          name: PROMPT_SECTION_NAME,
          order: PROMPT_SECTION_ORDER,
          text: 'Checkpoint keeper: I create unified workspace/session/config checkpoints with /checkpoint or the checkpoint tool, and restore one or all three states with /rewind (approval-gated, with a diff summary first).',
        })
      }
    }
    const unwatch = onLiveChange(update)
    update()
    promptCtx.effect(() => () => {
      unwatch()
      dispose?.()
      dispose = undefined
    }, `${PLUGIN_NAME}.prompt-section`)
  })

  // --- 设置页面板 wire 服务（checkpointPanel Remote：时间线 + 两两 diff；只读）。
  await ctx.plugin(CheckpointPanelService, {
    tablePromise,
    ops,
    registry,
    getLive: () => liveConfig,
  })

  // --- /rewind 命令（三态回滚）。
  ctx.commands.register({
    name: COMMAND_NAME,
    description: 'List checkpoints, compare two, or restore the workspace files, session context, and/or plugin config to one (Claude Code Checkpoints equivalent).',
    input: { hint: '[workspace|session|config|all] <id-prefix | step <N> | latest> | diff <a> <b> | preview <target> | clear' },
    async handler(invocation) {
      return handleRewind(invocation)
    },
  })

  // --- /checkpoint 命令（手动检查点）。
  ctx.commands.register({
    name: CHECKPOINT_COMMAND,
    description: 'Capture a manual unified checkpoint (workspace + session cursor + config snapshot), list checkpoints, or compare two.',
    input: { hint: '[note <text> | list | diff <a> <b>]' },
    async handler(invocation) {
      return handleCheckpoint(invocation)
    },
  })

  // --- checkpoint 模型工具（可选能力：tools 服务装配时注册；配置可关）。
  ctx.inject(['tools'], (toolsCtx) => {
    const update = () => {
      if (liveConfig.checkpointTool === true) {
        toolsCtx.effect(() => toolsCtx.tools.register(defineTool({
          name: CHECKPOINT_TOOL,
          description: 'Capture a manual unified checkpoint of the current session: workspace files (git snapshot), session event cursor, and plugin configuration, with an optional note. Use /rewind later to restore any of the three states. Checkpoints are additive and need no approval.',
          parameters: {
            note: { type: 'string', description: 'Optional short note describing why this checkpoint exists (max 500 chars).' },
          },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
          },
          async execute(args, exec) {
            const session = exec?.agent?.session
            if (session === null || session === undefined) {
              return 'checkpoint: no active session to checkpoint'
            }
            const result = await captureCheckpoint(session, {
              kind: CHECKPOINT_KINDS.MANUAL,
              triggerTool: MANUAL_TRIGGER,
              note: typeof args?.note === 'string' ? args.note : undefined,
            })
            if (result === undefined) return 'checkpoint: session has no workspace or no turn/step history yet'
            if (result.deduped === true) return 'checkpoint: workspace unchanged since the last checkpoint — nothing new was captured'
            if (result.failed !== undefined) return `checkpoint: capture failed (${result.failed}) — no checkpoint was created`
            const record = result.record
            return [
              `checkpoint: captured #${record.id}`,
              `kind: manual · provider: ${record.provider} · turn ${record.turn} step ${record.step}`,
              `session cursor: seq ${record.seq} · workspace tree: ${record.tree ?? 'n/a (copy)'}`,
              `config snapshot: ${Object.keys(record.config).length} key(s)`,
              ...(record.note !== undefined ? [`note: ${record.note}`] : []),
              'restore with /rewind <id> (all three states) or /rewind workspace|session|config <id>',
            ].join('\n')
          },
          presentCall: (args) => `Capture a manual checkpoint${typeof args?.note === 'string' && args.note.length > 0 ? ` (“${args.note}”)` : ''}`,
        })), `${PLUGIN_NAME}.checkpoint-tool`)
      }
    }
    const unwatch = onLiveChange(update)
    update()
    toolsCtx.effect(() => () => { unwatch() }, `${PLUGIN_NAME}.checkpoint-tool.watch`)
  })

  /**
   * 本会话本工作区的检查点记录。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @param {string} cwd - 已校验的工作区。
   * @returns {Promise<object[]>} 记录数组。
   */
  async function mineFor(session, cwd) {
    const table = await tablePromise
    return [...table.entries()]
      .filter(([, record]) => record.sessionId === session.id && workspaceKeyOf(record.cwd) === workspaceKeyOf(cwd))
      .map(([, record]) => record)
  }

  /**
   * 寻址解析：latest / step <N> / id 前缀 → 目标记录或错误文本。
   * @param {object[]} mine - 本会话本工作区的检查点记录。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @param {{kind: string, step?: number, input?: string}} parsed - parseRewindInput 的目标形态。
   * @returns {{record: object} | {error: string}} 命中或错误文本。
   */
  function resolveRewindTarget(mine, session, parsed) {
    if (parsed.kind === 'latest') {
      const record = sortOldestFirst(mine).at(-1)
      if (record === undefined) return { error: 'rewind: no checkpoints yet' }
      return { record }
    }
    if (parsed.kind === 'step') {
      const seq = stepEndSeqOf(session.events, parsed.step)
      if (seq === undefined) {
        return {
          error: `rewind: step ${parsed.step} has not ended or does not exist (steps restart per turn; run /rewind to list checkpoints)`,
        }
      }
      const record = nearestCheckpointAtOrBefore(mine, seq)
      if (record === undefined) return { error: `rewind: no checkpoint at or before step ${parsed.step}` }
      return { record }
    }
    const resolvedId = resolveRecordByPrefix(mine, parsed.input)
    if (resolvedId.record !== undefined) return { record: resolvedId.record }
    if (resolvedId.notFound === true) {
      const err = checkpointNotFound(parsed.input)
      return { error: `rewind: ${err.message}` }
    }
    const err = ambiguousCheckpoint(parsed.input, resolvedId.ambiguous ?? [])
    return { error: `rewind: ${err.message}` }
  }

  /**
   * 两两对比（/rewind diff 与 /checkpoint diff 共用）。
   * @param {object[]} records - 同会话同工作区的记录。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @param {string} a - 旧检查点 id 或前缀。
   * @param {string} b - 新检查点 id 或前缀。
   * @param {string} command - 'rewind' | 'checkpoint'（错误前缀）。
   * @returns {Promise<import('@deepseek-ai/dsh-commands').CommandResult>} 命令结果。
   */
  async function handleDiff(records, session, a, b, command) {
    const ra = resolveRecordByPrefix(records, a)
    const rb = resolveRecordByPrefix(records, b)
    if (ra.notFound === true || rb.notFound === true) {
      const err = checkpointNotFound(ra.notFound === true ? a : b)
      return { kind: 'error', text: `${command}: ${err.message}` }
    }
    if (ra.ambiguous !== undefined || rb.ambiguous !== undefined) {
      const err = ambiguousCheckpoint(ra.ambiguous !== undefined ? a : b, (ra.ambiguous ?? rb.ambiguous) ?? [])
      return { kind: 'error', text: `${command}: ${err.message}` }
    }
    const from = ra.record
    const to = rb.record
    if (from.provider !== to.provider) {
      const err = diffUnavailable(`checkpoints use different providers (${from.provider} vs ${to.provider})`)
      return { kind: 'error', text: `${command}: ${err.message}` }
    }
    const provider = registry.get(from.provider)
    if (provider === undefined || typeof provider.diffFiles !== 'function') {
      const err = diffUnavailable(`provider ${from.provider} does not support pairwise diff`)
      return { kind: 'error', text: `${command}: ${err.message}` }
    }
    try {
      const files = await provider.diffFiles({ cwd: session.header?.cwd, key: workspaceKeyOf(session.header?.cwd) }, from.ref, to.ref)
      const names = files.names.slice(0, LIMITS.MAX_DIFF_FILES)
      const text = formatCheckpointDiff(from, to, {
        files: { changed: files.changed, added: files.added, removed: files.removed, names, truncated: files.names.length > names.length },
        configDiff: configDiff(from.config, to.config),
        session: sessionDelta(from, to),
        note: typeof to.note === 'string' && to.note.length > 0 ? to.note : (typeof from.note === 'string' && from.note.length > 0 ? from.note : ''),
      })
      return { kind: 'success', text }
    } catch (error) {
      const message = messageOf(error)
      logger.error(`checkpoint diff failed (${from.id} → ${to.id}): ${message}`)
      return { kind: 'error', text: `${command}: diff failed (${message})` }
    }
  }

  /**
   * /rewind preview：只读影响面预览——不写文件、不经确认门、不 fork，
   * 只报告该检查点恢复将覆盖/保留哪些文件（确认前知情权）。
   * @param {object[]} mine - 本会话本工作区的检查点记录。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @param {string} cwd - 已校验的工作区。
   * @param {string} target - preview 之后的原始寻址文本。
   * @returns {Promise<import('@deepseek-ai/dsh-commands').CommandResult>} 命令结果。
   */
  async function handlePreview(mine, session, cwd, target) {
    const parsed = parseRewindInput(target)
    if (parsed.kind !== 'latest' && parsed.kind !== 'step' && parsed.kind !== 'id') {
      return {
        kind: 'error',
        text: `rewind: ${parsed.kind === 'invalid' ? parsed.message : 'usage: /rewind preview <id-prefix | step <N> | latest>'}`,
      }
    }
    const hit = resolveRewindTarget(mine, session, parsed)
    if (hit.error !== undefined) {
      return { kind: 'error', text: hit.error }
    }
    const record = hit.record
    const provider = registry.get(record.provider)
    if (provider === undefined || typeof provider.preview !== 'function') {
      return {
        kind: 'error',
        text: `rewind: preview is not supported by the ${record.provider} provider for checkpoint ${record.id}`,
      }
    }
    try {
      const preview = await provider.preview({ cwd, key: workspaceKeyOf(cwd) }, record.ref)
      logger.info(`rewind preview: checkpoint ${record.id} (${record.provider}) → ${preview.restore} overwrite / ${preview.unchanged} unchanged / ${preview.leftovers.length} leftovers`)
      return { kind: 'success', text: formatPreviewResult(record, preview) }
    } catch (error) {
      const message = messageOf(error)
      logger.error(`rewind preview failed (checkpoint ${record.id}, provider ${record.provider}): ${message}`)
      return { kind: 'error', text: `rewind: preview failed for checkpoint ${record.id} (${message}). No files were changed.` }
    }
  }

  /**
   * 三态回滚影响摘要（确认门 detail 与结果文本共用）。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @param {object} record - 目标检查点。
   * @param {string} cwd - 已校验的工作区。
   * @param {{workspace: boolean, session: boolean, config: boolean}} targets - 回滚目标。
   * @returns {Promise<object>} {workspace, config, session, mode}。
   */
  async function buildRewindImpact(session, record, cwd, targets) {
    const impact = {}
    if (targets.workspace) {
      const provider = registry.get(record.provider)
      const mode = liveConfig.workspaceRestore === WORKSPACE_RESTORE_MODES.RESET_HARD && typeof provider?.resetHard === 'function'
        ? WORKSPACE_RESTORE_MODES.RESET_HARD
        : WORKSPACE_RESTORE_MODES.RESTORE
      impact.mode = mode
      if (typeof provider?.preview === 'function') {
        try {
          impact.workspace = await provider.preview({ cwd, key: workspaceKeyOf(cwd) }, record.ref)
        } catch (error) {
          impact.workspaceError = messageOf(error)
        }
      }
    }
    if (targets.config) {
      impact.config = configDiff(record.config, snapshotConfigOf(liveConfig))
    }
    if (targets.session) {
      impact.session = {
        cursor: record.seq,
        boundary: typeof record.sessionBoundary === 'number' ? record.sessionBoundary : undefined,
        currentCursor: session.seq,
        replayable: typeof record.sessionBoundary === 'number' || record.seq === 0,
      }
    }
    return impact
  }

  /**
   * 影响摘要 → 文本（确认 detail + 回退结果前缀）。
   * @param {object} record - 目标检查点。
   * @param {object} impact - buildRewindImpact 产物。
   * @returns {string} 多行文本。
   */
  function formatImpact(record, impact) {
    const lines = []
    if (impact.workspace !== undefined) {
      const mode = impact.mode === WORKSPACE_RESTORE_MODES.RESET_HARD
        ? 'git reset --hard (branch head moves to the snapshot commit; pre-snapshot history stays recoverable via reflog)'
        : 'safe overwrite (files created after the checkpoint are left in place)'
      lines.push(`workspace: ${impact.workspace.restore} file(s) will be overwritten via ${mode}`)
      lines.push(`  (${impact.workspace.unchanged} unchanged, ${impact.workspace.leftovers.length} created-after kept)`)
    } else if (impact.workspaceError !== undefined) {
      lines.push(`workspace impact preview failed: ${impact.workspaceError}`)
    }
    if (impact.config !== undefined) {
      lines.push(impact.config.changed
        ? `config: ${impact.config.lines} line(s) differ from the checkpoint snapshot`
        : 'config: current config already matches the checkpoint snapshot')
    }
    if (impact.session !== undefined) {
      lines.push(typeof impact.session.boundary === 'number'
        ? `session: a new child session will replay events up to seq ${impact.session.boundary} (end of the turn before this checkpoint); this session keeps its full history`
        : 'session: a fresh child session with empty context will be created (checkpoint captured before any closed turn)')
      lines.push(`  (current cursor seq ${impact.session.currentCursor} → checkpoint cursor seq ${impact.session.cursor})`)
    }
    return lines.join('\n')
  }

  /** 目标集合 → 确认文案（一体/单态措辞）。 */
  function confirmTextsFor(targets) {
    const count = (targets.workspace ? 1 : 0) + (targets.session ? 1 : 0) + (targets.config ? 1 : 0)
    if (count >= 2) {
      return {
        question: 'Restore the workspace, session context, and/or configuration to this checkpoint?',
        approveLabel: 'Restore',
        approveDescription: 'Apply every selected state of this checkpoint after the diff summary above.',
      }
    }
    if (targets.workspace) {
      return {
        question: 'Restore the workspace files to this checkpoint?',
        approveLabel: 'Restore files',
        approveDescription: 'Overwrite workspace files with the checkpoint content (guard checkpoint captured first).',
      }
    }
    if (targets.session) {
      return {
        question: 'Replay the session context from this checkpoint?',
        approveLabel: 'Replay session',
        approveDescription: 'Create a new child session seeded with events up to the checkpoint boundary; this session is untouched.',
      }
    }
    return {
      question: 'Restore the plugin configuration to this checkpoint snapshot?',
      approveLabel: 'Restore config',
      approveDescription: 'Write the checkpoint config snapshot back to the settings namespace (persisted).',
    }
  }

  /**
   * 配置还原：settings 命名空间写回（持久）；无 settings 服务时进程内回退
   * （结果文本明示非持久，绝不静默降级）。
   * @param {object} snapshot - 检查点 config 快照。
   * @returns {Promise<{durable: boolean, note: string}>} 还原说明。
   */
  async function restoreConfig(snapshot) {
    if (settingsScope !== undefined) {
      await settingsScope.replace(snapshot)
      return { durable: true, note: 'config restored through the settings namespace (persisted in the settings document)' }
    }
    const next = { ...resolved, ...snapshot }
    validateCheckpointSettings(next)
    setLive(next)
    return { durable: false, note: 'no settings service attached: config restored in-process only (a harness restart reloads cordis.yml defaults)' }
  }

  /**
   * 会话回退：官方重放 —— 以检查点边界为界 seed 出全新子会话
   * （sessions.create(id,{seed})）。原会话完整保留（非破坏，CC 差异化）。
   * @param {import('@deepseek-ai/dsh-session').Session} source - 源会话。
   * @param {object} record - 目标检查点。
   * @returns {import('@deepseek-ai/dsh-session').Session} 子会话。
   */
  function replaySession(source, record) {
    const boundary = typeof record.sessionBoundary === 'number' ? record.sessionBoundary : undefined
    const seed = replaySeedOf(source.events, boundary)
    const meta = {
      ...(typeof source.header?.cwd === 'string' && source.header.cwd.length > 0 ? { cwd: source.header.cwd } : {}),
      parentSession: source.id,
      seedLength: seed.length,
    }
    return ctx.sessions.create(undefined, { seed, meta })
  }

  /**
   * 向重放子会话注入一条回退通知：说明哪些状态已恢复、之后的结果可能失效。
   * 通知是持久的 user/message（plugin source），派生历史会投影它。
   * @param {import('@deepseek-ai/dsh-session').Session} child - 重放子会话。
   * @param {object} record - 检查点记录。
   * @param {object} segments - {workspace?, config?, session?, workspaceNote?, configNote?}。
   * @param {{record: object}|undefined} guard - pre-rewind 保护检查点。
   */
  function injectReplayNotice(child, record, segments, guard) {
    const text = [
      `Checkpoint rewind: this session was replayed from checkpoint ${record.id} (turn ${record.turn} step ${record.step}).`,
      segments.workspace
        ? `Workspace files were restored to that checkpoint's git tree (${record.tree ?? 'copy snapshot'}); ${segments.workspaceNote ?? ''}`.trim()
        : 'Workspace files were NOT changed by this rewind.',
      segments.config
        ? `Plugin configuration was restored to the checkpoint's config snapshot; ${segments.configNote ?? ''}`.trim()
        : '',
      guard?.record !== undefined
        ? `This rewind captured a guard checkpoint ${guard.record.id} in the original session; restore it there to undo this rewind.`
        : '',
      'Tool results recorded after that point may no longer reflect the workspace or configuration; re-check the state before continuing.',
    ].filter(line => line.length > 0).join('\n')
    try {
      child.append('user/message', createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'rewind-notice', summary: 'rewind' },
      }), { surfaceOp: 'append' })
    } catch (error) {
      // 通知是锦上添花：append 失败绝不能把一次成功的回退变成失败。
      logger.warn(`rewind notice injection into child session ${child.id} failed: ${messageOf(error)}`)
    }
  }

  /**
   * /rewind 命令处理器（三态回滚事务：保护检查点 → 工作区 → 配置 → 会话重放）。
   * @param {import('@deepseek-ai/dsh-commands').CommandInvocation} invocation - 命令调用。
   * @returns {Promise<import('@deepseek-ai/dsh-commands').CommandResult>} 命令结果。
   */
  async function handleRewind(invocation) {
    const { agent, rawInput, signal } = invocation
    const session = agent?.session
    if (session === null || session === undefined) {
      return { kind: 'error', text: 'rewind: no active session' }
    }
    const cwd = session.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) {
      return { kind: 'error', text: 'rewind: session has no workspace cwd' }
    }
    let table
    try {
      await ops
      table = await tablePromise
    } catch (error) {
      const err = registryUnavailable(messageOf(error))
      logger.error(err.message)
      return { kind: 'error', text: `rewind: ${err.message}` }
    }
    const mine = await mineFor(session, cwd)

    const parsed = parseRewindInput(rawInput)
    if (parsed.kind === 'invalid') {
      return { kind: 'error', text: `rewind: ${parsed.message}` }
    }
    if (parsed.kind === 'list') {
      const newest = sortOldestFirst(mine).slice(-liveConfig.listLimit)
      return { kind: 'success', text: formatCheckpointList(newest, { now: Date.now(), total: mine.length, command: 'rewind' }) }
    }
    if (parsed.kind === 'clear') {
      return handleClear(mine, session, agent, signal)
    }
    if (parsed.kind === 'preview') {
      return handlePreview(mine, session, cwd, parsed.target)
    }
    if (parsed.kind === 'diff') {
      return handleDiff(mine, session, parsed.a, parsed.b, 'rewind')
    }

    // 三态目标：显式 target / 缺省（id/latest/step）= 一体回滚。
    // 显式 target 的内层支持完整寻址语法（workspace|session|config|all
    // <id | step N | latest>）：内层再解析一次得到寻址形态。
    let target
    let targets
    if (parsed.kind === 'target') {
      const inner = parseRewindInput(parsed.input)
      if (inner.kind === 'invalid') {
        return { kind: 'error', text: `rewind: ${inner.message}` }
      }
      if (inner.kind !== 'id' && inner.kind !== 'latest' && inner.kind !== 'step') {
        return { kind: 'error', text: 'rewind: usage: /rewind [workspace|session|config|all] <id-prefix | step <N> | latest>' }
      }
      const hit = resolveRewindTarget(mine, session, inner)
      if (hit.error !== undefined) return { kind: 'error', text: hit.error }
      target = hit
      targets = parsed.target === REWIND_TARGETS.ALL
        ? { workspace: true, session: true, config: true }
        : {
          workspace: parsed.target === REWIND_TARGETS.WORKSPACE,
          session: parsed.target === REWIND_TARGETS.SESSION,
          config: parsed.target === REWIND_TARGETS.CONFIG,
        }
    } else {
      const hit = resolveRewindTarget(mine, session, parsed)
      if (hit.error !== undefined) return { kind: 'error', text: hit.error }
      target = hit
      targets = { workspace: true, session: true, config: true }
    }
    const record = target.record

    // 回滚前影响摘要（三态各自 diff，确认前知情权）。
    let impact
    try {
      impact = await buildRewindImpact(session, record, cwd, targets)
    } catch (error) {
      const message = messageOf(error)
      logger.error(`rewind impact preview failed (checkpoint ${record.id}): ${message}`)
      return { kind: 'error', text: `rewind: failed to preview the rollback impact (${message}). Nothing was changed.` }
    }
    const summary = [
      formatRewindSummary(record),
      '',
      'impact:',
      formatImpact(record, impact),
    ].join('\n')

    // 确认门：任何覆盖/回滚写操作必须先经 ask 语义，无回答者失败关闭。
    const texts = confirmTextsFor(targets)
    const verdict = await confirmRewind({ ctx, confirmVia: liveConfig.confirmVia, summary, ...texts }, agent, signal)
    if (!verdict.allowed) {
      appendEvent(session, SESSION_EVENTS.REWIND, {
        checkpointId: record.id, sessionId: session.id, outcome: REWIND_OUTCOMES.DENIED,
        target: parsed.kind === 'target' ? parsed.target : REWIND_TARGETS.ALL, error: verdict.reason,
      })
      logger.info(`rewind denied: checkpoint ${record.id} (${verdict.channel}: ${verdict.reason})`)
      const err = rewindDenied(verdict.reason)
      return { kind: 'error', text: `rewind: ${err.message}` }
    }
    logger.info(`rewind approved (${verdict.channel}): checkpoint ${record.id}, targets ${JSON.stringify(targets)}, phase 0.5 = pre-rewind guard`)

    // 阶段 0.5：保护当前状态 —— 先捕获 pre-rewind 检查点，让本次回退可撤回。
    let guard
    try {
      guard = await captureRewindGuard(session)
    } catch (error) {
      const message = messageOf(error)
      if (liveConfig.preRewindCheckpoint === PRE_REWIND_MODES.REQUIRE) {
        appendEvent(session, SESSION_EVENTS.REWIND, {
          checkpointId: record.id, sessionId: session.id, outcome: REWIND_OUTCOMES.FAILED,
          target: parsed.kind === 'target' ? parsed.target : REWIND_TARGETS.ALL,
          error: `pre-rewind checkpoint failed: ${message}`,
        })
        logger.error(`rewind aborted (pre-rewind checkpoint required): ${message}`)
        return {
          kind: 'error',
          text: `rewind: aborted — the pre-rewind guard checkpoint could not be captured (${message}). Nothing was changed.`,
        }
      }
      logger.warn(`pre-rewind guard checkpoint failed (continuing without reversibility): ${message}`)
    }
    const guardLine = guard?.record !== undefined
      ? `\nrewind guard: ${guard.record.id} (run "/rewind ${guard.record.id.slice(0, 8)}" to undo this rewind)`
      : ''

    // 阶段 1：工作区恢复（restore 安全覆盖 / reset-hard CC 对标）。
    const segments = {}
    const notes = []
    if (targets.workspace) {
      const provider = registry.get(record.provider)
      if (provider === undefined) {
        const err = providerUnavailable(record.provider, 'provider no longer registered')
        appendEvent(session, SESSION_EVENTS.REWIND, {
          checkpointId: record.id, sessionId: session.id, outcome: REWIND_OUTCOMES.FAILED,
          target: parsed.kind === 'target' ? parsed.target : REWIND_TARGETS.ALL, error: err.message,
        })
        logger.error(`rewind phase 1 failed: ${err.message}`)
        return { kind: 'error', text: `rewind: ${err.message} — nothing was changed` }
      }
      const useResetHard = impact.mode === WORKSPACE_RESTORE_MODES.RESET_HARD && typeof provider.resetHard === 'function'
      let restore
      try {
        restore = useResetHard
          ? await provider.resetHard({ cwd, key: workspaceKeyOf(cwd) }, record.ref, signal)
          : await provider.restore({ cwd, key: workspaceKeyOf(cwd) }, record.ref, signal)
      } catch (error) {
        const message = messageOf(error)
        appendEvent(session, SESSION_EVENTS.REWIND, {
          checkpointId: record.id, sessionId: session.id, outcome: REWIND_OUTCOMES.FAILED,
          target: parsed.kind === 'target' ? parsed.target : REWIND_TARGETS.ALL, error: message,
        })
        logger.error(`rewind phase 1 failed (checkpoint ${record.id}, provider ${record.provider}): ${message}`)
        return {
          kind: 'error',
          text: `rewind: failed to restore files from checkpoint ${record.id} (${message}). No session was replayed, no config was restored, and the checkpoint was kept; the workspace may be partially restored.${guardLine}`,
        }
      }
      segments.workspace = { restored: restore.restored, mode: useResetHard ? WORKSPACE_RESTORE_MODES.RESET_HARD : WORKSPACE_RESTORE_MODES.RESTORE }
      notes.push(...(restore.notes ?? []))
      logger.info(`rewind phase 1 ok: ${segments.workspace.mode} restored ${restore.restored} file(s) from checkpoint ${record.id} (${record.provider})`)
    }

    // 阶段 2：配置还原（settings 命名空间写回；失败不阻断会话回退，报告 partial）。
    if (targets.config) {
      try {
        const restored = await restoreConfig(record.config ?? {})
        segments.config = restored
        logger.info(`rewind phase 2 ok: config restored (${restored.durable ? 'persisted' : 'in-process only'}) from checkpoint ${record.id}`)
      } catch (error) {
        const message = messageOf(error)
        segments.config = { error: message }
        logger.error(`rewind phase 2 failed (checkpoint ${record.id}): ${message}`)
      }
    }

    // 阶段 3：会话回退（seed 重放新子会话；失败仅报告，原会话不受影响）。
    if (targets.session) {
      try {
        const child = replaySession(session, record)
        segments.session = { childSessionId: child.id, seedLength: child.header?.seedLength ?? 0 }
        injectReplayNotice(child, record, segments, guard)
        logger.info(`rewind phase 3 ok: replayed session ${child.id} from checkpoint ${record.id} (boundary ${record.sessionBoundary ?? 'none'})`)
      } catch (error) {
        const message = messageOf(error)
        segments.session = { error: message }
        logger.error(`rewind phase 3 failed (checkpoint ${record.id}): ${message}`)
      }
    }

    const workspaceFailed = segments.workspace === undefined && targets.workspace
    const configFailed = segments.config?.error !== undefined
    const sessionFailed = segments.session?.error !== undefined
    const outcome = workspaceFailed || configFailed || sessionFailed
      ? (workspaceFailed ? REWIND_OUTCOMES.FAILED : REWIND_OUTCOMES.PARTIAL)
      : REWIND_OUTCOMES.RESTORED
    appendEvent(session, SESSION_EVENTS.REWIND, {
      checkpointId: record.id, sessionId: session.id, outcome,
      target: parsed.kind === 'target' ? parsed.target : REWIND_TARGETS.ALL,
      workspace: segments.workspace !== undefined ? { restored: segments.workspace.restored, mode: segments.workspace.mode } : undefined,
      config: segments.config !== undefined ? { durable: segments.config.durable ?? false, error: segments.config.error } : undefined,
      session: segments.session !== undefined ? { childSessionId: segments.session.childSessionId, error: segments.session.error } : undefined,
      preCheckpointId: guard?.record?.id,
    })

    const resultLines = []
    if (segments.workspace !== undefined) {
      resultLines.push(`workspace: restored ${segments.workspace.restored} file(s) via ${segments.workspace.mode === WORKSPACE_RESTORE_MODES.RESET_HARD ? 'git reset --hard' : 'safe overwrite'} (provider ${record.provider})`)
    }
    if (segments.config !== undefined) {
      resultLines.push(segments.config.error !== undefined
        ? `config: restore failed (${segments.config.error})`
        : `config: ${segments.config.note}`)
    }
    if (segments.session !== undefined) {
      resultLines.push(segments.session.error !== undefined
        ? `session: replay failed (${segments.session.error}); your current session is intact`
        : `session: replayed as child session ${segments.session.childSessionId} (open it to continue from before the checkpoint turn; this session keeps its later history)`)
    }
    const errors = []
    if (configFailed) errors.push(`config restore failed: ${segments.config.error}`)
    if (sessionFailed) errors.push(`session replay failed: ${segments.session.error}`)
    if (errors.length > 0) {
      resultLines.push(`rewind: ${outcome === REWIND_OUTCOMES.FAILED ? 'failed' : 'completed with errors'} — ${errors.join('; ')}`)
    }
    resultLines.push(...notes)
    if (outcome === REWIND_OUTCOMES.FAILED || outcome === REWIND_OUTCOMES.PARTIAL) {
      return { kind: 'error', text: `rewind: ${resultLines.join('\n')}${guardLine}` }
    }
    return { kind: 'success', text: `rewind: ${resultLines.join('\n')}${guardLine}` }
  }

  /**
   * /checkpoint 命令处理器：手动检查点 / 列表 / 两两对比。
   * @param {import('@deepseek-ai/dsh-commands').CommandInvocation} invocation - 命令调用。
   * @returns {Promise<import('@deepseek-ai/dsh-commands').CommandResult>} 命令结果。
   */
  async function handleCheckpoint(invocation) {
    const session = invocation.agent?.session
    if (session === null || session === undefined) {
      return { kind: 'error', text: 'checkpoint: no active session' }
    }
    const parsed = parseCheckpointInput(invocation.rawInput)
    if (parsed.kind === 'invalid') {
      return { kind: 'error', text: `checkpoint: ${parsed.message}` }
    }
    if (parsed.kind === 'list' || parsed.kind === 'diff') {
      const cwd = session.header?.cwd
      if (typeof cwd !== 'string' || cwd.length === 0) {
        return { kind: 'error', text: 'checkpoint: session has no workspace cwd' }
      }
      try {
        await ops
        const mine = await mineFor(session, cwd)
        if (parsed.kind === 'list') {
          const newest = sortOldestFirst(mine).slice(-liveConfig.listLimit)
          return { kind: 'success', text: formatCheckpointList(newest, { now: Date.now(), total: mine.length, command: 'checkpoint' }) }
        }
        return handleDiff(mine, session, parsed.a, parsed.b, 'checkpoint')
      } catch (error) {
        const err = registryUnavailable(messageOf(error))
        logger.error(err.message)
        return { kind: 'error', text: `checkpoint: ${err.message}` }
      }
    }
    const result = await captureCheckpoint(session, {
      kind: CHECKPOINT_KINDS.MANUAL,
      triggerTool: MANUAL_TRIGGER,
      note: parsed.note,
    })
    if (result === undefined) {
      return { kind: 'error', text: 'checkpoint: session has no workspace or no turn/step history yet' }
    }
    if (result.deduped === true) {
      return { kind: 'success', text: 'checkpoint: workspace unchanged since the last checkpoint — nothing new was captured' }
    }
    if (result.failed !== undefined) {
      return { kind: 'error', text: `checkpoint: capture failed (${result.failed}) — no checkpoint was created` }
    }
    const record = result.record
    return {
      kind: 'success',
      text: [
        `checkpoint: captured #${record.id}`,
        `kind: manual · provider: ${record.provider} · turn ${record.turn} step ${record.step}`,
        `session cursor: seq ${record.seq} · workspace tree: ${record.tree ?? 'n/a (copy)'}`,
        `config snapshot: ${Object.keys(record.config).length} key(s)`,
        ...(record.note !== undefined ? [`note: ${record.note}`] : []),
        'restore with /rewind <id> (all three states) or /rewind workspace|session|config <id>',
      ].join('\n'),
    }
  }

  /**
   * /rewind clear：删除本会话本工作区的全部检查点（记录 + provider 存储），
   * 经同一确认门（自定义问题与标签），绝不触碰工作区文件。
   * @param {object[]} mine - 本会话记录。
   * @param {import('@deepseek-ai/dsh-session').Session} session - 会话。
   * @param {object} agent - 命令所属 agent（确认门路由与审计归属）。
   * @param {AbortSignal} signal - 取消信号。
   * @returns {Promise<import('@deepseek-ai/dsh-commands').CommandResult>} 命令结果。
   */
  async function handleClear(mine, session, agent, signal) {
    if (mine.length === 0) {
      return { kind: 'success', text: 'rewind: no checkpoints to clear' }
    }
    const verdict = await confirmRewind({
      ctx,
      confirmVia: liveConfig.confirmVia,
      summary: `${mine.length} checkpoint(s) for this session and workspace will be deleted (snapshot storage discarded; workspace files are NOT touched).`,
      question: 'Delete all checkpoints for this session?',
      approveLabel: 'Delete',
      approveDescription: 'Remove every checkpoint record and discard their snapshot storage.',
    }, agent, signal)
    if (!verdict.allowed) {
      appendEvent(session, SESSION_EVENTS.REWIND, {
        checkpointId: 'clear', sessionId: session.id, outcome: REWIND_OUTCOMES.DENIED, error: verdict.reason,
      })
      logger.info(`rewind clear denied (${verdict.channel}: ${verdict.reason})`)
      return { kind: 'error', text: `rewind: clear cancelled: ${verdict.reason}` }
    }
    const entries = mine.map(record => ({ key: record.id, value: record }))
    await removeRecords(entries, mine.map(record => record.id))
    appendEvent(session, SESSION_EVENTS.PRUNE, { ids: mine.map(record => record.id), reason: PRUNE_REASONS.CLEAR })
    logger.info(`rewind clear: removed ${mine.length} checkpoint(s)`)
    return { kind: 'success', text: `rewind: cleared ${mine.length} checkpoint(s) (snapshot storage discarded)` }
  }
}

export {
  // 复用/测试面：provider seam、纯函数与词汇。
  SnapshotProviderRegistry,
  makeGitProvider,
  makeCopyProvider,
  prunePlan,
  nearestCheckpointAtOrBefore,
  parseRewindInput,
  parseCheckpointInput,
  resolveRecordByPrefix,
  stepEndSeqOf,
  formatCheckpointList,
  formatCheckpointDiff,
  formatPreviewResult,
  formatRewindSummary,
  confirmRewind,
  makeEventGate,
  maybeAppendSessionEvent,
  resolveSnapshotDir,
  workspaceKeyOf,
  sessionBoundaryAt,
  replaySeedOf,
  sessionDelta,
  stableStringify,
  configLinesOf,
  unifiedDiffLines,
  diffLines,
  configDiff,
  checkpointsDomainSpec,
  checkpointsProjectionDefinition,
  checkpointSettingsSchema,
  validateCheckpointSettings,
  CheckpointPanelService,
}
