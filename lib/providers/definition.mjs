// lib/providers/definition.mjs — 快照 provider 契约（零依赖）。

// 快照 provider 是"工作区状态捕获/恢复"的 seam：registry 持有 0..N 个
// provider，消费方按 Config.provider 解析（auto → git 优先、copy 兜底）。
// provider 只负责文件内容，不参与会话、审批、配额（那些是消费方职责）。
//
// 契约要点：
// - snapshot 返回 null = 内容与 previousRef 一致（去重），消费方不新增记录；
// - restore 是覆盖式回滚：捕获的文件被恢复，快照之后新建的文件保留并报告
//   （绝不删除用户文件——git 侧对应"禁用 git clean"的同一安全边界）；
// - discard 删除快照占用的存储（git 侧是 no-op：对象留给 git gc）；
// - 实现必须自串行化（同工作区并发调用经 lib/lock.mjs 排队）。

/**
 * 工作区描述。
 * @typedef {object} WorkspaceInfo
 * @property {string} cwd - 绝对工作区根。
 * @property {string} key - workspaceKeyOf(cwd) 规范化键（路径隔离与锁键）。
 */

/**
 * 快照捕获结果。
 * @typedef {object} SnapshotResult
 * @property {string} ref - provider 自有恢复句柄（git 提交对象 sha / copy 目录名）。
 * @property {string|null} [tree] - 工作区 git tree SHA（git provider；copy 无）。
 * @property {number} files - 涉及文件数。
 * @property {number} bytes - 捕获内容字节数（配额记账）。
 * @property {string[]} [notes] - 可选人读备注（降级、跳过项等）。
 */

/**
 * 恢复结果。
 * @typedef {object} RestoreResult
 * @property {number} restored - 已恢复（覆盖）的文件数。
 * @property {string[]} leftovers - 快照之后新建、未被删除的文件（报告，不删除）。
 * @property {string[]} [notes] - 可选人读备注。
 */

/**
 * 可用性探测结果。
 * @typedef {object} Availability
 * @property {boolean} ok - 是否可服务该工作区。
 * @property {string} [reason] - 不可用原因（ok=false 时给出）。
 */

/**
 * 只读恢复预览结果（/rewind preview；不写任何文件）。
 * @typedef {object} PreviewResult
 * @property {number} restore - 恢复将覆盖/重建的文件数。
 * @property {number} unchanged - 与检查点一致、不会被触碰的文件数。
 * @property {string[]} leftovers - 快照之后新建、将被保留的文件（报告，不删除）。
 * @property {string[]} [changes] - 将被覆盖的文件相对路径清单（供预览渲染）。
 * @property {Array<{path: string, bytes: number}>} [entries] - 将被覆盖文件的逐文件
 *   字节大小（逐文件勾选 + 大小统计用；path 与 changes 一致，按字母序）。
 */

/**
 * 两两文件对比结果（列表/对比渲染）。
 * @typedef {object} DiffFilesResult
 * @property {number} changed - 变更文件总数（新增 + 删除 + 修改）。
 * @property {number} added - 新增文件数（to 有、from 无）。
 * @property {number} removed - 删除文件数（from 有、to 无）。
 * @property {string[]} names - 变更路径清单（按字母序）。
 * @property {Array<{path: string, status: 'added'|'removed'|'changed'}>} [entries]
 *   - 逐文件变更条目（per-file 并排渲染用；按字母序）。
 */

/**
 * 快照 provider 接口。
 * @typedef {object} SnapshotProvider
 * @property {'git'|'copy'} name - 稳定 provider 名（record.provider 词汇）。
 * @property {(workspace: WorkspaceInfo, signal?: AbortSignal) => Promise<Availability>} available
 *   探测是否可服务该工作区（git：合法工作树且命令可用）。
 * @property {(workspace: WorkspaceInfo, ctx: {triggerTool: string, previousRef?: string, signal?: AbortSignal}) => Promise<SnapshotResult|null>} snapshot
 *   捕获当前工作区状态；与 previousRef 内容一致时返回 null（去重）。
 * @property {(workspace: WorkspaceInfo, ref: string, signal?: AbortSignal, files?: string[]) => Promise<RestoreResult>} restore
 *   把工作区恢复到 ref 捕获的状态（覆盖式）；可选 files 只恢复指定相对路径
 *   （选择性恢复，未知路径失败关闭）。
 * @property {(workspace: WorkspaceInfo, ref: string, signal?: AbortSignal) => Promise<RestoreResult>} [resetHard]
 *   显式 reset-hard 模式（git 专用）：git reset --hard <快照提交>。
 * @property {(workspace: WorkspaceInfo, fromRef: string, toRef: string) => Promise<DiffFilesResult>} [diffFiles]
 *   两个快照之间的文件变更集（纯读取）。
 * @property {(workspace: WorkspaceInfo) => Promise<string[]>} [untrackedFiles]
 *   未跟踪（非忽略）文件清单（git 专用：git 快照只覆盖已跟踪文件；copy 快照
 *   覆盖整个工作区、无此概念）。供消费方在去重等场景给出可操作提示（如
 *   "git add 纳入后续快照"）。
 * @property {(workspace: WorkspaceInfo, ref: string) => Promise<void>} discard
 *   删除 ref 占用的快照存储。
 * @property {(workspace: WorkspaceInfo, ref: string, signal?: AbortSignal) => Promise<PreviewResult>} [preview]
 *   只读恢复影响面预览（可选；缺失时消费方提示不可用，绝不降级为写操作）。
 */

export {}
