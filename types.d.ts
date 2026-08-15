// types.d.ts — dsh-checkpoint-rewind 类型契约（会话事件声明合并 + 配置类型）。

/**
 * 检查点记录（与 lib/domain.mjs 的持久 schema 同构；存储领域记录为权威）。
 */
export interface CheckpointRecord {
  id: string
  sessionId: string
  cwd: string
  seq: number
  time: number
  provider: 'git' | 'copy'
  triggerTool: string
  turn: number
  step: number
  files: number
  bytes: number
  ref: string
  stepEndSeq?: number
  forkSeq?: number
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /**
     * 一条工作区检查点被捕获（log-only）。
     * 注意：当前宿主构建（KNOWN_SESSION_EVENT_TYPES）尚未收录 checkpoint/*，
     * 运行时经自适应门跳过 append；宿主收录后自动开启（见 README「会话事件」）。
     */
    'checkpoint/snapshot': CheckpointRecord
    /**
     * 检查点边界补记（log-only）：step/end 到达补 stepEndSeq，
     * turn/end 到达补 forkSeq。
     */
    'checkpoint/bound': {
      id: string
      turn: number
      step?: number
      stepEndSeq?: number
      forkSeq?: number
    }
    /** 配额清理（log-only）：被删检查点 id 与触发原因。 */
    'checkpoint/prune': {
      ids: string[]
      reason: 'maxSnapshots' | 'maxSnapshotBytes' | 'turnEnd' | 'clear'
    }
    /**
     * /rewind 回退动作结果（log-only）：三段式事务的关键字段。
     * outcome: denied（确认门拒绝）| failed（文件恢复失败，未 fork）
     * | restored-no-fork（文件已恢复但会话未派生）| restored+forked（全成功）。
     * preCheckpointId：本次回退前捕获的保护检查点（可用来撤销回退）。
     */
    'checkpoint/rewind': {
      checkpointId: string
      sessionId: string
      outcome: 'denied' | 'failed' | 'restored-no-fork' | 'restored+forked'
      provider?: 'git' | 'copy'
      restored?: number
      leftovers?: string[]
      preCheckpointId?: string
      childSessionId?: string
      forkSeq?: number
      error?: string
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionMap {
    /**
     * Web UI 检查点条的全量列表值（最新在尾）。
     * 折叠 checkpoint/snapshot|bound|prune|rewind 事件得到；rc.6 宿主
     * 未收录该词汇时恒为空列表（见 README「会话事件」）。
     */
    checkpoints: Array<{
      id: string
      turn: number
      step: number
      time: number
      provider: 'git' | 'copy'
      triggerTool: string
      files: number
      bytes: number
      stepEndSeq?: number
      forkSeq?: number
      rewindOutcome?: 'denied' | 'failed' | 'restored-no-fork' | 'restored+forked'
      preCheckpointId?: string
    }>
  }
}

export interface Config {
  /** 总开关；false 时命令、监听器与 provider 全部卸载。 */
  enabled?: boolean
  /** 快照 provider：auto（git 可用则 git，否则 copy）· git · copy。 */
  provider?: 'auto' | 'git' | 'copy'
  /** git 可执行文件路径（仅 git provider 使用）。 */
  gitBin?: string
  /** copy provider 快照根目录（默认 $DSH_HOME/dsh-checkpoint-rewind）。 */
  snapshotDir?: string
  /** 每会话保留的检查点数（最旧优先清理，默认 50）。 */
  maxSnapshots?: number
  /** 跨会话全局增量字节软配额（默认 512 MiB；每会话最新一条总是保留）。 */
  maxSnapshotBytes?: number
  /** 轮次结束时执行配额清理（默认 true）。 */
  pruneOnTurnEnd?: boolean
  /** tools/pre-execute 上视为变更型的工具名（fs 工具由 fs/*-intent 覆盖）。 */
  mutationTools?: string[]
  /**
   * copy provider 排除的 glob 模式：`*` 段内任意字符、`?` 单字符、`**` 跨段；
   * 无 `/` 匹配任意深度段名，含 `/` 按相对路径匹配，命中目录排除整个子树。
   */
  excludeGlobs?: string[]
  /** 恢复确认通道：auto（userQuestions 优先）· userQuestions · approval。 */
  confirmVia?: 'auto' | 'userQuestions' | 'approval'
  /** 无参 /rewind 列出的检查点数（默认 10）。 */
  listLimit?: number
  /** 恢复前保护检查点：warn · require · off（默认 warn）。 */
  preRewindCheckpoint?: 'warn' | 'require' | 'off'
  /** copy provider 内容哈希校验（去重 + 恢复完整性，默认 false）。 */
  verifyByHash?: boolean
}
