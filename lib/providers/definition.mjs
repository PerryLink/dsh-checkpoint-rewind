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
 * @property {string} ref - provider 自有恢复句柄（git 对象 sha / copy 目录名）。
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
 * 快照 provider 接口。
 * @typedef {object} SnapshotProvider
 * @property {'git'|'copy'} name - 稳定 provider 名（record.provider 词汇）。
 * @property {(workspace: WorkspaceInfo, signal?: AbortSignal) => Promise<Availability>} available
 *   探测是否可服务该工作区（git：合法工作树且命令可用）。
 * @property {(workspace: WorkspaceInfo, ctx: {triggerTool: string, previousRef?: string, signal?: AbortSignal}) => Promise<SnapshotResult|null>} snapshot
 *   捕获当前工作区状态；与 previousRef 内容一致时返回 null（去重）。
 * @property {(workspace: WorkspaceInfo, ref: string, signal?: AbortSignal) => Promise<RestoreResult>} restore
 *   把工作区恢复到 ref 捕获的状态（覆盖式）。
 * @property {(workspace: WorkspaceInfo, ref: string) => Promise<void>} discard
 *   删除 ref 占用的快照存储。
 */

export {}
