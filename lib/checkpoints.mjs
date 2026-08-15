// lib/checkpoints.mjs — 检查点纯函数：边界映射、清理计划、寻址解析、列表渲染（零依赖）。

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
 * @property {number} bytes - 快照增量存储字节数（配额记账：git 为变更 blob 字节，copy 为实拷贝字节）。
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
 * 字节配额是软配额：每会话最新一条总是保留（keepNewestPerSession 默认开启，
 * 该下限可突破配额）。纯函数：只算要删的 id 列表，不执行删除。
 * @param {Array<{key: string, value: CheckpointRecord}>} entries - 全表条目。
 * @param {{maxSnapshots: number, maxSnapshotBytes: number, keepNewestPerSession?: boolean}} opts - 配额。
 * @returns {{ids: string[], byRule: {maxSnapshots: string[], maxSnapshotBytes: string[]}}} 待删 id（最旧优先）与触发规则拆分。
 */
export function prunePlan(entries, opts) {
  const keepNewestPerSession = opts.keepNewestPerSession !== false
  const bySession = new Map()
  for (const entry of entries) {
    const list = bySession.get(entry.value.sessionId) ?? []
    list.push(entry.value)
    bySession.set(entry.value.sessionId, list)
  }
  const keep = new Set()
  const newestBySession = new Map()
  for (const list of bySession.values()) {
    const sorted = sortOldestFirst(list)
    for (const record of sorted.slice(-opts.maxSnapshots)) keep.add(record.id)
    newestBySession.set(sorted.at(-1).sessionId, sorted.at(-1).id)
  }
  const maxSnapshotIds = entries
    .filter(entry => !keep.has(entry.value.id))
    .sort((a, b) => a.value.time - b.value.time || a.value.seq - b.value.seq)
    .map(entry => entry.value.id)
  const survivors = entries
    .filter(entry => keep.has(entry.value.id))
    .sort((a, b) => a.value.time - b.value.time || a.value.seq - b.value.seq)
  const maxBytesIds = []
  let bytes = survivors.reduce((sum, entry) => sum + entry.value.bytes, 0)
  for (const entry of survivors) {
    if (bytes <= opts.maxSnapshotBytes) break
    if (keepNewestPerSession && newestBySession.get(entry.value.sessionId) === entry.value.id) continue
    maxBytesIds.push(entry.value.id)
    bytes -= entry.value.bytes
  }
  return {
    ids: [...maxSnapshotIds, ...maxBytesIds],
    byRule: { maxSnapshots: maxSnapshotIds, maxSnapshotBytes: maxBytesIds },
  }
}

/**
 * /rewind 输入解析（命令寻址语法）。
 * @param {string} rawInput - 命令原始输入（未 trim）。
 * @returns {{kind: 'list'} | {kind: 'latest'} | {kind: 'step', step: number} | {kind: 'clear'} | {kind: 'preview', target: string} | {kind: 'id', input: string} | {kind: 'invalid', message: string}} 解析结果。
 */
export function parseRewindInput(rawInput) {
  const input = rawInput.trim()
  if (input === '') return { kind: 'list' }
  const lower = input.toLowerCase()
  if (lower === 'latest' || lower === 'last') return { kind: 'latest' }
  if (lower === 'clear') return { kind: 'clear' }
  const step = /^step\s+(\d+)$/iu.exec(input)
  if (step !== null) {
    if (Number(step[1]) < 1) {
      return { kind: 'invalid', message: 'usage: /rewind step <positive-integer>' }
    }
    return { kind: 'step', step: Number(step[1]) }
  }
  if (/^step\b/iu.test(input)) {
    return { kind: 'invalid', message: 'usage: /rewind step <positive-integer>' }
  }
  if (/^preview\b/iu.test(input)) {
    const target = input.replace(/^preview\b/iu, '').trim()
    if (target === '') {
      return { kind: 'invalid', message: 'usage: /rewind preview <id-prefix | step <N> | latest>' }
    }
    return { kind: 'preview', target }
  }
  return { kind: 'id', input }
}

/**
 * 会话日志中编号为 step 的最近一条 step/end 事件的 seq。步号按轮次重复，
 * 取全日志最近的该步号（"/rewind step <N>" 的 ≤N 边界映射用）。
 * @param {Array<{type: string, data: object, seq: number}>} events - 会话事件。
 * @param {number} step - 目标步号。
 * @returns {number|undefined} step/end seq；该步号从未闭合时 undefined。
 */
export function stepEndSeqOf(events, step) {
  let seq
  for (const event of events) {
    if (event.type === 'step/end' && event.data?.step === step) seq = event.seq
  }
  return seq
}

/**
 * 检查点寻址：唯一前缀匹配 id（大小写不敏感）。
 * @param {CheckpointRecord[]} records - 同一会话的记录。
 * @param {string} input - 用户输入的 id 或前缀。
 * @returns {{record?: CheckpointRecord, notFound?: boolean, ambiguous?: string[]}} 命中或分类失败。
 */
export function resolveRecordByPrefix(records, input) {
  const lower = input.toLowerCase()
  const matches = records.filter(record => record.id.toLowerCase().startsWith(lower))
  if (matches.length === 1) return { record: matches[0] }
  if (matches.length === 0) return { notFound: true }
  return { ambiguous: matches.map(record => record.id).sort() }
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
 * 相对时间后缀（列表渲染：仅 1 小时内的条目带后缀）。
 * @param {number} deltaMs - 距今毫秒数。
 * @returns {string} 如 " (just now)" / " (3 min ago)"；超过 1 小时或非法值为空串。
 */
export function formatRelativeAge(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return ''
  const minutes = Math.floor(deltaMs / 60000)
  if (minutes < 1) return ' (just now)'
  if (minutes < 60) return ` (${minutes} min ago)`
  return ''
}

/**
 * 检查点列表渲染（/rewind 无参命令文本）。
 * 每一行包含：短 id（前 8 位，可直接当寻址前缀）、provider、turn/step、
 * 时间（可选相对后缀）、触发工具、文件数、大小、fork 可用性。
 * @param {CheckpointRecord[]} records - 已按 listLimit 截取的记录（任意顺序）。
 * @param {object} [opts] - {timeFormatter, now, total}（测试注入；now 用于相对时间，total 用于 "更多" 提示）。
 * @returns {string} 多行文本。
 */
export function formatCheckpointList(records, opts = {}) {
  if (records.length === 0) return 'rewind: no checkpoints yet'
  const timeFormatter = opts.timeFormatter ?? ((ms) => new Date(ms).toLocaleString())
  const lines = sortOldestFirst(records).map((record) => {
    const fork = typeof record.forkSeq === 'number'
      ? 'fork: ready'
      : 'fork: pending (turn not closed)'
    const time = timeFormatter(record.time)
    const relative = opts.now === undefined ? '' : formatRelativeAge(opts.now - record.time)
    return [
      `#${record.id.slice(0, 8)}`,
      `(${record.provider})`,
      `turn ${record.turn} step ${record.step}`,
      `${time}${relative}`,
      `trigger: ${record.triggerTool}`,
      `${record.files} file${record.files === 1 ? '' : 's'}`,
      formatBytes(record.bytes),
      fork,
    ].join(' · ')
  })
  const more = opts.total !== undefined && opts.total > records.length
    ? `… and ${opts.total - records.length} older checkpoint(s) (run /rewind clear to remove them)`
    : ''
  return [
    `rewind: ${lines.length} checkpoint${lines.length === 1 ? '' : 's'} (newest last):`,
    ...lines,
    'run "/rewind <id>" to restore files and fork the session from that checkpoint',
    more,
  ].filter(line => line.length > 0).join('\n')
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

/**
 * 只读恢复预览渲染（/rewind preview 命令结果文本）。
 * 列出将覆盖的文件（最多 limit 条 + 截断提示）与将保留的遗留文件。
 * @param {CheckpointRecord} record - 目标检查点。
 * @param {{restore: number, unchanged: number, leftovers: string[], changes?: string[]}} preview - provider 预览结果。
 * @param {object} [opts] - {limit}（默认 20，测试注入）。
 * @returns {string} 多行文本。
 */
export function formatPreviewResult(record, preview, opts = {}) {
  const limit = opts.limit ?? 20
  const changes = (preview.changes ?? []).slice(0, limit)
  const moreChanges = (preview.changes?.length ?? 0) - changes.length
  const leftovers = (preview.leftovers ?? []).slice(0, limit)
  const moreLeftovers = (preview.leftovers?.length ?? 0) - leftovers.length
  return [
    `rewind preview: checkpoint #${record.id} (provider ${record.provider}, turn ${record.turn} step ${record.step})`,
    `restoring it would overwrite ${preview.restore} file(s)${changes.length > 0 ? ':' : '.'}`,
    ...changes.map(file => `  ${file}`),
    moreChanges > 0 ? `  … and ${moreChanges} more` : '',
    `${preview.unchanged} file(s) already match the checkpoint (not touched).`,
    `no files are deleted: ${preview.leftovers?.length ?? 0} file(s) created after the checkpoint would be left in place${leftovers.length > 0 ? ':' : '.'}`,
    ...leftovers.map(file => `  ${file}`),
    moreLeftovers > 0 ? `  … and ${moreLeftovers} more` : '',
    'run "/rewind <id>" to confirm and apply (a guard checkpoint is captured first)',
  ].filter(line => line.length > 0).join('\n')
}
