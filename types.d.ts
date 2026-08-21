// types.d.ts — dsh-checkpoint-rewind 类型契约（会话事件声明合并 + 配置类型）。

/**
 * 检查点记录（与 lib/domain.mjs 的持久 schema 同构；存储领域记录为权威）。
 * 一体化三态模型：{id, 时间, 会话事件游标(seq), 工作区 git tree SHA(tree),
 * 配置快照(config), 备注(note), 来源(kind)}。
 */
export interface CheckpointRecord {
  id: string
  sessionId: string
  cwd: string
  /** 会话事件游标：捕获时会话日志 seq。 */
  seq: number
  time: number
  provider: 'git' | 'copy'
  /** 来源：manual（/checkpoint 与工具）· auto（间隔）· guard（回退保护）· mutation（变更安全网）。 */
  kind: 'manual' | 'auto' | 'guard' | 'mutation'
  triggerTool: string
  turn: number
  step: number
  files: number
  bytes: number
  /** provider 恢复句柄（git 提交对象 sha / copy 目录名）。 */
  ref: string
  /** 工作区 git tree SHA（copy provider 为 null）。 */
  tree?: string | null
  /** 配置快照（捕获时插件有效配置）。 */
  config?: Record<string, unknown>
  /** 备注（手动检查点；≤500 字符）。 */
  note?: string
  /** 捕获所在 step 的 step/end 事件 seq（补记；"/rewind step N" 映射）。 */
  stepEndSeq?: number
  /** 会话重放边界：游标之前最近一条 turn/end 的 seq（首轮检查点缺失）。 */
  sessionBoundary?: number
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /**
     * 一条三态检查点被捕获（log-only）。
     * 注意：当前宿主构建（KNOWN_SESSION_EVENT_TYPES）尚未收录 checkpoint/*，
     * 运行时经自适应门跳过 append；宿主收录后自动开启（见 README「会话事件」）。
     */
    'checkpoint/snapshot': CheckpointRecord
    /**
     * 检查点边界补记（log-only）：step/end 到达补 stepEndSeq。
     */
    'checkpoint/bound': {
      id: string
      turn: number
      step?: number
      stepEndSeq?: number
    }
    /** 配额清理（log-only）：被删检查点 id 与触发原因。 */
    'checkpoint/prune': {
      ids: string[]
      reason: 'maxSnapshots' | 'maxSnapshotBytes' | 'turnEnd' | 'clear'
    }
    /**
     * /rewind 回退动作结果（log-only）：三态事务的关键字段。
     * outcome: denied（确认门拒绝）| failed（工作区恢复失败，其余未执行）
     * | partial（工作区已恢复，配置/会话至少一项失败）| restored（全成功）。
     * target: all | workspace | session | config。
     * preCheckpointId：本次回退前捕获的保护检查点（可用来撤销回退）。
     */
    'checkpoint/rewind': {
      checkpointId: string
      sessionId: string
      outcome: 'denied' | 'failed' | 'partial' | 'restored'
      target: 'all' | 'workspace' | 'session' | 'config'
      workspace?: { restored: number, mode: 'restore' | 'reset-hard' }
      config?: { durable: boolean, error?: string }
      session?: { childSessionId?: string, error?: string }
      preCheckpointId?: string
      error?: string
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionMap {
    /**
     * Web UI 检查点条的全量列表值（最新在尾）。
     * 折叠 checkpoint/snapshot|bound|prune|rewind 事件得到；rc.8 宿主
     * 未收录该词汇时恒为空列表（见 README「会话事件」）。
     */
    checkpoints: Array<{
      id: string
      turn: number
      step: number
      time: number
      provider: 'git' | 'copy'
      kind: 'manual' | 'auto' | 'guard' | 'mutation'
      triggerTool: string
      files: number
      bytes: number
      tree?: string | null
      note?: string
      seq: number
      stepEndSeq?: number
      sessionBoundary?: number
      rewindOutcome?: 'denied' | 'failed' | 'partial' | 'restored'
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
  /** 每会话保留的检查点数（最旧优先清理，默认 50；有界存储·数量界）。 */
  maxSnapshots?: number
  /** 跨会话全局增量字节软配额（默认 512 MiB；有界存储·大小界；每会话最新一条总是保留）。 */
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
  /** 自动间隔快照：step/start 时检查；intervalMinutes=0 每步；enabled=false 关闭。 */
  autoCheckpoint?: {
    enabled?: boolean
    intervalMinutes?: number
  }
  /**
   * 工作区回滚实现：restore（默认安全覆盖，绝不删除检查点后新建的文件）·
   * reset-hard（CC 对标：git reset --hard <快照提交>，默认关，需显式开启）。
   */
  workspaceRestore?: 'restore' | 'reset-hard'
  /** 注入一句角色陈述式短提示词段落（默认 true，对齐官方 Minimal persona 风格）。 */
  promptSection?: boolean
  /** 注册 checkpoint 模型工具（默认 true）。 */
  checkpointTool?: boolean
}
