// lib/constants.mjs — 词汇表与协议常量（零依赖）。

// 插件标识与命令名。
export const PLUGIN_NAME = 'checkpoint-rewind'
export const COMMAND_NAME = 'rewind'
export const CHECKPOINT_COMMAND = 'checkpoint'
export const DOMAIN_NAME = 'checkpoints'

// 模型工具名（手动检查点工具）。
export const CHECKPOINT_TOOL = 'checkpoint'

// settings 命名空间（Schema 配置 + Web 设置页暴露）。
export const SETTINGS_NS = 'checkpoint-rewind'

// 设置页面板 wire 服务名（Typert Remote 命名空间）。
export const PANEL_SERVICE = 'checkpointPanel'

// 提示词段落名与顺序（系统提示中本插件注入的角色陈述）。
export const PROMPT_SECTION_NAME = 'checkpoint-rewind:role'
export const PROMPT_SECTION_ORDER = 10

// 快照 provider 名（record.provider 的取值词汇）。
export const PROVIDERS = Object.freeze({
  GIT: 'git',
  COPY: 'copy',
})

// Config.provider 的解析取值。
export const PROVIDER_MODES = Object.freeze({
  AUTO: 'auto',
  GIT: 'git',
  COPY: 'copy',
})

// Config.confirmVia 的取值。
export const CONFIRM_CHANNELS = Object.freeze({
  AUTO: 'auto',
  USER_QUESTIONS: 'userQuestions',
  APPROVAL: 'approval',
})

// Config.preRewindCheckpoint 的取值（回退前的保护检查点策略）。
export const PRE_REWIND_MODES = Object.freeze({
  WARN: 'warn',
  REQUIRE: 'require',
  OFF: 'off',
})

// Config.workspaceRestore 的取值（工作区回滚实现）。
// - restore：安全覆盖式恢复（默认；绝不删除检查点后新建的文件，显式路径分块）。
// - reset-hard：CC 对标模式 —— git reset --hard <快照提交>（分支头移动到快照提交，
//   索引与工作树一致化为快照树；快照之后提交的变更从工作树移除但保留在对象库/
//   reflog 中；未跟踪文件仍不受触碰）。默认关闭，需显式开启并过确认门。
export const WORKSPACE_RESTORE_MODES = Object.freeze({
  RESTORE: 'restore',
  RESET_HARD: 'reset-hard',
})

// 检查点来源分类（record.kind 的取值词汇；手动 /checkpoint、自动间隔、
// 回退前保护、变更工具安全网）。
export const CHECKPOINT_KINDS = Object.freeze({
  MANUAL: 'manual',
  AUTO: 'auto',
  GUARD: 'guard',
  MUTATION: 'mutation',
})

// /rewind 回滚目标（三态各自独立 + 一体）。
export const REWIND_TARGETS = Object.freeze({
  ALL: 'all',
  WORKSPACE: 'workspace',
  SESSION: 'session',
  CONFIG: 'config',
})

// 自动/手动检查点的 triggerTool 标签（区别于变更工具的触发）。
export const AUTO_TRIGGER = 'auto'
export const MANUAL_TRIGGER = 'checkpoint'

// /rewind 前保护检查点的 triggerTool 标签（区别于变更工具的触发）。
export const PRE_REWIND_TRIGGER = 'rewind'

// 确认问题的稳定 id 与选项标签（标签同时是 UI 可见文本）。
export const CONFIRM_QUESTION_ID = 'rewind-confirm'
export const CONFIRM_APPROVE_LABEL = 'Restore'
export const CONFIRM_CANCEL_LABEL = 'Cancel'

// 回退动作结果（checkpoint/rewind 事件与命令文本共用）。
export const REWIND_OUTCOMES = Object.freeze({
  DENIED: 'denied',
  FAILED: 'failed',
  PARTIAL: 'partial',
  RESTORED: 'restored',
})

// 清理触发原因（checkpoint/prune 事件）。
export const PRUNE_REASONS = Object.freeze({
  MAX_SNAPSHOTS: 'maxSnapshots',
  MAX_SNAPSHOT_BYTES: 'maxSnapshotBytes',
  TURN_END: 'turnEnd',
  CLEAR: 'clear',
})

// 领域错误码（稳定、可路由）。
export const ERROR_CODES = Object.freeze({
  BAD_CONFIG: 'BAD_CONFIG',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_FAILED: 'PROVIDER_FAILED',
  REGISTRY_UNAVAILABLE: 'REGISTRY_UNAVAILABLE',
  CHECKPOINT_NOT_FOUND: 'CHECKPOINT_NOT_FOUND',
  CHECKPOINT_AMBIGUOUS: 'CHECKPOINT_AMBIGUOUS',
  REWIND_DENIED: 'REWIND_DENIED',
  FORK_FAILED: 'FORK_FAILED',
  CONFIG_RESTORE_FAILED: 'CONFIG_RESTORE_FAILED',
  DIFF_UNAVAILABLE: 'DIFF_UNAVAILABLE',
})

// 会话事件类型（插件自有；运行时是否 append 取决于宿主是否收录该类型，
// 见 lib/gate.mjs 的自适应门）。
export const SESSION_EVENTS = Object.freeze({
  SNAPSHOT: 'checkpoint/snapshot',
  BOUND: 'checkpoint/bound',
  PRUNE: 'checkpoint/prune',
  REWIND: 'checkpoint/rewind',
})

// 默认值（Config schema 的默认与 DEFAULT_* 常量同源；cordis.yml 可整体覆盖）。
export const DEFAULTS = Object.freeze({
  ENABLED: true,
  PROVIDER: PROVIDER_MODES.AUTO,
  GIT_BIN: 'git',
  SNAPSHOT_DIR: '',
  MAX_SNAPSHOTS: 50,
  MAX_SNAPSHOT_BYTES: 512 * 1024 * 1024,
  PRUNE_ON_TURN_END: true,
  // fs 系工具由 fs/*-intent 覆盖；shell 系工具（bash/pwsh/terminal_send）靠本清单。
  MUTATION_TOOLS: Object.freeze(['bash', 'write', 'edit', 'str_replace_editor', 'pwsh', 'terminal_send']),
  EXCLUDE_GLOBS: Object.freeze(['node_modules', '.git', '.dsh', 'dist', 'build']),
  CONFIRM_VIA: CONFIRM_CHANNELS.AUTO,
  LIST_LIMIT: 10,
  PRE_REWIND_CHECKPOINT: PRE_REWIND_MODES.WARN,
  VERIFY_BY_HASH: false,
  // 自动间隔快照（step/start 时检查；intervalMinutes=0 表示每步；enabled=false 关闭）。
  AUTO_CHECKPOINT_ENABLED: true,
  AUTO_CHECKPOINT_INTERVAL_MINUTES: 0,
  // 工作区回滚实现（restore 为安全默认；reset-hard 为 CC 对标模式）。
  WORKSPACE_RESTORE: WORKSPACE_RESTORE_MODES.RESTORE,
  // 注入一句角色陈述式的短提示词段落（对齐官方 Minimal persona 风格）。
  PROMPT_SECTION: true,
  // 注册 checkpoint 模型工具。
  CHECKPOINT_TOOL: true,
})

// copy provider 目录内文件名。
export const COPY_MANIFEST = 'manifest.json'

// 快照目录名后缀：未完成的捕获先写 *.tmp，完成后改名（原子完成标记）。
export const COPY_TMP_SUFFIX = '.tmp'

// 配额与上限的合法性边界（加载期校验）。
export const LIMITS = Object.freeze({
  MIN_MAX_SNAPSHOTS: 1,
  MIN_MAX_SNAPSHOT_BYTES: 1024,
  MIN_LIST_LIMIT: 1,
  MAX_LIST_LIMIT: 100,
  MIN_AUTO_INTERVAL_MINUTES: 0,
  MAX_AUTO_INTERVAL_MINUTES: 10080,
  MAX_NOTE_LENGTH: 500,
  MAX_DIFF_FILES: 50,
})
