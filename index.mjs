// index.mjs — dsh-checkpoint-rewind 插件入口（唯一 host 面文件）。
//
// 功能：Claude Code /rewind 等价能力 —— 工作区文件快照 + 会话边界回退。
// - 快照：每次变更型工具执行前（fs/write-intent、fs/edit-intent、tools/pre-execute
//   的变更工具子集，均为 prepend 直通监听）捕获工作区状态。provider seam：
//   git（stash create / commit-tree 未引用对象，不动工作树/索引/历史）优先，
//   copy（目录增量拷贝）兜底。
// - 边界：快照后补记关联 —— step/end 到达时补 stepEndSeq（"回到第 N 步"映射），
//   turn/end 到达时补 forkSeq（fork 边界）。
// - /rewind：无参列出最近检查点；<id> 经确认门（userQuestions/approval，
//   失败关闭）后两段式回退：先恢复文件，再 ctx.sessions.fork 派生新会话。
// - 记录存 ctx.storageDomain 域 'checkpoints'；checkpoint/* 会话事件经自适应门
//   append（宿主构建收录该类型才写，见 lib/gate.mjs）。
//
// 只消费公开服务：sessions / storageDomain / commands（inject 声明），
// userQuestions / approval 按需可选查找（失败关闭）。

import { randomUUID } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  COMMAND_NAME,
  CONFIRM_CHANNELS,
  DEFAULTS,
  LIMITS,
  PLUGIN_NAME,
  PRUNE_REASONS,
  PROVIDER_MODES,
  REWIND_OUTCOMES,
  SESSION_EVENTS,
} from './lib/constants.mjs'
import {
  badConfig,
  checkpointNotFound,
  forkFailed,
  messageOf,
  providerUnavailable,
  rewindDenied,
  registryUnavailable,
} from './lib/errors.mjs'
import { workspaceKeyOf, resolveSnapshotDir } from './lib/workspace.mjs'
import { checkpointsDomainSpec } from './lib/domain.mjs'
import {
  formatCheckpointList,
  formatRewindSummary,
  nearestCheckpointAtOrBefore,
  prunePlan,
  sortOldestFirst,
} from './lib/checkpoints.mjs'
import { confirmRewind, makeEventGate, maybeAppendSessionEvent } from './lib/gate.mjs'
import { checkpointsProjectionDefinition } from './lib/projection.mjs'
import { SnapshotProviderRegistry } from './lib/providers/registry.mjs'
import { makeGitProvider } from './lib/providers/git.mjs'
import { makeCopyProvider } from './lib/providers/copy.mjs'

export const name = PLUGIN_NAME

/** 必需服务：缺失即加载失败（响亮）。 */
export const inject = ['sessions', 'storageDomain', 'commands']

/**
 * 插件配置（Schemastery，全部可 cordis.yml 覆盖；无硬编码 tunable）。
 * @typedef {object} Config
 * @property {boolean} [enabled] 整体开关；false 时不注册任何东西。
 * @property {'auto'|'git'|'copy'} [provider] 快照 provider 解析模式。
 * @property {string} [gitBin] git 可执行路径（默认 'git'）。
 * @property {string} [snapshotDir] copy provider 快照根目录；空 = $DSH_HOME/dsh-checkpoint-rewind。
 * @property {number} [maxSnapshots] 每会话保留的检查点上限（默认 50）。
 * @property {number} [maxSnapshotBytes] 全部检查点内容字节总配额（默认 512 MiB）。
 * @property {boolean} [pruneOnTurnEnd] turn 结束时执行配额清理（默认 true）。
 * @property {string[]} [mutationTools] tools/pre-execute 上视为变更型的工具名。
 * @property {string[]} [excludeGlobs] copy provider 遍历排除的目录/文件名。
 * @property {'auto'|'userQuestions'|'approval'} [confirmVia] 回退确认通道（auto 优先 userQuestions）。
 * @property {number} [listLimit] /rewind 无参列出的最近检查点数（默认 10）。
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
  }
  if (resolved.enabled === false) return resolved
  if (!Object.values(PROVIDER_MODES).includes(resolved.provider)) {
    throw badConfig(`provider ${JSON.stringify(resolved.provider)} must be one of auto|git|copy`)
  }
  if (!Object.values(CONFIRM_CHANNELS).includes(resolved.confirmVia)) {
    throw badConfig(`confirmVia ${JSON.stringify(resolved.confirmVia)} must be one of auto|userQuestions|approval`)
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
  return resolved
}

/**
 * 插件挂载。enabled:false 时不注册任何东西；非法配置在加载期响亮抛错。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
 * @param {Partial<Config>} [config] - 插件配置。
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  if (resolved.enabled === false) return

  const logger = ctx.logger(PLUGIN_NAME)
  const warn = (message) => logger.warn(message)
  const eventGate = makeEventGate(KNOWN_SESSION_EVENT_TYPES)
  const appendEvent = (session, type, data) => maybeAppendSessionEvent(session, type, data, eventGate, warn)

  // --- provider seam：两个 provider 经 registry 注册（注册即 effect，卸载撤销）。
  const registry = new SnapshotProviderRegistry()
  const unregGit = registry.register(makeGitProvider({ gitBin: resolved.gitBin }))
  let snapshotDirCache
  const getSnapshotDir = () => {
    if (snapshotDirCache === undefined) snapshotDirCache = resolveSnapshotDir(resolved.snapshotDir)
    return snapshotDirCache
  }
  const unregCopy = registry.register(makeCopyProvider({ snapshotDir: getSnapshotDir, excludeGlobs: resolved.excludeGlobs }))
  ctx.effect(() => () => {
    unregGit()
    unregCopy()
  }, `${PLUGIN_NAME}.providers`)

  // --- 检查点注册表：ctx.storageDomain 域 'checkpoints'（异步打开，命令/快照路径 await）。
  const tablePromise = ctx.storageDomain.open(checkpointsDomainSpec).then((domain) => {
    ctx.effect(() => () => { void domain.close() }, `${PLUGIN_NAME}.domain.close`)
    return domain.table('checkpoints')
  })
  tablePromise.catch(() => {}) // 消费方各自处理拒绝；此处仅避免未处理拒绝告警。

  // 领域写操作链：快照落盘、边界补记、清理按序执行；命令执行前先 await 排空。
  let ops = Promise.resolve()
  const schedule = (fn) => {
    const run = ops.then(fn, fn)
    ops = run.then(() => undefined, () => undefined)
    return run
  }

  // --- 每会话运行时状态（turn/step 跟踪 + 每步去重窗 + 捕获互斥）。
  const stateBySession = new WeakMap()
  const ensureState = (session) => {
    let state = stateBySession.get(session)
    if (state === undefined) {
      state = { turn: undefined, step: undefined, snapshotKey: undefined, inFlight: undefined }
      stateBySession.set(session, state)
    }
    return state
  }

  // --- 会话事件：turn/step 跟踪 + 边界补记 + turn 结束清理。
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
        break
      }
      case 'step/end': {
        backfillStepEnd(session, event.data.turn, event.data.step, event.seq)
        break
      }
      case 'turn/end': {
        backfillTurnEnd(session, event.data.turn, event.seq)
        if (resolved.pruneOnTurnEnd) pruneAll(session, PRUNE_REASONS.TURN_END)
        break
      }
      default:
        break
    }
  })

  /**
   * 当前开放 turn/step。事件跟踪失效（插件晚于会话挂载）时回退折叠日志尾部。
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
    for (const event of session.events) {
      if (event.type === 'turn/start') {
        turn = event.data.turn
        step = undefined
        turnEnded = false
      } else if (event.type === 'turn/end') {
        turnEnded = true
      } else if (event.type === 'step/start') {
        turn = event.data.turn
        step = event.data.step
      }
    }
    if (turnEnded || turn === undefined || step === undefined) return undefined
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

  /**
   * 变更前快照：每 (session, turn, step) 最多一次；并发意图共享同一次捕获。
   * 失败只记日志，绝不阻断工具执行（快照是安全网，不是策略）。
   * @param {import('@deepseek-ai/dsh-session').Session|null|undefined} session - 会话。
   * @param {string} triggerTool - 触发工具名。
   * @returns {Promise<void>} 完成（含失败）。
   */
  async function snapshotForMutation(session, triggerTool) {
    if (session === null || session === undefined) return
    const cwd = session.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) {
      warn('checkpoint skipped: session has no cwd')
      return
    }
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
        const table = await tablePromise
        const provider = await registry.resolve(resolved.provider, { cwd, key: workspaceKeyOf(cwd) })
        const previous = latestRecordFor(table, session.id, cwd)
        const previousRef = previous !== undefined && previous.provider === provider.name ? previous.ref : undefined
        const result = await provider.snapshot(
          { cwd, key: workspaceKeyOf(cwd) },
          { triggerTool, previousRef },
        )
        if (result === null) {
          logger.debug(`checkpoint deduped: workspace unchanged at turn ${pos.turn} step ${pos.step}`)
          return
        }
        const record = {
          id: randomUUID(),
          sessionId: session.id,
          cwd,
          seq: session.seq,
          time: Date.now(),
          provider: provider.name,
          triggerTool,
          turn: pos.turn,
          step: pos.step,
          files: result.files,
          bytes: result.bytes,
          ref: result.ref,
        }
        await table.put(record.id, record)
        appendEvent(session, SESSION_EVENTS.SNAPSHOT, record)
        logger.info(`checkpoint ${record.id} captured (${record.provider}, turn ${record.turn} step ${record.step}, ${record.files} files, ${record.bytes} bytes, trigger ${record.triggerTool})`)
        await pruneAll(session, PRUNE_REASONS.MAX_SNAPSHOT_BYTES)
      } catch (error) {
        warn(`checkpoint capture failed (trigger ${triggerTool}): ${messageOf(error)}`)
      } finally {
        state.inFlight = undefined
        state.snapshotKey = windowKey
      }
    })()
    state.inFlight = run
    await run
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

  /** turn/end 补记：该 turn 内未关联的检查点获得 forkSeq（fork 边界）。 */
  function backfillTurnEnd(session, turn, endSeq) {
    schedule(async () => {
      const table = await tablePromise
      for (const [key, record] of table.entries()) {
        if (record.sessionId !== session.id || record.turn !== turn || record.forkSeq !== undefined) continue
        await table.put(key, { ...record, forkSeq: endSeq })
        appendEvent(session, SESSION_EVENTS.BOUND, { id: record.id, turn, forkSeq: endSeq })
      }
    }).catch(error => warn(`checkpoint turn/end backfill failed: ${messageOf(error)}`))
  }

  /** 配额清理：每会话保留最近 maxSnapshots，全局字节不超 maxSnapshotBytes，最旧优先。 */
  function pruneAll(triggerSession, reason) {
    return schedule(async () => {
      const table = await tablePromise
      const entries = [...table.entries()].map(([key, value]) => ({ key, value }))
      const plan = prunePlan(entries, { maxSnapshots: resolved.maxSnapshots, maxSnapshotBytes: resolved.maxSnapshotBytes })
      if (plan.ids.length === 0) return
      for (const id of plan.ids) {
        const record = entries.find(entry => entry.key === id)?.value
        try {
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
      appendEvent(triggerSession, SESSION_EVENTS.PRUNE, { ids: plan.ids, reason })
      logger.info(`pruned ${plan.ids.length} checkpoint(s) (${reason})`)
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
    if (resolved.mutationTools.includes(exec?.name)) {
      return snapshotPassThrough(exec?.agent?.session, exec.name, next)
    }
    return next()
  }, { prepend: true })

  // --- 会话投影单元 'checkpoints'（可选能力：注册表存在才注册，注册即 effect）。
  // rc.6 上恒为空列表（checkpoint/* 事件被自适应门跳过）；宿主收录词汇后自动填充。
  const projections = ctx.get('sessionProjections')
  if (projections !== undefined) {
    ctx.effect(
      () => projections.register(checkpointsProjectionDefinition),
      `${PLUGIN_NAME}.projection.checkpoints`,
    )
  }

  // --- /rewind 命令（Consumer）。
  ctx.commands.register({
    name: COMMAND_NAME,
    description: 'List workspace checkpoints, or restore one: files + a forked session from its turn boundary (Claude Code /rewind equivalent).',
    input: { hint: '[checkpoint-id]' },
    async handler(invocation) {
      return handleRewind(invocation)
    },
  })

  /**
   * /rewind 命令处理器。
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
    const mine = [...table.entries()]
      .filter(([, record]) => record.sessionId === session.id && workspaceKeyOf(record.cwd) === workspaceKeyOf(cwd))
      .map(([, record]) => record)

    const input = rawInput.trim()
    if (input === '') {
      const newest = sortOldestFirst(mine).slice(-resolved.listLimit)
      return { kind: 'success', text: formatCheckpointList(newest) }
    }

    const record = mine.find(entry => entry.id === input)
    if (record === undefined) {
      const err = checkpointNotFound(input)
      return { kind: 'error', text: `rewind: ${err.message}` }
    }

    // 确认门：覆盖用户文件必须先经 ask 语义，无回答者失败关闭。
    const summary = formatRewindSummary(record)
    const verdict = await confirmRewind({ ctx, confirmVia: resolved.confirmVia, summary }, agent, signal)
    if (!verdict.allowed) {
      appendEvent(session, SESSION_EVENTS.REWIND, {
        checkpointId: record.id, sessionId: session.id, outcome: REWIND_OUTCOMES.DENIED, error: verdict.reason,
      })
      logger.info(`rewind denied: checkpoint ${record.id} (${verdict.channel}: ${verdict.reason})`)
      const err = rewindDenied(verdict.reason)
      return { kind: 'error', text: `rewind: ${err.message}` }
    }
    logger.info(`rewind approved (${verdict.channel}): checkpoint ${record.id}, phase 1 = restore files`)

    // 两段式事务，顺序固定：先文件恢复，后会话 fork。
    const provider = registry.get(record.provider)
    if (provider === undefined) {
      const err = providerUnavailable(record.provider, 'provider no longer registered')
      appendEvent(session, SESSION_EVENTS.REWIND, {
        checkpointId: record.id, sessionId: session.id, outcome: REWIND_OUTCOMES.FAILED, error: err.message,
      })
      logger.error(`rewind phase 1 failed: ${err.message}`)
      return { kind: 'error', text: `rewind: ${err.message} — no files were changed` }
    }
    let restore
    try {
      restore = await provider.restore({ cwd, key: workspaceKeyOf(cwd) }, record.ref, signal)
    } catch (error) {
      const message = messageOf(error)
      appendEvent(session, SESSION_EVENTS.REWIND, {
        checkpointId: record.id, sessionId: session.id, outcome: REWIND_OUTCOMES.FAILED, error: message,
      })
      logger.error(`rewind phase 1 failed (checkpoint ${record.id}, provider ${record.provider}): ${message}`)
      return {
        kind: 'error',
        text: `rewind: failed to restore files from checkpoint ${record.id} (${message}). No session was forked and the checkpoint was kept; the workspace may be partially restored.`,
      }
    }
    logger.info(`rewind phase 1 ok: restored ${restore.restored} file(s) from checkpoint ${record.id} (${record.provider})`)

    // 阶段 2：fork 边界必须是已闭合 turn 的 turn/end seq。
    let child
    let forkError
    if (record.forkSeq === undefined) {
      forkError = 'checkpoint has no closed turn boundary yet (its turn has not ended)'
    } else {
      try {
        child = ctx.sessions.fork(session, record.forkSeq)
      } catch (error) {
        forkError = messageOf(error)
      }
    }
    if (forkError !== undefined) {
      const message = `files restored (${restore.restored} file(s), provider ${record.provider}) but the session was NOT forked: ${forkError}`
      appendEvent(session, SESSION_EVENTS.REWIND, {
        checkpointId: record.id, sessionId: session.id, outcome: REWIND_OUTCOMES.RESTORED_NO_FORK,
        provider: record.provider, restored: restore.restored, leftovers: restore.leftovers, error: forkError,
      })
      logger.warn(`rewind phase 2 failed (checkpoint ${record.id}): ${forkError} — files already restored`)
      const err = forkFailed(forkError)
      return {
        kind: 'error',
        text: `rewind: ${message}.\nYour current session is intact (its later history is unchanged); continue here or run /rewind again once the checkpoint's turn has closed.`,
      }
    }
    const notes = restore.notes ?? []
    appendEvent(session, SESSION_EVENTS.REWIND, {
      checkpointId: record.id, sessionId: session.id, outcome: REWIND_OUTCOMES.RESTORED_FORKED,
      provider: record.provider, restored: restore.restored, leftovers: restore.leftovers,
      childSessionId: child.id, forkSeq: record.forkSeq,
    })
    // 把回退事实注入子会话（模型可见 ⟺ 已记录：user/message 直接落在子会话日志里）。
    // 子会话以边界前缀为种子，其中后续轮次的工具结果已不再与磁盘一致——
    // 没有这条通知，模型会沿用过期上下文继续。
    injectRewindNotice(child, record, restore)
    logger.info(`rewind ok: checkpoint ${record.id} → restored ${restore.restored} file(s), forked session ${child.id} at seq ${record.forkSeq}`)
    return {
      kind: 'success',
      text: [
        `rewind: restored ${restore.restored} file(s) from checkpoint ${record.id} (provider ${record.provider})`,
        `and forked a new session at seq ${record.forkSeq} (end of turn ${record.turn}).`,
        `session: ${child.id}`,
        'Open the new session to continue from before that turn; this session keeps its later history.',
        ...notes,
      ].join('\n'),
    }
  }

  /**
   * 向 fork 子会话注入一条回退通知：说明文件已恢复、哪些轮次之后的结果失效。
   * 通知是持久的 user/message（plugin source），派生历史会投影它。
   * @param {import('@deepseek-ai/dsh-session').Session} child - fork 子会话。
   * @param {object} record - 检查点记录。
   * @param {{restored: number, leftovers: string[]}} restore - 恢复结果。
   */
  function injectRewindNotice(child, record, restore) {
    const text = [
      `Workspace files were restored to checkpoint ${record.id} by /rewind`,
      `(provider ${record.provider}, ${restore.restored} file(s), state before turn ${record.turn} step ${record.step}).`,
      restore.leftovers.length > 0
        ? `${restore.leftovers.length} file(s) created after the checkpoint were left in place.`
        : '',
      'Tool results after that point no longer reflect the files on disk; re-check the workspace before continuing.',
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
}

export {
  // 复用/测试面：provider seam、纯函数与词汇。
  SnapshotProviderRegistry,
  makeGitProvider,
  makeCopyProvider,
  prunePlan,
  nearestCheckpointAtOrBefore,
  formatCheckpointList,
  formatRewindSummary,
  confirmRewind,
  makeEventGate,
  maybeAppendSessionEvent,
  resolveSnapshotDir,
  workspaceKeyOf,
  checkpointsDomainSpec,
  checkpointsProjectionDefinition,
}
