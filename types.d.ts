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
      reason: 'maxSnapshots' | 'maxSnapshotBytes' | 'turnEnd'
    }
    /**
     * /rewind 回退动作结果（log-only）：两段式事务的关键字段。
     * outcome: denied（确认门拒绝）| failed（文件恢复失败，未 fork）
     * | restored-no-fork（文件已恢复但会话未派生）| restored+forked（全成功）。
     */
    'checkpoint/rewind': {
      checkpointId: string
      sessionId: string
      outcome: 'denied' | 'failed' | 'restored-no-fork' | 'restored+forked'
      provider?: 'git' | 'copy'
      restored?: number
      leftovers?: string[]
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
    }>
  }
}

export interface Config {
  enabled?: boolean
  provider?: 'auto' | 'git' | 'copy'
  gitBin?: string
  snapshotDir?: string
  maxSnapshots?: number
  maxSnapshotBytes?: number
  pruneOnTurnEnd?: boolean
  mutationTools?: string[]
  excludeGlobs?: string[]
  confirmVia?: 'auto' | 'userQuestions' | 'approval'
  listLimit?: number
}
