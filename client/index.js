// client/index.js — dsh-checkpoint-rewind 浏览器半：设置页 Plugins →
// Checkpoints 标签页（checkpoint 时间线 + 两两 diff）。
//
// 无构建步骤：手写 window.__ModuleLoader__.load 客户端包（与 dsh-mcp-panel
// 的 lib/client.js 同形态），React 经 require('react') 由壳层提供。
// 数据全部经 Typert Remote（checkpointPanel/timeline + diff，只读）；回滚
// 不在面板执行（审批门需要 agent 会话上下文），面板把回滚指向会话内的
// /rewind 命令。descriptor 必须与 lib/wire.mjs 完全一致（两端 codec 不漂移）。

window.__ModuleLoader__.load({
  id: 'dsh-checkpoint-rewind',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var react = require('react')

    var createElement = react.createElement
    var Fragment = react.Fragment
    var useState = react.useState
    var useEffect = react.useEffect
    var useMemo = react.useMemo

    // --- 与 lib/wire.mjs 的 PANEL_INVOCATIONS 完全一致的 descriptor（手抄，
    // 校验由两端注册器各自执行；改 lib/wire.mjs 必须同步此处）。
    // codec.schema 是轻量解析器：客户端注册表只要求 schema.parse 是函数；
    // 权威严格校验在宿主端（zod）。客户端 parse 只做形状防御。
    var SOURCE_LOCATION = Object.freeze({ file: 'lib/wire.mjs', line: 1, column: 1 })

    function failShape(field, value) {
      throw new Error('client checkpointPanel: unexpected ' + field + ' value ' + String(value))
    }

    function parseOptionalLimit(value) {
      if (value === undefined || value === null) return undefined
      if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value
      failShape('limit', value)
    }

    function parseIdRef(value) {
      if (typeof value === 'string' && value.length > 0) return value
      failShape('id', value)
    }

    function assertPlain(value, field) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) failShape(field, value)
      return value
    }

    function parseTimelineSnapshot(value) {
      assertPlain(value, 'timeline')
      var rows = value.rows
      if (!Array.isArray(rows)) failShape('timeline.rows', rows)
      return value
    }

    function parseDiffResult(value) {
      assertPlain(value, 'diff')
      return value
    }

    function parseRestorePreviewResult(value) {
      assertPlain(value, 'restorePreview')
      if (!Array.isArray(value.files)) failShape('restorePreview.files', value.files)
      return value
    }

    var PANEL_INVOCATIONS = Object.freeze([
      Object.freeze({
        id: 'dsh-checkpoint-rewind#checkpointPanel/timeline',
        service: 'checkpointPanel',
        namespace: 'checkpointPanel',
        method: 'timeline',
        invocation: Object.freeze({ kind: 'direct' }),
        parameters: Object.freeze([Object.freeze({
          name: 'limit', wire: 'limit', source: 'json',
          codec: Object.freeze({
            mode: 'strict',
            typeSymbol: 'dsh-checkpoint-rewind/types#TimelineLimit',
            schema: Object.freeze({ parse: parseOptionalLimit }),
          }),
        })]),
        result: Object.freeze({
          mode: 'strict',
          typeSymbol: 'dsh-checkpoint-rewind/types#TimelineSnapshot',
          schema: Object.freeze({ parse: parseTimelineSnapshot }),
        }),
        sourceLocation: SOURCE_LOCATION,
      }),
      Object.freeze({
        id: 'dsh-checkpoint-rewind#checkpointPanel/diff',
        service: 'checkpointPanel',
        namespace: 'checkpointPanel',
        method: 'diff',
        invocation: Object.freeze({ kind: 'direct' }),
        parameters: Object.freeze([
          Object.freeze({
            name: 'from', wire: 'from', source: 'json',
            codec: Object.freeze({
              mode: 'strict',
              typeSymbol: 'dsh-checkpoint-rewind/types#CheckpointIdRef',
              schema: Object.freeze({ parse: parseIdRef }),
            }),
          }),
          Object.freeze({
            name: 'to', wire: 'to', source: 'json',
            codec: Object.freeze({
              mode: 'strict',
              typeSymbol: 'dsh-checkpoint-rewind/types#CheckpointIdRef',
              schema: Object.freeze({ parse: parseIdRef }),
            }),
          }),
        ]),
        result: Object.freeze({
          mode: 'strict',
          typeSymbol: 'dsh-checkpoint-rewind/types#DiffResult',
          schema: Object.freeze({ parse: parseDiffResult }),
        }),
        sourceLocation: SOURCE_LOCATION,
      }),
      Object.freeze({
        id: 'dsh-checkpoint-rewind#checkpointPanel/restorePreview',
        service: 'checkpointPanel',
        namespace: 'checkpointPanel',
        method: 'restorePreview',
        invocation: Object.freeze({ kind: 'direct' }),
        parameters: Object.freeze([
          Object.freeze({
            name: 'id', wire: 'id', source: 'json',
            codec: Object.freeze({
              mode: 'strict',
              typeSymbol: 'dsh-checkpoint-rewind/types#CheckpointIdRef',
              schema: Object.freeze({ parse: parseIdRef }),
            }),
          }),
        ]),
        result: Object.freeze({
          mode: 'strict',
          typeSymbol: 'dsh-checkpoint-rewind/types#RestorePreviewResult',
          schema: Object.freeze({ parse: parseRestorePreviewResult }),
        }),
        sourceLocation: SOURCE_LOCATION,
      }),
    ])

    var NS = 'settings.checkpointRewind'

    var locales = {
      en: {
        tab: 'Checkpoints',
        title: 'Checkpoint timeline',
        subtitle: 'Unified workspace + session + config snapshots',
        refresh: 'Refresh',
        loading: 'Loading timeline…',
        loadError: 'Failed to load the timeline',
        retry: 'Retry',
        empty: 'No checkpoints yet. Capture one with /checkpoint or the checkpoint tool.',
        total: '{shown} of {total} checkpoints · {bytes} stored (limits: {count} per session, {quota} total)',
        kindManual: 'manual',
        kindAuto: 'auto',
        kindGuard: 'guard',
        kindMutation: 'mutation',
        treeNone: 'copy snapshot',
        replayReady: 'replay-ready',
        replayFresh: 'fresh context',
        selectA: 'Select as A (older)',
        selectB: 'Select as B (newer)',
        clearCompare: 'Clear comparison',
        compareHint: 'Select two checkpoints to compare them.',
        comparing: 'Comparing…',
        compareError: 'Comparison failed',
        filesTitle: 'Workspace files',
        filesChanged: '{changed} changed ({added} added, {removed} removed)',
        filesTruncated: '… and more files',
        configTitle: 'Config snapshot',
        configChanged: '{lines} line(s) changed',
        configUnchanged: 'unchanged',
        sessionTitle: 'Session cursor',
        sessionDelta: 'cursor {fromSeq} (turn {fromTurn} step {fromStep}) → {toSeq} (turn {toTurn} step {toStep}); rewinding drops {dropped} event(s)',
        fromNote: 'B note',
        toNote: 'A note',
        noNote: 'no note',
        rewindHint: 'Rollback runs in the session: /rewind <id> (all three states) or /rewind workspace|session|config <id> — approval-gated, with a diff summary first.',
        copy: 'Copy /rewind',
        copied: 'Copied',
        diffNote: 'Diff',
        guardBadge: 'guard',
        restoreSelect: 'Restore files…',
        restoreTitle: 'Selective restore',
        restoreHint: 'Tick the files to restore. The restore itself runs in the session: approval-gated, with a guard checkpoint first.',
        restoreLoading: 'Loading files…',
        restoreError: 'Failed to load restore preview',
        selectAll: 'Select all',
        deselectAll: 'Clear',
        selectedSize: '{n} file(s) · {bytes} selected',
        copyRestore: 'Copy /rewind --files',
        restoreTruncated: '… and more files',
        rendererPairwise: 'pairwise',
        rendererSideBySide: 'side-by-side',
      },
      zh: {
        tab: '检查点',
        title: '检查点时间线',
        subtitle: '会话 + 工作区 + 配置 三态统一快照',
        refresh: '刷新',
        loading: '正在加载时间线…',
        loadError: '加载时间线失败',
        retry: '重试',
        empty: '还没有检查点。用 /checkpoint 或 checkpoint 工具捕获一个。',
        total: '共 {total} 个检查点，显示 {shown} 个 · 已存 {bytes}（配额：每会话 {count} 个 / 总量 {quota}）',
        kindManual: '手动',
        kindAuto: '自动',
        kindGuard: '保护',
        kindMutation: '变更',
        treeNone: 'copy 快照',
        replayReady: '可重放',
        replayFresh: '全新上下文',
        selectA: '选为 A（较早）',
        selectB: '选为 B（较新）',
        clearCompare: '清除对比',
        compareHint: '选择两个检查点进行对比。',
        comparing: '对比中…',
        compareError: '对比失败',
        filesTitle: '工作区文件',
        filesChanged: '{changed} 个变更（新增 {added}，删除 {removed}）',
        filesTruncated: '… 以及更多文件',
        configTitle: '配置快照',
        configChanged: '{lines} 行差异',
        configUnchanged: '无变化',
        sessionTitle: '会话游标',
        sessionDelta: '游标 {fromSeq}（turn {fromTurn} step {fromStep}）→ {toSeq}（turn {toTurn} step {toStep}）；回退将丢弃 {dropped} 条事件',
        fromNote: 'B 备注',
        toNote: 'A 备注',
        noNote: '无备注',
        rewindHint: '回滚在会话内执行：/rewind <id>（三态一体）或 /rewind workspace|session|config <id> —— 先展示 diff 摘要并过审批。',
        copy: '复制 /rewind',
        copied: '已复制',
        diffNote: '对比',
        guardBadge: '保护',
        restoreSelect: '恢复文件…',
        restoreTitle: '选择性恢复',
        restoreHint: '勾选要恢复的文件。实际恢复在会话内执行：先过审批门，并先捕获保护检查点。',
        restoreLoading: '正在加载文件…',
        restoreError: '加载恢复预览失败',
        selectAll: '全选',
        deselectAll: '清空',
        selectedSize: '已选 {n} 个文件 · {bytes}',
        copyRestore: '复制 /rewind --files',
        restoreTruncated: '… 以及更多文件',
        rendererPairwise: '逐行',
        rendererSideBySide: '并排',
      },
    }

    // --- 样式（scoped，effect 注册 / 卸载撤销）。---
    var STYLES = [
      '[data-dsh-checkpoint-rewind] .dcr-root { display: flex; flex-direction: column; gap: 12px; font-size: 13px; line-height: 1.5; }',
      '[data-dsh-checkpoint-rewind] .dcr-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }',
      '[data-dsh-checkpoint-rewind] .dcr-title { font-size: 15px; font-weight: 600; margin: 0; }',
      '[data-dsh-checkpoint-rewind] .dcr-subtitle { color: var(--ds-color-text-muted, #888); margin: 0; }',
      '[data-dsh-checkpoint-rewind] .dcr-meta { color: var(--ds-color-text-muted, #888); font-size: 12px; }',
      '[data-dsh-checkpoint-rewind] .dcr-actions { display: flex; gap: 8px; }',
      '[data-dsh-checkpoint-rewind] .dcr-button { border: 1px solid var(--ds-color-border, #ccc); background: transparent; border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px; }',
      '[data-dsh-checkpoint-rewind] .dcr-button:hover { background: var(--ds-color-surface-hover, rgba(127,127,127,0.12)); }',
      '[data-dsh-checkpoint-rewind] .dcr-list { display: flex; flex-direction: column; gap: 6px; }',
      '[data-dsh-checkpoint-rewind] .dcr-row { display: flex; align-items: center; gap: 8px; border: 1px solid var(--ds-color-border, #ccc); border-radius: 6px; padding: 6px 10px; }',
      '[data-dsh-checkpoint-rewind] .dcr-row[data-selected="a"] { border-color: var(--ds-color-accent, #3b82f6); }',
      '[data-dsh-checkpoint-rewind] .dcr-row[data-selected="b"] { border-color: var(--ds-color-accent, #10b981); }',
      '[data-dsh-checkpoint-rewind] .dcr-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }',
      '[data-dsh-checkpoint-rewind] .dcr-id { font-family: ui-monospace, monospace; font-weight: 600; }',
      '[data-dsh-checkpoint-rewind] .dcr-badge { border-radius: 999px; padding: 0 7px; font-size: 11px; border: 1px solid var(--ds-color-border, #ccc); color: var(--ds-color-text-muted, #666); }',
      '[data-dsh-checkpoint-rewind] .dcr-note { color: var(--ds-color-text-muted, #888); font-style: italic; }',
      '[data-dsh-checkpoint-rewind] .dcr-select { font-size: 11px; padding: 2px 8px; border: 1px dashed var(--ds-color-border, #aaa); border-radius: 4px; background: transparent; cursor: pointer; white-space: nowrap; }',
      '[data-dsh-checkpoint-rewind] .dcr-select[data-role="a"] { color: #3b82f6; }',
      '[data-dsh-checkpoint-rewind] .dcr-select[data-role="b"] { color: #10b981; }',
      '[data-dsh-checkpoint-rewind] .dcr-diff { border: 1px solid var(--ds-color-border, #ccc); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 10px; }',
      '[data-dsh-checkpoint-rewind] .dcr-diff-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }',
      '[data-dsh-checkpoint-rewind] .dcr-diff-section { display: flex; flex-direction: column; gap: 4px; }',
      '[data-dsh-checkpoint-rewind] .dcr-diff-section h4 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ds-color-text-muted, #777); }',
      '[data-dsh-checkpoint-rewind] .dcr-file-list { margin: 0; padding-left: 18px; font-family: ui-monospace, monospace; font-size: 12px; }',
      '[data-dsh-checkpoint-rewind] .dcr-pre { margin: 0; padding: 8px; background: var(--ds-color-surface, rgba(127,127,127,0.08)); border-radius: 4px; font-family: ui-monospace, monospace; font-size: 11px; overflow-x: auto; white-space: pre; }',
      '[data-dsh-checkpoint-rewind] .dcr-pre .add { color: #10b981; }',
      '[data-dsh-checkpoint-rewind] .dcr-pre .del { color: #ef4444; }',
      '[data-dsh-checkpoint-rewind] .dcr-pre .hunk { color: var(--ds-color-text-muted, #888); }',
      '[data-dsh-checkpoint-rewind] .dcr-ss { display: flex; flex-direction: column; gap: 2px; font-family: ui-monospace, monospace; font-size: 11px; }',
      '[data-dsh-checkpoint-rewind] .dcr-ss-row { display: grid; grid-template-columns: 1fr 64px 1fr; gap: 8px; align-items: baseline; }',
      '[data-dsh-checkpoint-rewind] .dcr-ss-left, [data-dsh-checkpoint-rewind] .dcr-ss-right { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }',
      '[data-dsh-checkpoint-rewind] .dcr-ss-left.del { color: #ef4444; }',
      '[data-dsh-checkpoint-rewind] .dcr-ss-right.add { color: #10b981; }',
      '[data-dsh-checkpoint-rewind] .dcr-ss-empty { color: var(--ds-color-text-muted, #aaa); }',
      '[data-dsh-checkpoint-rewind] .dcr-ss-badge { text-align: center; font-size: 10px; border: 1px solid var(--ds-color-border, #ccc); border-radius: 999px; color: var(--ds-color-text-muted, #666); }',
      '[data-dsh-checkpoint-rewind] .dcr-file-path { font-family: ui-monospace, monospace; font-size: 12px; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }',
      '[data-dsh-checkpoint-rewind] .dcr-hint { border: 1px dashed var(--ds-color-border, #ccc); border-radius: 6px; padding: 8px 10px; color: var(--ds-color-text-muted, #777); font-size: 12px; }',
      '[data-dsh-checkpoint-rewind] .dcr-error { color: #ef4444; }',
      '[data-dsh-checkpoint-rewind] .dcr-empty { color: var(--ds-color-text-muted, #888); padding: 12px 0; }',
    ].join('\n')

    function installStyles() {
      var existing = document.querySelector('style[data-dsh-checkpoint-rewind]')
      if (existing) return
      var style = document.createElement('style')
      style.setAttribute('data-dsh-checkpoint-rewind', '')
      style.textContent = STYLES
      document.head.appendChild(style)
    }

    // --- 呈现辅助（纯函数）。---
    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return String(bytes) + ' B'
      var units = ['B', 'KiB', 'MiB', 'GiB']
      var value = bytes
      var unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      return (unit === 0 ? String(value) : value.toFixed(1)) + ' ' + units[unit]
    }

    function formatTime(ms) {
      var date = new Date(ms)
      var pad = (n) => String(n).padStart(2, '0')
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    function kindKey(kind) {
      switch (kind) {
        case 'manual': return 'kindManual'
        case 'auto': return 'kindAuto'
        case 'guard': return 'kindGuard'
        default: return 'kindMutation'
      }
    }

    function renderConfigDiff(text) {
      var lines = String(text || '').split('\n')
      return createElement('pre', { className: 'dcr-pre' }, lines.map(function (line, index) {
        var className = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : undefined
        return createElement('div', { key: index, className }, line.length === 0 ? '\u00a0' : line)
      }))
    }

    // --- 渲染器 seam（镜像 lib/render.mjs 契约：diff 数据 → 渲染输入 → React）。
    // pairwise（现状默认）与 side-by-side（per-file 并排）；未知 id 回落 pairwise，
    // 绝不破坏现有 diff 视图（失败关闭）。
    function sideBySideConfigRows(text) {
      var rows = []
      var pendingLeft = null
      String(text || '').split('\n').forEach(function (line) {
        if (line.startsWith('-')) {
          if (pendingLeft !== null) rows.push({ left: pendingLeft, right: null })
          pendingLeft = line.slice(1)
        } else if (line.startsWith('+')) {
          var right = line.slice(1)
          if (pendingLeft !== null) {
            rows.push({ left: pendingLeft, right: right })
            pendingLeft = null
          } else {
            rows.push({ left: null, right: right })
          }
        } else {
          if (pendingLeft !== null) { rows.push({ left: pendingLeft, right: null }); pendingLeft = null }
          rows.push({ left: line, right: line })
        }
      })
      if (pendingLeft !== null) rows.push({ left: pendingLeft, right: null })
      return rows
    }

    function sideBySideFileRows(entries) {
      return (entries || []).map(function (entry) {
        if (entry.status === 'added') return { path: entry.path, status: 'added', left: false, right: true }
        if (entry.status === 'removed') return { path: entry.path, status: 'removed', left: true, right: false }
        return { path: entry.path, status: 'changed', left: true, right: true }
      })
    }

    function filesSummary(result, t) {
      var files = result.files || {}
      return t('filesChanged')
        .replace('{changed}', String(files.changed ?? 0))
        .replace('{added}', String(files.added ?? 0))
        .replace('{removed}', String(files.removed ?? 0))
    }

    function renderSessionSection(result, t) {
      var s = result.session || {}
      return createElement('div', { className: 'dcr-diff-section', key: 'session' },
        createElement('h4', null, t('sessionTitle')),
        createElement('p', { className: 'dcr-meta' }, t('sessionDelta')
          .replace('{fromSeq}', String(s.fromSeq ?? 0))
          .replace('{fromTurn}', String(s.fromTurn ?? '-'))
          .replace('{fromStep}', String(s.fromStep ?? '-'))
          .replace('{toSeq}', String(s.toSeq ?? 0))
          .replace('{toTurn}', String(s.toTurn ?? '-'))
          .replace('{toStep}', String(s.toStep ?? '-'))
          .replace('{dropped}', String(s.dropped ?? 0))))
    }

    function renderNotesLine(result, t) {
      return createElement('p', { className: 'dcr-meta', key: 'notes' },
        t('fromNote') + ': ' + (result.fromNote ?? t('noNote')) + ' · ' + t('toNote') + ': ' + (result.toNote ?? t('noNote')))
    }

    function renderPairwiseDiff(result, t) {
      var files = result.files || {}
      var fileItems = (files.names || []).map(function (name) {
        return createElement('li', { key: name }, name)
      })
      if (files.truncated) fileItems.push(createElement('li', { key: 'more' }, t('filesTruncated')))
      return [
        createElement('div', { className: 'dcr-diff-section', key: 'files' },
          createElement('h4', null, t('filesTitle')),
          createElement('p', { className: 'dcr-meta' }, filesSummary(result, t)),
          fileItems.length > 0 ? createElement('ul', { className: 'dcr-file-list' }, fileItems) : null),
        createElement('div', { className: 'dcr-diff-section', key: 'config' },
          createElement('h4', null, t('configTitle')),
          result.configDiff && result.configDiff.changed
            ? createElement('p', { className: 'dcr-meta' }, t('configChanged').replace('{lines}', String(result.configDiff.lines)))
            : createElement('p', { className: 'dcr-meta' }, t('configUnchanged')),
          result.configDiff && result.configDiff.changed ? renderConfigDiff(result.configDiff.text) : null),
        renderSessionSection(result, t),
        renderNotesLine(result, t),
      ]
    }

    function renderSideBySideDiff(result, t) {
      var files = result.files || {}
      var fileRows = sideBySideFileRows(files.entries).map(function (row) {
        return createElement('div', { className: 'dcr-ss-row', key: row.path },
          createElement('span', { className: 'dcr-ss-left' }, row.left ? row.path : '\u00a0'),
          createElement('span', { className: 'dcr-ss-badge', 'data-status': row.status }, row.status),
          createElement('span', { className: 'dcr-ss-right' }, row.right ? row.path : '\u00a0'))
      })
      var configRows = sideBySideConfigRows(result.configDiff && result.configDiff.text).map(function (row, index) {
        return createElement('div', { className: 'dcr-ss-row', key: 'c' + index },
          createElement('span', { className: 'dcr-ss-left' + (row.left === null ? ' dcr-ss-empty' : ' del') }, row.left === null ? '\u00a0' : row.left),
          createElement('span', { className: 'dcr-ss-right' + (row.right === null ? ' dcr-ss-empty' : ' add') }, row.right === null ? '\u00a0' : row.right))
      })
      return [
        createElement('div', { className: 'dcr-diff-section', key: 'files' },
          createElement('h4', null, t('filesTitle')),
          createElement('p', { className: 'dcr-meta' }, filesSummary(result, t)),
          fileRows.length > 0 ? createElement('div', { className: 'dcr-ss' }, fileRows) : null),
        createElement('div', { className: 'dcr-diff-section', key: 'config' },
          createElement('h4', null, t('configTitle')),
          result.configDiff && result.configDiff.changed
            ? createElement('p', { className: 'dcr-meta' }, t('configChanged').replace('{lines}', String(result.configDiff.lines)))
            : createElement('p', { className: 'dcr-meta' }, t('configUnchanged')),
          result.configDiff && result.configDiff.changed ? createElement('div', { className: 'dcr-ss' }, configRows) : null),
        renderSessionSection(result, t),
        renderNotesLine(result, t),
      ]
    }

    var diffRenderers = { pairwise: renderPairwiseDiff, 'side-by-side': renderSideBySideDiff }

    function resolveDiffRenderer(id) {
      return diffRenderers[id] || diffRenderers.pairwise
    }

    // --- 选择性恢复面板（逐文件勾选 + 大小统计；只读，实际恢复走会话内 /rewind）。
    function RestorePanel(props) {
      var id = props.id
      var t = props.t
      var restorePreview = props.restorePreview
      var viewState = useState({ status: 'loading' })
      var view = viewState[0]
      var setView = viewState[1]
      var selectedState = useState(null)
      var selected = selectedState[0]
      var setSelected = selectedState[1]
      var copiedState = useState(false)
      var copied = copiedState[0]
      var setCopied = copiedState[1]

      useEffect(function () {
        var current = true
        setView({ status: 'loading' })
        Promise.resolve().then(function () { return restorePreview(id) }).then(
          function (result) {
            if (!current) return
            setView({ status: 'ready', result })
            setSelected(new Set((result.files || []).map(function (f) { return f.path })))
          },
          function (error) {
            if (current) setView({ status: 'error', message: error instanceof Error ? error.message : String(error) })
          },
        )
        return function () { current = false }
      }, [restorePreview, id])

      var toggle = function (path) {
        setSelected(function (current) {
          var next = current === null ? new Set() : new Set(current)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
      }

      var readyFiles = view.status === 'ready' ? (view.result.files || []) : []

      var copyRestore = function () {
        var chosen = readyFiles.filter(function (f) { return selected !== null && selected.has(f.path) })
        if (chosen.length === 0) return
        var text = '/rewind workspace ' + id.slice(0, 8) + ' --files ' + chosen.map(function (f) { return f.path }).join(',')
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () { setCopied(true); setTimeout(function () { setCopied(false) }, 1500) },
            function () {},
          )
        }
      }

      var children = []
      children.push(createElement('div', { className: 'dcr-diff-head', key: 'head' },
        createElement('span', { className: 'dcr-id' }, t('restoreTitle') + ' #' + id.slice(0, 8)),
        createElement('div', { className: 'dcr-actions' },
          createElement('button', {
            type: 'button', className: 'dcr-button',
            onClick: function () { setSelected(new Set(readyFiles.map(function (f) { return f.path }))) },
          }, t('selectAll')),
          createElement('button', { type: 'button', className: 'dcr-button', onClick: function () { setSelected(new Set()) } }, t('deselectAll')),
        )))

      if (view.status === 'loading') {
        children.push(createElement('p', { className: 'dcr-meta', key: 'loading' }, t('restoreLoading')))
      } else if (view.status === 'error') {
        children.push(createElement('p', { className: 'dcr-error', key: 'error' }, t('restoreError') + ': ' + view.message))
      } else {
        var result = view.result
        if (result.error !== null) {
          children.push(createElement('p', { className: 'dcr-error', key: 'error' }, result.error))
        } else if (readyFiles.length === 0) {
          children.push(createElement('p', { className: 'dcr-empty', key: 'empty' }, t('empty')))
        } else {
          var chosenFiles = readyFiles.filter(function (f) { return selected !== null && selected.has(f.path) })
          var chosenBytes = chosenFiles.reduce(function (sum, f) { return sum + (Number.isFinite(f.bytes) ? f.bytes : 0) }, 0)
          children.push(createElement('p', { className: 'dcr-meta', key: 'size' },
            t('selectedSize').replace('{n}', String(chosenFiles.length)).replace('{bytes}', formatBytes(chosenBytes))))
          children.push(createElement('div', { className: 'dcr-list', key: 'files' }, readyFiles.map(function (f) {
            var checked = selected !== null && selected.has(f.path)
            return createElement('label', { className: 'dcr-row', key: f.path },
              createElement('input', { type: 'checkbox', checked: checked, onChange: function () { toggle(f.path) } }),
              createElement('span', { className: 'dcr-file-path' }, f.path),
              createElement('span', { className: 'dcr-badge' }, formatBytes(f.bytes)))
          })))
          if (result.truncated) children.push(createElement('p', { className: 'dcr-meta', key: 'truncated' }, t('restoreTruncated')))
        }
      }
      children.push(createElement('div', { className: 'dcr-hint', key: 'hint' },
        createElement('div', null, t('restoreHint')),
        createElement('button', { type: 'button', className: 'dcr-button', onClick: copyRestore }, copied ? t('copied') : t('copyRestore')),
      ))
      return createElement('div', { className: 'dcr-diff', key: 'restore' }, children)
    }

    // --- 标签页组件（纯 React.createElement，无 JSX）。---
    function CheckpointTab(props) {
      var timeline = props.timeline
      var diff = props.diff
      var restorePreview = props.restorePreview
      var t = props.t

      var viewState = useState({ status: 'loading' })
      var view = viewState[0]
      var setView = viewState[1]
      var requestState = useState(0)
      var request = requestState[0]
      var setRequest = requestState[1]

      var selectedAState = useState(null)
      var selectedA = selectedAState[0]
      var setSelectedA = selectedAState[1]
      var selectedBState = useState(null)
      var selectedB = selectedBState[0]
      var setSelectedB = selectedBState[1]
      var diffState = useState({ status: 'idle' })
      var diffView = diffState[0]
      var setDiffView = diffState[1]
      var copiedState = useState(false)
      var copied = copiedState[0]
      var setCopied = copiedState[1]
      var restoreTargetState = useState(null)
      var restoreTarget = restoreTargetState[0]
      var setRestoreTarget = restoreTargetState[1]

      useEffect(function () {
        var current = true
        Promise.resolve().then(function () { return timeline({}) }).then(
          function (snapshot) { if (current) setView({ status: 'ready', snapshot }) },
          function (error) {
            if (current) setView({ status: 'error', message: error instanceof Error ? error.message : String(error) })
          },
        )
        return function () { current = false }
      }, [timeline, request])

      var selectedIds = selectedA + '\u0000' + selectedB
      useEffect(function () {
        if (selectedA === null || selectedB === null) return undefined
        var current = true
        setDiffView({ status: 'loading' })
        Promise.resolve().then(function () { return diff(selectedA, selectedB) }).then(
          function (result) { if (current) setDiffView({ status: 'ready', result }) },
          function (error) {
            if (current) setDiffView({ status: 'error', message: error instanceof Error ? error.message : String(error) })
          },
        )
        return function () { current = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [diff, selectedIds])

      var rows = view.status === 'ready' ? view.snapshot.rows : []
      var snapshot = view.status === 'ready' ? view.snapshot : null

      var copyRewind = useMemo(function () {
        var id = selectedB ?? selectedA
        return function () {
          if (id === null) return
          var text = '/rewind ' + id.slice(0, 8)
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
              function () { setCopied(true); setTimeout(function () { setCopied(false) }, 1500) },
              function () {},
            )
          }
        }
      }, [selectedIds, selectedA, selectedB])

      var selectiveRestore = snapshot !== null && snapshot.selectiveRestore === true

      var toggleSelect = function (id, role) {
        if (role === 'a') {
          setSelectedA(function (current) { return current === id ? null : id })
        } else {
          setSelectedB(function (current) { return current === id ? null : id })
        }
      }

      var toggleRestoreTarget = function (id) {
        setRestoreTarget(function (current) { return current === id ? null : id })
      }

      var children = []
      children.push(createElement('div', { className: 'dcr-head', key: 'head' },
        createElement('div', null,
          createElement('p', { className: 'dcr-title' }, t('title')),
          createElement('p', { className: 'dcr-subtitle' }, t('subtitle')),
        ),
        createElement('div', { className: 'dcr-actions' },
          createElement('button', {
            className: 'dcr-button',
            type: 'button',
            onClick: function () { setRequest(function (value) { return value + 1 }) },
          }, t('refresh')),
        ),
      ))

      if (view.status === 'loading') {
        children.push(createElement('p', { className: 'dcr-meta', key: 'loading' }, t('loading')))
      } else if (view.status === 'error') {
        children.push(createElement('div', { key: 'error' },
          createElement('p', { className: 'dcr-error' }, t('loadError') + ': ' + view.message),
          createElement('button', {
            className: 'dcr-button', type: 'button',
            onClick: function () { setView({ status: 'loading' }); setRequest(function (value) { return value + 1 }) },
          }, t('retry')),
        ))
      } else {
        children.push(createElement('p', { className: 'dcr-meta', key: 'meta' },
          t('total')
            .replace('{shown}', String(rows.length))
            .replace('{total}', String(snapshot.total))
            .replace('{bytes}', formatBytes(snapshot.bytes))
            .replace('{count}', String(snapshot.maxSnapshots))
            .replace('{quota}', formatBytes(snapshot.maxSnapshotBytes)),
        ))
        if (rows.length === 0) {
          children.push(createElement('p', { className: 'dcr-empty', key: 'empty' }, t('empty')))
        } else {
          children.push(createElement('div', { className: 'dcr-list', key: 'list' }, rows.map(function (row) {
            var role = row.id === selectedA ? 'a' : row.id === selectedB ? 'b' : null
            return createElement('div', {
              key: row.id,
              className: 'dcr-row',
              'data-selected': role === null ? undefined : role,
            },
              createElement('div', { className: 'dcr-row-main' },
                createElement('span', { className: 'dcr-id' }, '#' + row.id.slice(0, 8)),
                createElement('span', { className: 'dcr-badge' }, t(kindKey(row.kind))),
                createElement('span', null, row.provider),
                createElement('span', null, 'turn ' + row.turn + ' step ' + row.step),
                createElement('span', null, formatTime(row.time)),
                createElement('span', null, row.files + ' file' + (row.files === 1 ? '' : 's')),
                createElement('span', null, formatBytes(row.bytes)),
                createElement('span', { className: 'dcr-badge' }, row.tree === null ? t('treeNone') : 'tree ' + row.tree.slice(0, 8)),
                createElement('span', { className: 'dcr-badge' }, row.sessionBoundary === null ? t('replayFresh') : t('replayReady')),
                row.note !== null ? createElement('span', { className: 'dcr-note' }, row.note) : null,
              ),
              createElement('button', {
                type: 'button',
                className: 'dcr-select',
                'data-role': 'a',
                onClick: function () { toggleSelect(row.id, 'a') },
              }, t('selectA')),
              createElement('button', {
                type: 'button',
                className: 'dcr-select',
                'data-role': 'b',
                onClick: function () { toggleSelect(row.id, 'b') },
              }, t('selectB')),
              selectiveRestore ? createElement('button', {
                type: 'button',
                className: 'dcr-select',
                'data-role': 'restore',
                onClick: function () { toggleRestoreTarget(row.id) },
              }, t('restoreSelect')) : null,
            )
          })))

          if (selectedA === null || selectedB === null) {
            children.push(createElement('p', { className: 'dcr-hint', key: 'compare-hint' }, t('compareHint')))
          } else {
            var diffChildren = []
            if (diffView.status === 'loading') {
              diffChildren.push(createElement('p', { className: 'dcr-meta', key: 'diff-loading' }, t('comparing')))
            } else if (diffView.status === 'error') {
              diffChildren.push(createElement('p', { className: 'dcr-error', key: 'diff-error' }, t('compareError') + ': ' + diffView.message))
            } else {
              var result = diffView.result
              if (result.error !== null) {
                diffChildren.push(createElement('p', { className: 'dcr-error', key: 'diff-error' }, result.error))
              } else {
                var render = resolveDiffRenderer(snapshot ? snapshot.diffRenderer : undefined)
                diffChildren.push.apply(diffChildren, render(result, t))
              }
            }
            children.push(createElement('div', { className: 'dcr-diff', key: 'diff' },
              createElement('div', { className: 'dcr-diff-head' },
                createElement('span', { className: 'dcr-id' }, '#' + selectedA.slice(0, 8) + ' → #' + selectedB.slice(0, 8)),
                createElement('button', {
                  type: 'button', className: 'dcr-button',
                  onClick: function () { setSelectedA(null); setSelectedB(null); setDiffView({ status: 'idle' }) },
                }, t('clearCompare')),
              ),
              diffChildren,
              createElement('div', { className: 'dcr-hint' },
                createElement('div', null, t('rewindHint')),
                createElement('button', { type: 'button', className: 'dcr-button', onClick: copyRewind }, copied ? t('copied') : t('copy')),
              ),
            ))
          }

          if (selectiveRestore && restoreTarget !== null) {
            children.push(createElement(RestorePanel, {
              key: 'restore-panel',
              id: restoreTarget,
              t,
              restorePreview,
            }))
          }
        }
      }

      return createElement('div', { className: 'dcr-root', 'data-dsh-checkpoint-rewind': '' }, children)
    }

    /** 解包 RemoteResult：ok → value；否则抛错（面板展示 loadError）。 */
    function unwrap(result) {
      if (result !== null && typeof result === 'object' && result.ok === true) return result.value
      var message = result && result.error ? result.error.code + ': ' + result.error.message : 'remote call failed'
      throw new Error(message)
    }

    var name = 'dsh-checkpoint-rewind'
    var inject = ['slots', 'locale', 'remote']

    async function apply(ctx) {
      ctx.effect(function () { return ctx.locale.register(NS, locales) }, 'dsh-checkpoint-rewind: dictionaries')
      ctx.effect(function () { installStyles() }, 'dsh-checkpoint-rewind: stylesheet')
      await ctx.remote.$mount({ package: 'dsh-checkpoint-rewind', descriptors: PANEL_INVOCATIONS })
      ctx.inject(['remote.checkpointPanel'], function (scope) {
        var t = scope.locale.bind(NS)
        var timeline = function (args) { return Promise.resolve(scope.remote.checkpointPanel.timeline(args && args.limit)).then(unwrap) }
        var diff = function (from, to) { return Promise.resolve(scope.remote.checkpointPanel.diff(from, to)).then(unwrap) }
        var restorePreview = function (id) { return Promise.resolve(scope.remote.checkpointPanel.restorePreview(id)).then(unwrap) }
        scope.slots.inject('settings.plugins.tab', function () {
          return scope.slots.register({
            name: 'settings.plugins.tab',
            id: 'checkpoints',
            order: 20,
            label: function () { return t('tab') },
            locale: NS,
            inject: function () { return { timeline, diff, restorePreview } },
          }, CheckpointTab)
        })
      })
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    exports.NS = NS
    return module.exports
  },
})
