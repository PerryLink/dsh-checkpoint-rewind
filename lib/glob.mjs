// lib/glob.mjs — 轻量 glob → 相对路径匹配器（零依赖）。
//
// 语义（copy provider 排除项用）：
// - '*' 单段内任意字符（不含 '/'）；'?' 单字符；'**' 跨任意段（含 0 段）；
// - 无 '/' 的 pattern 匹配任意深度段名（与旧"精确段名"排除语义兼容，
//   ['node_modules','dist'] 这类默认值行为不变）；
// - 含 '/' 的 pattern 按相对工作区根的相对路径匹配（'dist/*' 只匹配 dist
//   的直接子项；'**/*.tmp' 任意深度临时文件）；
// - Windows 下大小写不敏感；pattern 中的 '\\' 归一为 '/'。
//
// 匹配是段级回溯（pattern 段数有限、每段简单正则），无 ReDoS 面。

/** 单段 pattern → 段正则（缓存；段内 '*'/'?' 转译，其余按字面转义）。 */
const segmentCache = new Map()
function segmentRegex(segment) {
  let regex = segmentCache.get(segment)
  if (regex !== undefined) return regex
  let source = ''
  for (const char of segment) {
    if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[\\^$+?.()|[\]{}]/u, '\\$&')
  }
  regex = new RegExp(`^${source}$`)
  segmentCache.set(segment, regex)
  return regex
}

/**
 * 段级回溯匹配：'**' 吞 0..n 段，其余段一对一。
 * @param {string[]} pattern - 规范化后的 pattern 段。
 * @param {string[]} segments - 相对路径段。
 * @param {number} [pi] - pattern 游标。
 * @param {number} [si] - 路径游标。
 * @returns {boolean} 是否匹配。
 */
function matchSegments(pattern, segments, pi = 0, si = 0) {
  if (pi === pattern.length) return si === segments.length
  if (pattern[pi] === '**') {
    for (let skip = si; skip <= segments.length; skip++) {
      if (matchSegments(pattern, segments, pi + 1, skip)) return true
    }
    return false
  }
  if (si >= segments.length) return false
  if (!segmentRegex(pattern[pi]).test(segments[si])) return false
  return matchSegments(pattern, segments, pi + 1, si + 1)
}

/**
 * 构造排除匹配器。
 * 语义（gitignore 心智模型）：路径的任一前缀命中即排除——目录被排除时
 * 其下一切也被排除，与调用方的目录优先判断（walk 先问目录）严格一致。
 * @param {string[]} patterns - glob 模式列表（空数组/空模式 = 不排除任何路径）。
 * @returns {(relPath: string) => boolean} 相对路径（'/' 分隔）排除谓词。
 */
export function makeGlobMatcher(patterns) {
  const win32 = process.platform === 'win32'
  const rules = []
  for (const pattern of patterns) {
    const text = String(pattern).replace(/\\/gu, '/')
    const segments = text.split('/').filter(segment => segment.length > 0)
    if (segments.length === 0) continue // 空模式（''、'/'、'///'）不排除任何路径
    const final = text.includes('/') ? segments : ['**', ...segments]
    // 连续 '**' 合并为一个（'a/**/**/b' ≡ 'a/**/b'）：语义不变，消除段级回溯的冗余分支。
    const collapsed = []
    for (const segment of final) {
      if (segment === '**' && collapsed.at(-1) === '**') continue
      collapsed.push(segment)
    }
    rules.push(win32 ? collapsed.map(segment => segment.toLowerCase()) : collapsed)
  }
  return (relPath) => {
    const raw = String(relPath).split('/').filter(segment => segment.length > 0)
    const segments = win32 ? raw.map(segment => segment.toLowerCase()) : raw
    for (let end = 1; end <= segments.length; end++) {
      const prefix = segments.slice(0, end)
      if (rules.some(rule => matchSegments(rule, prefix))) return true
    }
    return false
  }
}
