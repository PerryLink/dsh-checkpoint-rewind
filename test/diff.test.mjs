// test/diff.test.mjs — 配置快照对比纯函数：稳定序列化、行级 diff、unified 输出。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { configDiff, configLinesOf, diffLines, stableStringify, unifiedDiffLines } from '../lib/diff.mjs'

describe('stableStringify（键排序无关的稳定 JSON）', () => {
  it('键顺序不同 → 相同输出（对比基线）', () => {
    assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }))
  })

  it('嵌套对象与数组稳定', () => {
    assert.equal(stableStringify({ a: [1, { c: 3, b: 2 }] }), '{"a":[1,{"b":2,"c":3}]}')
  })

  it('null/标量直通', () => {
    assert.equal(stableStringify(null), 'null')
    assert.equal(stableStringify('x'), '"x"')
    assert.equal(stableStringify(42), '42')
  })
})

describe('configLinesOf', () => {
  it('配置快照 → 单行稳定文本；缺失/非法 → {}', () => {
    assert.deepEqual(configLinesOf({ b: 1, a: 'x' }), ['{"a":"x","b":1}'])
    assert.deepEqual(configLinesOf(undefined), ['{}'])
    assert.deepEqual(configLinesOf('nope'), ['{}'])
  })
})

describe('diffLines / unifiedDiffLines（LCS 行级差异）', () => {
  it('相同序列 → 全 keep，unified 输出为空', () => {
    const ops = diffLines(['a', 'b'], ['a', 'b'])
    assert.deepEqual(ops.map(op => op.op), ['keep', 'keep'])
    assert.equal(unifiedDiffLines(['a', 'b'], ['a', 'b']), '')
  })

  it('增删改混合 → 正确编辑脚本', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'x', 'c'])
    assert.deepEqual(ops.map(op => op.op), ['keep', 'del', 'add', 'keep'])
    assert.equal(ops[1].line, 'b')
    assert.equal(ops[2].line, 'x')
  })

  it('全删/全增边界', () => {
    assert.deepEqual(diffLines(['a'], []).map(op => op.op), ['del'])
    assert.deepEqual(diffLines([], ['a']).map(op => op.op), ['add'])
  })

  it('unified 输出：头部与 +/- 行（上下文行前缀空格）', () => {
    const text = unifiedDiffLines(['keep', 'old', 'keep'], ['keep', 'new', 'keep'], { fromLabel: 'a.json', toLabel: 'b.json' })
    assert.match(text, /^--- a\.json\n\+\+\+ b\.json/m)
    assert.match(text, / keep/)
    assert.match(text, /-old/)
    assert.match(text, /\+new/)
    assert.match(text, /@@ -2 \+2 @@/)
  })

  it('变更块间插入 3 行以内上下文（unified 惯例）', () => {
    const a = ['k1', 'k2', 'k3', 'x', 'k4', 'k5', 'k6', 'k7', 'k8']
    const b = ['k1', 'k2', 'k3', 'y', 'k4', 'k5', 'k6', 'k7', 'k8']
    const text = unifiedDiffLines(a, b)
    assert.match(text, /-x/)
    assert.match(text, /\+y/)
    const lines = text.split('\n').filter(line => line.startsWith(' '))
    assert.equal(lines.length, 6, '变更两侧各 3 行上下文')
  })
})

describe('configDiff（两段配置快照的行级 diff 摘要）', () => {
  it('差异配置 → changed + 行数 + 文本', () => {
    const from = { provider: 'copy', listLimit: 10, autoCheckpoint: { enabled: true } }
    const to = { provider: 'copy', listLimit: 20, autoCheckpoint: { enabled: false } }
    const diff = configDiff(from, to)
    assert.equal(diff.changed, true)
    assert.ok(diff.lines >= 2)
    assert.match(diff.text, /listLimit/)
    assert.match(diff.text, /enabled/)
  })

  it('一致配置 → unchanged（空文本）', () => {
    const diff = configDiff({ a: 1 }, { a: 1 })
    assert.deepEqual(diff, { changed: false, lines: 0, text: '' })
  })

  it('键顺序差异不构成配置差异', () => {
    const diff = configDiff({ a: 1, b: 2 }, { b: 2, a: 1 })
    assert.equal(diff.changed, false)
  })
})
