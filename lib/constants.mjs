// lib/constants.mjs — 词汇表与协议常量（零依赖）。

// 插件标识与命令名。
export const PLUGIN_NAME = 'checkpoint-rewind'
export const COMMAND_NAME = 'rewind'
export const DOMAIN_NAME = 'checkpoints'

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

// 确认问题的稳定 id 与选项标签（标签同时是 UI 可见文本）。
export const CONFIRM_QUESTION_ID = 'rewind-confirm'
export const CONFIRM_APPROVE_LABEL = 'Restore'
export const CONFIRM_CANCEL_LABEL = 'Cancel'

// 回退动作结果（checkpoint/rewind 事件与命令文本共用）。
export const REWIND_OUTCOMES = Object.freeze({
  DENIED: 'denied',
  FAILED: 'failed',
  RESTORED_NO_FORK: 'restored-no-fork',
  RESTORED_FORKED: 'restored+forked',
})

// 清理触发原因（checkpoint/prune 事件）。
export const PRUNE_REASONS = Object.freeze({
  MAX_SNAPSHOTS: 'maxSnapshots',
  MAX_SNAPSHOT_BYTES: 'maxSnapshotBytes',
  TURN_END: 'turnEnd',
})

// 领域错误码（稳定、可路由）。
export const ERROR_CODES = Object.freeze({
  BAD_CONFIG: 'BAD_CONFIG',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_FAILED: 'PROVIDER_FAILED',
  REGISTRY_UNAVAILABLE: 'REGISTRY_UNAVAILABLE',
  CHECKPOINT_NOT_FOUND: 'CHECKPOINT_NOT_FOUND',
  REWIND_DENIED: 'REWIND_DENIED',
  FORK_FAILED: 'FORK_FAILED',
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
  MUTATION_TOOLS: Object.freeze(['bash', 'write', 'edit', 'str_replace_editor']),
  EXCLUDE_GLOBS: Object.freeze(['node_modules', '.git', '.dsh', 'dist', 'build']),
  CONFIRM_VIA: CONFIRM_CHANNELS.AUTO,
  LIST_LIMIT: 10,
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
})
