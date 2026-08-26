// lib/render.mjs — 设置页 diff 渲染器 seam（零依赖）。
//
// 「diff 数据 → 渲染输入」的纯函数接口：host 端定义契约与两个内建渲染器，
// client 端按渲染器 id 注册渲染（client/index.js 镜像同一契约）。渲染输入是
// 纯 JSON 结构（无 React/无 DOM），client 据其渲染，两端永不漂移。
// - pairwise：现有行级文本 diff（配置 unified 文本 + 文件清单），现状默认；
// - side-by-side：per-file 两列视图（每个变更文件一行，from/to 状态 + 配置
//   增删行左/右配对）。
// 解析器失败关闭：未知渲染器 id 回落 pairwise，绝不破坏现有 diff 视图。

import { DIFF_RENDERER_MODES } from './constants.mjs'

/** 默认渲染器（pairwise = 现状行为，向后兼容）。 */
export const DEFAULT_DIFF_RENDERER = DIFF_RENDERER_MODES.PAIRWISE

/**
 * 配置 unified diff 文本 → 行级渲染输入（pairwise 用）。
 * 前缀着色：+ add / - del / @@ hunk / 其余（上下文、文件头）原样。
 * @param {string} [text] - configDiff.text（unified 文本）。
 * @returns {Array<{cls: string, text: string}>} 行数组（cls ∈ add|del|hunk|ctx）。
 */
export function configTextRows(text) {
  return String(text ?? '').split('\n').map((line) => {
    if (line.startsWith('+')) return { cls: 'add', text: line.slice(1) }
    if (line.startsWith('-')) return { cls: 'del', text: line.slice(1) }
    if (line.startsWith('@@')) return { cls: 'hunk', text: line }
    return { cls: 'ctx', text: line }
  })
}

/**
 * 配置 unified diff 文本 → 左/右配对行（side-by-side 用）。
 * 删除行进左列、新增行进右列；连续的一删一增配对到同一行；上下文与头行两侧同值。
 * @param {string} [text] - configDiff.text。
 * @returns {Array<{left: string, right: string}>} 配对行（null 表示该侧无内容）。
 */
export function sideBySideConfigRows(text) {
  const rows = []
  let pendingLeft = null // 上一个未配对的删除行
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('-')) {
      flush()
      pendingLeft = line.slice(1)
    } else if (line.startsWith('+')) {
      const right = line.slice(1)
      if (pendingLeft !== null) {
        rows.push({ left: pendingLeft, right })
        pendingLeft = null
      } else {
        rows.push({ left: null, right })
      }
    } else {
      flush()
      rows.push({ left: line, right: line })
    }
  }
  flush()
  return rows
  function flush() {
    if (pendingLeft !== null) {
      rows.push({ left: pendingLeft, right: null })
      pendingLeft = null
    }
  }
}

/**
 * per-file 变更条目 → 两列行（side-by-side 用）。
 * @param {Array<{path: string, status: 'added'|'removed'|'changed'}>} [entries] - provider.diffFiles 的 entries。
 * @returns {Array<{path: string, status: string, left: boolean, right: boolean}>}
 *   left = 旧检查点含该文件；right = 新检查点含该文件。
 */
export function sideBySideFileRows(entries) {
  return (entries ?? []).map((entry) => {
    switch (entry.status) {
      case 'added': return { path: entry.path, status: 'added', left: false, right: true }
      case 'removed': return { path: entry.path, status: 'removed', left: true, right: false }
      default: return { path: entry.path, status: 'changed', left: true, right: true }
    }
  })
}

/** 从 diff 数据取文件统计（缺失字段兜底为 0/空）。 */
function filesOf(diffData) {
  const files = diffData?.files ?? {}
  return {
    changed: files.changed ?? 0,
    added: files.added ?? 0,
    removed: files.removed ?? 0,
    names: files.names ?? [],
    truncated: files.truncated ?? false,
    entries: files.entries ?? [],
  }
}

/**
 * pairwise 渲染器（现状默认）：文件清单 + 配置行级文本 + 会话游标差。
 * @param {object} [diffData] - panel.diff 结果（含 files.entries/configDiff/session）。
 * @returns {{kind: 'pairwise', files: object, config: Array<{cls, text}>, session: object}} 渲染输入。
 */
export function renderPairwiseDiff(diffData) {
  return {
    kind: DIFF_RENDERER_MODES.PAIRWISE,
    files: filesOf(diffData),
    config: configTextRows(diffData?.configDiff?.text),
    session: diffData?.session ?? {},
  }
}

/**
 * per-file 并排渲染器：每个变更文件一行（左=旧/右=新）+ 配置增删行左/右配对。
 * @param {object} [diffData] - panel.diff 结果。
 * @returns {{kind: 'side-by-side', files: Array<{path, status, left, right}>, config: Array<{left, right}>, session: object}} 渲染输入。
 */
export function renderSideBySideDiff(diffData) {
  return {
    kind: DIFF_RENDERER_MODES.SIDE_BY_SIDE,
    files: sideBySideFileRows(filesOf(diffData).entries),
    config: sideBySideConfigRows(diffData?.configDiff?.text),
    session: diffData?.session ?? {},
  }
}

/** 渲染器注册表（id → 「diff 数据 → 渲染输入」纯函数）。 */
export const DIFF_RENDERERS = Object.freeze({
  [DIFF_RENDERER_MODES.PAIRWISE]: renderPairwiseDiff,
  [DIFF_RENDERER_MODES.SIDE_BY_SIDE]: renderSideBySideDiff,
})

/**
 * 解析渲染器：未知 id 回落 pairwise（失败关闭，不破坏现状）。
 * @param {string} [id] - 配置的渲染器 id。
 * @returns {(diffData: object) => object} 渲染器纯函数。
 */
export function resolveDiffRenderer(id) {
  return DIFF_RENDERERS[id] ?? DIFF_RENDERERS[DIFF_RENDERER_MODES.PAIRWISE]
}

/**
 * 选中文件字节汇总（逐文件勾选的大小统计用）。
 * @param {Array<{path: string, bytes?: number}>} entries - 勾选的文件条目。
 * @returns {number} 选中文件字节总和。
 */
export function sumEntryBytes(entries) {
  return (entries ?? []).reduce((sum, entry) => sum + (Number.isFinite(entry?.bytes) ? entry.bytes : 0), 0)
}
