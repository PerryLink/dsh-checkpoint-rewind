// lib/diff.mjs — 配置快照对比纯函数（零依赖）。
//
// 检查点记录的 config 快照是 JSON 对象；两两对比渲染为行级 unified diff。
// 为保证输出稳定（与键插入顺序无关），先做递归按键排序的 stableStringify，
// 再按行做 LCS 差异（配置快照只有几十行，O(n·m) 的 DP 足够）。
// 纯函数：只产出文本与结构，不读写任何存储。

/**
 * 递归按键排序的稳定 JSON 序列化（对比基线：键顺序无关）。
 * @param {unknown} value - 任意 JSON 值。
 * @returns {string} 稳定单行 JSON（无空白差异）。
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

/**
 * 配置快照 → 可 diff 的行（每行一条属性，键排序稳定）。
 * @param {object} [config] - 检查点 config 快照；缺失视为空对象。
 * @returns {string[]} 文本行。
 */
export function configLinesOf(config) {
  if (config === null || typeof config !== 'object') return ['{}']
  return stableStringify(config).split('\n')
}

/**
 * 最简 LCS 差异表（行序列 → 编辑脚本）。
 * @param {string[]} a - 旧行。
 * @param {string[]} b - 新行。
 * @returns {Array<{op: 'keep'|'del'|'add', line?: string, a?: number, b?: number}>} 编辑脚本。
 */
export function diffLines(a, b) {
  const n = a.length
  const m = b.length
  // DP 表：(n+1)×(m+1)；配置快照行数很小，内存无忧。
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: 'keep', line: a[i], a: i, b: j })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ op: 'del', line: a[i], a: i })
      i += 1
    } else {
      ops.push({ op: 'add', line: b[j], b: j })
      j += 1
    }
  }
  while (i < n) ops.push({ op: 'del', line: a[i++], a: i - 1 })
  while (j < m) ops.push({ op: 'add', line: b[j++], b: j - 1 })
  return ops
}

/**
 * 行级 unified diff（- 旧 / + 新，@@ 块头；全量输出，配置快照规模小）。
 * @param {string[]} a - 旧行。
 * @param {string[]} b - 新行。
 * @param {object} [opts] - {fromLabel, toLabel}（默认 'a' / 'b'）。
 * @returns {string} unified diff 文本（空差异返回空串）。
 */
export function unifiedDiffLines(a, b, opts = {}) {
  const ops = diffLines(a, b)
  if (ops.every(op => op.op === 'keep')) return ''
  const fromLabel = opts.fromLabel ?? 'a'
  const toLabel = opts.toLabel ?? 'b'
  const out = []
  // 统一 diff 头（0 行时仍保留 1 行空的惯例）。
  const fileA = fromLabel === '' ? '/dev/null' : fromLabel
  const fileB = toLabel === '' ? '/dev/null' : toLabel
  out.push(`--- ${fileA}`)
  out.push(`+++ ${fileB}`)
  // 变更区域：连续变更行（±）及其前后各 3 行上下文。
  const inRegion = ops.map((_, index) =>
    ops.slice(Math.max(0, index - 3), index + 4).some(op => op.op !== 'keep'))
  const hunks = []
  let current = null
  for (let index = 0; index < ops.length; index++) {
    if (!inRegion[index]) continue
    if (current === null || index > current.end + 1) {
      current = { start: index, end: index, lines: [] }
      hunks.push(current)
    } else {
      current.end = index
    }
    const op = ops[index]
    if (op.op === 'keep') current.lines.push({ text: ` ${op.line}`, op })
    else if (op.op === 'del') current.lines.push({ text: `-${op.line}`, op })
    else current.lines.push({ text: `+${op.line}`, op })
  }
  for (const hunk of hunks) {
    // @@ 头：两侧各自第一条变更行的 1-based 行号（纯增/纯删缺一侧时取另一侧行号）。
    const first = hunk.lines.find(entry => entry.op.op !== 'keep').op
    const oldStart = (first.a ?? first.b) + 1
    const newStart = (first.b ?? first.a) + 1
    out.push(`@@ -${oldStart} +${newStart} @@`)
    out.push(...hunk.lines.map(entry => entry.text))
  }
  return out.join('\n')
}

/**
 * 两段配置快照的行级 diff 摘要（"配置行 diff"）。
 * @param {object} [from] - 旧配置快照。
 * @param {object} [to] - 新配置快照。
 * @returns {{changed: boolean, lines: number, text: string}} 变更与否、增删行数、unified 文本。
 */
export function configDiff(from, to) {
  const a = configLinesOf(from)
  const b = configLinesOf(to)
  const text = unifiedDiffLines(a, b)
  if (text === '') return { changed: false, lines: 0, text: '' }
  const ops = diffLines(a, b)
  const lines = ops.filter(op => op.op !== 'keep').length
  return { changed: true, lines, text }
}
