// lib/checkpoints.mjs — 检查点纯函数：边界映射、清理计划、寻址解析、列表/对比渲染（零依赖）。

/**
 * 检查点记录（存储领域 'checkpoints' 表中 'checkpoints' 记录的形状；见 lib/domain.mjs）。
 * 一体化三态模型：{id, 时间, 会话事件游标(seq), 工作区 git tree SHA(tree),
 * 配置快照(config), 备注(note), 来源(kind)}。
 * @typedef {object} CheckpointRecord
 * @property {string} id - 检查点 id（uuid）。
 * @property {string} sessionId - 来源会话 id。
 * @property {string} cwd - 捕获时的工作区绝对路径（恢复时的身份见证）。
 * @property {number} seq - 会话事件游标：捕获时会话日志 seq。
 * @property {number} time - 捕获时间（epoch ms）。
 * @property {'git'|'copy'} provider - 捕获 provider。
 * @property {'manual'|'auto'|'guard'|'mutation'} kind - 来源：手动/自动间隔/回退保护/变更安全网。
 * @property {string} triggerTool - 触发快照的工具名或触发标签。
 * @property {number} turn - 捕获时所在 turn。
 * @property {number} step - 捕获时所在 step。
 * @property {number} files - 涉及文件数（git：相对父提交的变更文件；copy：捕获文件数）。
 * @property {number} bytes - 快照增量存储字节数（配额记账）。
 * @property {string} ref - provider 自有恢复句柄（git 提交对象 sha / copy 目录名）。
 * @property {string|null} [tree] - 工作区 git tree SHA（copy provider 为 null）。
 * @property {object} [config] - 配置快照（捕获时插件有效配置）。
 * @property {string} [note] - 备注（手动检查点）。
 * @property {number} [stepEndSeq] - 捕获所在 step 的 step/end 事件 seq（补记）。
 * @property {number} [sessionBoundary] - 会话重放边界：游标之前最近一条 turn/end 的 seq。
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
 * 拆分并解析末尾的「--files <csv>」选择性恢复过滤器。
 * @param {string} rawInput - 命令原始输入（未 trim）。
 * @returns {{rest: string, files?: string[], error?: string}} 剩余输入 + 去重后的文件清单。
 */
function splitFileFilter(rawInput) {
  const input = rawInput.trim()
  if (/\s+--files$/iu.test(input)) {
    return { rest: input, error: 'usage: /rewind … --files <comma-separated relative paths>' }
  }
  const match = /\s+--files(?:\s+|=)(.+)$/iu.exec(input)
  if (match === null) return { rest: input }
  const rest = input.slice(0, match.index).trim()
  const files = match[1].split(',').map(segment => segment.trim()).filter(segment => segment.length > 0)
  if (files.length === 0) {
    return { rest, error: 'usage: /rewind … --files <comma-separated relative paths>' }
  }
  const seen = new Set()
  const unique = files.filter(file => !seen.has(file) && seen.add(file))
  return { rest, files: unique }
}

/**
 * /rewind 输入解析（命令寻址语法）。
 * 目标形态：id（=三态一体）/ workspace|session|config|all <目标> / diff <a> <b>。
 * 可选末尾「--files <csv>」挂到目标形态上（选择性恢复过滤器）。
 * @param {string} rawInput - 命令原始输入（未 trim）。
 * @returns {{kind: 'list'} | {kind: 'latest'} | {kind: 'step', step: number} | {kind: 'clear'}
 *   | {kind: 'preview', target: string} | {kind: 'diff', a: string, b: string}
 *   | {kind: 'id', input: string} | {kind: 'target', target: 'workspace'|'session'|'config'|'all', input: string}
 *   | {kind: 'invalid', message: string}} 解析结果（目标形态可带 files?: string[]）。
 */
export function parseRewindInput(rawInput) {
  const { rest, files, error } = splitFileFilter(rawInput)
  if (error !== undefined) return { kind: 'invalid', message: error }
  const input = rest
  let result
  if (input === '') result = { kind: 'list' }
  else {
    const lower = input.toLowerCase()
    if (lower === 'list') result = { kind: 'list' }
    else if (lower === 'latest' || lower === 'last') result = { kind: 'latest' }
    else if (lower === 'clear') result = { kind: 'clear' }
    else if (/^step\s+(\d+)$/iu.test(input)) {
      const step = Number(/^step\s+(\d+)$/iu.exec(input)[1])
      result = step < 1
        ? { kind: 'invalid', message: 'usage: /rewind step <positive-integer>' }
        : { kind: 'step', step }
    } else if (/^step\b/iu.test(input)) {
      result = { kind: 'invalid', message: 'usage: /rewind step <positive-integer>' }
    } else if (/^preview\b/iu.test(input)) {
      const target = input.replace(/^preview\b/iu, '').trim()
      result = target === ''
        ? { kind: 'invalid', message: 'usage: /rewind preview <id-prefix | step <N> | latest>' }
        : { kind: 'preview', target }
    } else if (/^diff\s+(\S+)\s+(\S+)$/iu.test(input)) {
      const diff = /^diff\s+(\S+)\s+(\S+)$/iu.exec(input)
      result = { kind: 'diff', a: diff[1], b: diff[2] }
    } else if (/^diff\b/iu.test(input)) {
      result = { kind: 'invalid', message: 'usage: /rewind diff <checkpoint-a> <checkpoint-b>' }
    } else if (/^(workspace|session|config|all)\s+(.+)$/iu.test(input)) {
      const targeted = /^(workspace|session|config|all)\s+(.+)$/iu.exec(input)
      result = { kind: 'target', target: targeted[1].toLowerCase(), input: targeted[2].trim() }
    } else if (/^(workspace|session|config|all)\b/iu.test(input)) {
      result = { kind: 'invalid', message: 'usage: /rewind [workspace|session|config|all] <id-prefix | step <N> | latest>' }
    } else {
      result = { kind: 'id', input }
    }
  }
  if (files === undefined || result.kind === 'invalid') return result
  // --files 只对恢复目标有意义（list/diff/preview/clear 拒绝）。
  switch (result.kind) {
    case 'id':
    case 'latest':
    case 'step':
    case 'target':
      return { ...result, files }
    default:
      return { kind: 'invalid', message: 'usage: --files only applies to a restore target (e.g. /rewind workspace <id> --files a.txt,b.txt)' }
  }
}

/**
 * /checkpoint 输入解析（手动检查点命令）。
 * @param {string} rawInput - 命令原始输入（未 trim）。
 * @returns {{kind: 'create', note?: string} | {kind: 'list'}
 *   | {kind: 'diff', a: string, b: string} | {kind: 'invalid', message: string}} 解析结果。
 */
export function parseCheckpointInput(rawInput) {
  const input = rawInput.trim()
  if (input === '') return { kind: 'create' }
  const lower = input.toLowerCase()
  if (lower === 'list') return { kind: 'list' }
  const diff = /^diff\s+(\S+)\s+(\S+)$/iu.exec(input)
  if (diff !== null) return { kind: 'diff', a: diff[1], b: diff[2] }
  if (/^diff\b/iu.test(input)) {
    return { kind: 'invalid', message: 'usage: /checkpoint diff <checkpoint-a> <checkpoint-b>' }
  }
  const noted = /^note\b\s*/iu.exec(input)
  if (noted !== null) {
    const note = input.slice(noted[0].length).trim()
    return note === ''
      ? { kind: 'invalid', message: 'usage: /checkpoint note <text>' }
      : { kind: 'create', note }
  }
  return { kind: 'create', note: input }
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
 * 检查点列表渲染（/rewind 与 /checkpoint list 共用的命令文本）。
 * 每一行：短 id（可直接当寻址前缀）、kind、provider、turn/step、时间（可选
 * 相对后缀）、触发、文件数、大小、树 SHA 短形、会话边界可用性、备注。
 * @param {CheckpointRecord[]} records - 已按 listLimit 截取的记录（任意顺序）。
 * @param {object} [opts] - {timeFormatter, now, total, command}（测试注入；command 决定提示行文案）。
 * @returns {string} 多行文本。
 */
export function formatCheckpointList(records, opts = {}) {
  const command = opts.command ?? 'rewind'
  if (records.length === 0) return `${command}: no checkpoints yet`
  const timeFormatter = opts.timeFormatter ?? ((ms) => new Date(ms).toLocaleString())
  const lines = sortOldestFirst(records).map((record) => {
    const session = typeof record.sessionBoundary === 'number'
      ? `session: replay-ready`
      : 'session: fresh (no closed turn yet)'
    const tree = record.tree
      ? `tree ${record.tree.slice(0, 8)}`
      : 'tree: n/a (copy)'
    const time = timeFormatter(record.time)
    const relative = opts.now === undefined ? '' : formatRelativeAge(opts.now - record.time)
    const note = typeof record.note === 'string' && record.note.length > 0
      ? ` · note: ${record.note}`
      : ''
    return [
      `#${record.id.slice(0, 8)}`,
      `[${record.kind ?? 'mutation'}]`,
      `(${record.provider})`,
      `turn ${record.turn} step ${record.step}`,
      `${time}${relative}`,
      `trigger: ${record.triggerTool}`,
      `${record.files} file${record.files === 1 ? '' : 's'}`,
      formatBytes(record.bytes),
      tree,
      session,
    ].join(' · ') + note
  })
  const more = opts.total !== undefined && opts.total > records.length
    ? `… and ${opts.total - records.length} older checkpoint(s) (run /${command} clear to remove them)`
    : ''
  return [
    `${command}: ${lines.length} checkpoint${lines.length === 1 ? '' : 's'} (newest last):`,
    ...lines,
    `run "/rewind <id>" to restore all three states, or "/rewind workspace|session|config <id>" for one`,
    more,
  ].filter(line => line.length > 0).join('\n')
}

/**
 * 回退确认与结果摘要文本（confirm 问题 detail 与命令结果共用；三态一体）。
 * @param {CheckpointRecord} record - 目标检查点。
 * @returns {string} 摘要文本。
 */
export function formatRewindSummary(record) {
  return [
    `checkpoint #${record.id}`,
    `kind: ${record.kind ?? 'mutation'} · provider: ${record.provider}`,
    `captured at turn ${record.turn} step ${record.step} (${record.triggerTool})`,
    `${record.files} file(s), ${formatBytes(record.bytes)}`,
    record.tree ? `workspace git tree: ${record.tree}` : 'workspace: copy snapshot (no git tree)',
    `session cursor: seq ${record.seq}${typeof record.sessionBoundary === 'number' ? ` (replay boundary seq ${record.sessionBoundary}, end of turn)` : ' (no closed turn yet: rewind replays an empty context)'}`,
    record.config !== undefined ? `config snapshot: ${Object.keys(record.config).length} key(s)` : 'config snapshot: none',
    typeof record.note === 'string' && record.note.length > 0 ? `note: ${record.note}` : '',
  ].filter(line => line.length > 0).join('\n')
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

/**
 * 两两对比结果渲染（/rewind diff 与 /checkpoint diff 共用）。
 * 文件变更数（provider 侧）+ 配置行 diff + 会话游标差。
 * @param {CheckpointRecord} from - 旧检查点。
 * @param {CheckpointRecord} to - 新检查点。
 * @param {object} diff - 对比结果：
 *   {files: {changed, added, removed, names, truncated}, configDiff: {changed, lines, text},
 *    session: {fromSeq, toSeq, fromTurn, toTurn, fromStep, toStep, dropped}, note?: string}。
 * @param {object} [opts] - {limit}（文件清单上限，默认 20）。
 * @returns {string} 多行文本。
 */
export function formatCheckpointDiff(from, to, diff, opts = {}) {
  const limit = opts.limit ?? 20
  const names = (diff.files?.names ?? []).slice(0, limit)
  const truncated = diff.files?.truncated ?? (diff.files?.names?.length ?? 0) > limit
  const head = [
    `checkpoint diff: #${from.id.slice(0, 8)} → #${to.id.slice(0, 8)}`,
    `workspace files: ${diff.files?.changed ?? 0} changed (${diff.files?.added ?? 0} added, ${diff.files?.removed ?? 0} removed)${names.length > 0 ? ':' : '.'}`,
    ...names.map(name => `  ${name}`),
    truncated ? `  … and more` : '',
    diff.note !== undefined && diff.note.length > 0 ? `note: ${diff.note}` : '',
    `config: ${diff.configDiff?.changed === true ? `${diff.configDiff.lines} line(s) changed:` : 'unchanged'}`,
  ].filter(line => line.length > 0)
  const body = []
  if (diff.configDiff?.changed === true && diff.configDiff.text.length > 0) {
    body.push(...diff.configDiff.text.split('\n').map(line => `  ${line}`))
  }
  const s = diff.session
  if (s !== undefined) {
    const fromLabel = `${s.fromSeq} (turn ${s.fromTurn ?? '-'} step ${s.fromStep ?? '-'})`
    const toLabel = `${s.toSeq} (turn ${s.toTurn ?? '-'} step ${s.toStep ?? '-'})`
    body.push(`session: cursor ${fromLabel} → ${toLabel}; rewinding ${to.id.slice(0, 8)}→${from.id.slice(0, 8)} drops ${s.dropped} event(s)`)
  }
  return [...head, ...body].join('\n')
}

/**
 * 检查点来源分类的人类可读标签。
 * @param {string} kind - record.kind。
 * @returns {string} 标签文本。
 */
export function kindLabel(kind) {
  switch (kind) {
    case 'manual': return 'manual'
    case 'auto': return 'auto'
    case 'guard': return 'guard'
    default: return 'mutation'
  }
}
