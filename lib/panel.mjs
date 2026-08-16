// lib/panel.mjs — 设置页面板宿主 wire 服务（允许 DSH 包依赖）。
//
// checkpointPanel Remote 命名空间：时间线（timeline）与两两对比（diff）。
// 全部只读：绝不触碰工作区、配置或快照存储。回滚动作刻意不在此面板执行
// —— 审批门（userQuestions/approval）需要 agent 会话上下文，而设置页没有；
// 面板只展示时间线与 diff，并把回滚指向会话内的 /rewind 命令（失败关闭，
// 见 README「设置页」）。
// 经 ./typert 清单（typert.host.mjs）与 client Remote 贡献暴露到 Web。

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LIMITS, PANEL_SERVICE } from './constants.mjs'
import { resolveRecordByPrefix, sortOldestFirst } from './checkpoints.mjs'
import { configDiff } from './diff.mjs'
import { sessionDelta } from './session.mjs'
import { workspaceKeyOf } from './workspace.mjs'
import { TIMELINE_MAX_ROWS } from './wire.mjs'

/** 时间线行（wire 形状；领域记录 → 面板只读视图，绝不透出 ref/配置全文）。 */
function timelineRowOf(record) {
  return {
    id: record.id,
    sessionId: record.sessionId,
    time: record.time,
    seq: record.seq,
    kind: record.kind ?? 'mutation',
    provider: record.provider,
    triggerTool: record.triggerTool,
    turn: record.turn,
    step: record.step,
    files: record.files,
    bytes: record.bytes,
    tree: record.tree ?? null,
    note: typeof record.note === 'string' ? record.note : null,
    sessionBoundary: typeof record.sessionBoundary === 'number' ? record.sessionBoundary : null,
  }
}

/**
 * 设置页面板 wire 服务（Typert Remote：checkpointPanel/timeline + diff）。
 * 类插件形态：ctx.plugin(CheckpointPanelService, deps) 构造（(ctx, deps) 约定）。
 */
export class CheckpointPanelService extends TypertRemoteService {
  /** @type {{tablePromise: Promise<object>, ops: Promise<void>, registry: object, getLive: () => object}} */
  #deps

  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - Cordis 上下文。
   * @param {{tablePromise: Promise<object>, ops: Promise<void>, registry: object, getLive: () => object}} deps - 插件内部依赖。
   */
  constructor(ctx, deps) {
    super(ctx, PANEL_SERVICE)
    this.#deps = deps
  }

  /**
   * 时间线：全部检查点（跨会话，最新在前，封顶 TIMELINE_MAX_ROWS）+ 有界存储
   * 配额现状。纯读取（先排空未决领域写链保证一致快照）。
   * @param {number} [limit] - 返回行数上限（1..200）。
   * @returns {Promise<object>} 时间线快照。
   */
  async timeline(limit) {
    await this.#deps.ops
    const table = await this.#deps.tablePromise
    const records = [...table.entries()].map(([, record]) => record)
    const sorted = records.sort((a, b) => b.time - a.time || b.seq - a.seq)
    const capped = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, TIMELINE_MAX_ROWS) : LIMITS.MAX_LIST_LIMIT
    const live = this.#deps.getLive()
    return {
      rows: sorted.slice(0, capped).map(timelineRowOf),
      total: records.length,
      bytes: records.reduce((sum, record) => sum + (Number.isFinite(record.bytes) ? record.bytes : 0), 0),
      maxSnapshots: live.maxSnapshots,
      maxSnapshotBytes: live.maxSnapshotBytes,
    }
  }

  /**
   * 两两对比：文件变更集（provider 只读 diff）、配置行级 diff、会话游标差。
   * 跨工作区/跨 provider/缺失记录 → error 字段（面板展示，绝不抛出业务异常）。
   * @param {string} from - 旧检查点 id 或前缀。
   * @param {string} to - 新检查点 id 或前缀。
   * @returns {Promise<object>} 对比结果（wire 形状）。
   */
  async diff(from, to) {
    const empty = (error) => ({
      from: from ?? '',
      to: to ?? '',
      error,
      files: { changed: 0, added: 0, removed: 0, names: [], truncated: false },
      configDiff: { changed: false, lines: 0, text: '' },
      session: {
        fromSeq: 0, toSeq: 0,
        fromTurn: null, fromStep: null, toTurn: null, toStep: null,
        dropped: 0,
      },
      fromNote: null,
      toNote: null,
    })
    try {
      await this.#deps.ops
      const table = await this.#deps.tablePromise
      const records = [...table.entries()].map(([, record]) => record)
      const fromHit = resolveRecordByPrefix(records, from)
      const toHit = resolveRecordByPrefix(records, to)
      if (fromHit.notFound === true || toHit.notFound === true) {
        return empty(`unknown checkpoint id (${fromHit.notFound === true ? JSON.stringify(from) : JSON.stringify(to)})`)
      }
      if (fromHit.ambiguous !== undefined || toHit.ambiguous !== undefined) {
        return empty('checkpoint id prefix is ambiguous; use a longer prefix')
      }
      const fromRecord = fromHit.record
      const toRecord = toHit.record
      if (workspaceKeyOf(fromRecord.cwd) !== workspaceKeyOf(toRecord.cwd)) {
        return empty('checkpoints belong to different workspaces')
      }
      if (fromRecord.provider !== toRecord.provider) {
        return empty(`checkpoints use different providers (${fromRecord.provider} vs ${toRecord.provider})`)
      }
      const provider = this.#deps.registry.get(fromRecord.provider)
      if (provider === undefined || typeof provider.diffFiles !== 'function') {
        return empty(`provider ${fromRecord.provider} does not support pairwise diff`)
      }
      const files = await provider.diffFiles(
        { cwd: fromRecord.cwd, key: workspaceKeyOf(fromRecord.cwd) },
        fromRecord.ref,
        toRecord.ref,
      )
      const names = files.names.slice(0, LIMITS.MAX_DIFF_FILES)
      return {
        from: fromRecord.id,
        to: toRecord.id,
        error: null,
        files: {
          changed: files.changed,
          added: files.added,
          removed: files.removed,
          names,
          truncated: files.names.length > names.length,
        },
        configDiff: configDiff(fromRecord.config, toRecord.config),
        session: sessionDelta(fromRecord, toRecord),
        fromNote: typeof fromRecord.note === 'string' ? fromRecord.note : null,
        toNote: typeof toRecord.note === 'string' ? toRecord.note : null,
      }
    } catch (error) {
      return empty(error instanceof Error ? error.message : String(error))
    }
  }
}

/** 时间线按时间倒序（面板本地兜底排序，防御 wire 意外乱序）。 */
export function sortTimelineNewestFirst(rows) {
  return [...rows].sort((a, b) => b.time - a.time || b.seq - a.seq)
}
