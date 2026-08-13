// lib/checkpoints.mjs — 检查点纯函数：边界映射、清理计划、列表渲染（零依赖）。

/**
 * 检查点记录（存储领域 'checkpoints' 表中 'checkpoints' 记录的形状；见 lib/domain.mjs）。
 * @typedef {object} CheckpointRecord
 * @property {string} id - 检查点 id（uuid）。
 * @property {string} sessionId - 来源会话 id。
 * @property {string} cwd - 捕获时的工作区绝对路径（恢复时的身份见证）。
 * @property {number} seq - 捕获时会话日志 seq（信息性水位）。
 * @property {number} time - 捕获时间（epoch ms）。
 * @property {'git'|'copy'} provider - 捕获 provider。
 * @property {string} triggerTool - 触发快照的变更工具名。
 * @property {number} turn - 捕获时所在 turn。
 * @property {number} step - 捕获时所在 step。
 * @property {number} files - 涉及文件数（git：相对父提交的变更文件；copy：捕获文件数）。
 * @property {number} bytes - 快照内容字节数（配额记账）。
 * @property {string} ref - provider 自有恢复句柄（git 对象 sha / copy 目录名）。
 * @property {number} [stepEndSeq] - 捕获所在 step 的 step/end 事件 seq（补记）。
 * @property {number} [forkSeq] - 捕获所在 turn 的 turn/end 事件 seq（fork 边界，补记）。
 */

/**
 * 按 (time, seq) 升序排序检查点（最旧优先，清理与展示共用）。
 * @param {CheckpointRecord[]} records - 任意顺序的记录。
 * @returns {CheckpointRecord[]} 升序副本（不修改入参）。
 */
export function sortOldestFirst(records) {
  return [...records].sort((a, b) => a.time - b.time || a.seq - b.seq)
}

/**
 * "回到第 N 步" → 检查点映射：取 stepEndSeq ≤ N 中 stepEndSeq 最大的记录。
 * 未补记 stepEndSeq 的记录不参与映射（其 step 没有结束事件）。
 * @param {CheckpointRecord[]} records - 同一会话的记录（任意顺序）。
 * @param {number} boundarySeq - 目标步的 step/end 事件 seq。
 * @returns {CheckpointRecord|undefined} 最近的 ≤N 检查点。
 */
export function nearestCheckpointAtOrBefore(records, boundarySeq) {
  let best
  for (const record of records) {
    const seq = record.stepEndSeq
    if (typeof seq !== 'number' || seq > boundarySeq) continue
    if (best === undefined || seq > best.stepEndSeq) best = record
  }
  return best
}

/**
 * 清理计划：每会话保留最近 maxSnapshots 条；再按全局字节配额从最旧删起。
 * 纯函数：只算要删的 id 列表，不执行删除。
 * @param {Array<{key: string, value: CheckpointRecord}>} entries - 全表条目。
 * @param {{maxSnapshots: number, maxSnapshotBytes: number}} opts - 配额。
 * @returns {{ids: string[]}} 按最旧优先排序的待删 id。
 */
export function prunePlan(entries, opts) {
  const bySession = new Map()
  for (const entry of entries) {
    const list = bySession.get(entry.value.sessionId) ?? []
    list.push(entry.value)
    bySession.set(entry.value.sessionId, list)
  }
  const keep = new Set()
  for (const list of bySession.values()) {
    const sorted = sortOldestFirst(list)
    const retained = sorted.slice(-opts.maxSnapshots)
    for (const record of retained) keep.add(record.id)
  }
  const dropped = entries
    .filter(entry => !keep.has(entry.value.id))
    .sort((a, b) => a.value.time - b.value.time || a.value.seq - b.value.seq)
  const survivors = entries
    .filter(entry => keep.has(entry.value.id))
    .sort((a, b) => a.value.time - b.value.time || a.value.seq - b.value.seq)
  const ids = dropped.map(entry => entry.value.id)
  let bytes = survivors.reduce((sum, entry) => sum + entry.value.bytes, 0)
  for (const entry of survivors) {
    if (bytes <= opts.maxSnapshotBytes) break
    ids.push(entry.value.id)
    bytes -= entry.value.bytes
  }
  return { ids }
}

/**
 * 人类可读字节数。
 * @param {number} bytes - 非负整数。
 * @returns {string} 如 "1.2 MiB"。
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} B`
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = unit === 0 ? String(value) : value.toFixed(1)
  return `${text} ${units[unit]}`
}

/**
 * 检查点列表渲染（/rewind 无参命令文本）。
 * 每一行包含：id、provider、turn/step、时间、触发工具、文件数、大小、fork 可用性。
 * @param {CheckpointRecord[]} records - 同一会话的记录（任意顺序）。
 * @param {object} [opts] - {timeFormatter}（测试注入；默认 ISO 本地时间）。
 * @returns {string} 多行文本。
 */
export function formatCheckpointList(records, opts = {}) {
  if (records.length === 0) return 'rewind: no checkpoints yet'
  const timeFormatter = opts.timeFormatter ?? ((ms) => new Date(ms).toLocaleString())
  const lines = sortOldestFirst(records).map((record) => {
    const fork = typeof record.forkSeq === 'number'
      ? 'fork: ready'
      : 'fork: pending (turn not closed)'
    return [
      `#${record.id}`,
      `(${record.provider})`,
      `turn ${record.turn} step ${record.step}`,
      timeFormatter(record.time),
      `trigger: ${record.triggerTool}`,
      `${record.files} file${record.files === 1 ? '' : 's'}`,
      formatBytes(record.bytes),
      fork,
    ].join(' · ')
  })
  return [
    `rewind: ${lines.length} checkpoint${lines.length === 1 ? '' : 's'} (newest last):`,
    ...lines,
    'run "/rewind <id>" to restore files and fork the session from that checkpoint',
  ].join('\n')
}

/**
 * 回退确认与结果摘要文本（confirm 问题 detail 与命令结果共用）。
 * @param {CheckpointRecord} record - 目标检查点。
 * @returns {string} 摘要文本。
 */
export function formatRewindSummary(record) {
  return [
    `checkpoint #${record.id}`,
    `provider: ${record.provider}`,
    `captured at turn ${record.turn} step ${record.step} (${record.triggerTool})`,
    `${record.files} file(s), ${formatBytes(record.bytes)}`,
    typeof record.forkSeq === 'number'
      ? `session fork boundary: seq ${record.forkSeq} (end of turn ${record.turn})`
      : 'session fork boundary: not yet available (turn has not ended)',
  ].join('\n')
}
