// test/render.test.mjs — diff 渲染器 seam（「diff 数据 → 渲染输入」纯函数）。
// 覆盖两个内建渲染器（pairwise / side-by-side）、解析器失败关闭回落、与
// 逐文件字节汇总（大小统计）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DIFF_RENDERER,
  DIFF_RENDERERS,
  configTextRows,
  renderPairwiseDiff,
  renderSideBySideDiff,
  resolveDiffRenderer,
  sideBySideConfigRows,
  sideBySideFileRows,
  sumEntryBytes,
} from '../lib/render.mjs'

const diffData = {
  from: 'aaaa1111',
  to: 'bbbb2222',
  error: null,
  files: {
    changed: 3, added: 1, removed: 1,
    names: ['a.txt', 'gone.txt', 'new.txt'],
    truncated: false,
    entries: [
      { path: 'a.txt', status: 'changed' },
      { path: 'gone.txt', status: 'removed' },
      { path: 'new.txt', status: 'added' },
    ],
  },
  configDiff: {
    changed: true, lines: 2,
    text: '--- a\n+++ b\n-old\n+new\n ctx',
  },
  session: { fromSeq: 10, toSeq: 20, dropped: 10 },
}

describe('configTextRows（pairwise 行级着色）', () => {
  it('前缀着色 + 空文本兜底', () => {
    assert.deepEqual(configTextRows('+add\n-del\n@@ -1 +1 @@\nctx'), [
      { cls: 'add', text: 'add' },
      { cls: 'del', text: 'del' },
      { cls: 'hunk', text: '@@ -1 +1 @@' },
      { cls: 'ctx', text: 'ctx' },
    ])
    assert.deepEqual(configTextRows(undefined), [{ cls: 'ctx', text: '' }])
  })
})

describe('sideBySideConfigRows（增删行左/右配对）', () => {
  it('连续一删一增配对到同一行；孤删/孤增占单侧', () => {
    assert.deepEqual(sideBySideConfigRows('-old\n+new'), [
      { left: 'old', right: 'new' },
    ])
    assert.deepEqual(sideBySideConfigRows('-only'), [
      { left: 'only', right: null },
    ])
    assert.deepEqual(sideBySideConfigRows('+only'), [
      { left: null, right: 'only' },
    ])
  })

  it('上下文/头行两侧同值', () => {
    const rows = sideBySideConfigRows('ctx\n-old\n+new')
    assert.deepEqual(rows[0], { left: 'ctx', right: 'ctx' })
  })
})

describe('sideBySideFileRows（per-file 两列）', () => {
  it('added → 仅右侧；removed → 仅左侧；changed → 两侧', () => {
    assert.deepEqual(sideBySideFileRows(diffData.files.entries), [
      { path: 'a.txt', status: 'changed', left: true, right: true },
      { path: 'gone.txt', status: 'removed', left: true, right: false },
      { path: 'new.txt', status: 'added', left: false, right: true },
    ])
    assert.deepEqual(sideBySideFileRows(undefined), [])
  })
})

describe('渲染器 seam（diff 数据 → 渲染输入）', () => {
  it('默认渲染器为 pairwise（向后兼容）', () => {
    assert.equal(DEFAULT_DIFF_RENDERER, 'pairwise')
  })

  it('pairwise 渲染输入：文件清单 + 配置行级 + 会话', () => {
    const out = renderPairwiseDiff(diffData)
    assert.equal(out.kind, 'pairwise')
    assert.equal(out.files.names.length, 3)
    assert.equal(out.config.some((row) => row.cls === 'add' && row.text === 'new'), true)
    assert.equal(out.session.dropped, 10)
  })

  it('side-by-side 渲染输入：per-file 两列 + 配置左/右配对', () => {
    const out = renderSideBySideDiff(diffData)
    assert.equal(out.kind, 'side-by-side')
    assert.equal(out.files.length, 3)
    assert.equal(out.files[0].path, 'a.txt')
    assert.ok(out.config.some((row) => row.left === 'old' && row.right === 'new'))
  })

  it('缺失字段兜底：空 diff 数据不抛错', () => {
    assert.equal(renderPairwiseDiff(undefined).kind, 'pairwise')
    assert.equal(renderSideBySideDiff(undefined).kind, 'side-by-side')
  })
})

describe('resolveDiffRenderer（未知 id 失败关闭回落 pairwise）', () => {
  it('注册表含两个内建渲染器；未知 id 回落 pairwise', () => {
    assert.equal(resolveDiffRenderer('side-by-side'), DIFF_RENDERERS['side-by-side'])
    assert.equal(resolveDiffRenderer('nope'), DIFF_RENDERERS.pairwise)
    assert.equal(resolveDiffRenderer(undefined), DIFF_RENDERERS.pairwise)
  })
})

describe('sumEntryBytes（逐文件勾选大小统计）', () => {
  it('汇总字节；缺失/非法条目记 0', () => {
    assert.equal(sumEntryBytes([{ path: 'a', bytes: 10 }, { path: 'b', bytes: 20 }]), 30)
    assert.equal(sumEntryBytes([{ path: 'a' }, { path: 'b', bytes: 5 }]), 5)
    assert.equal(sumEntryBytes(undefined), 0)
  })
})
