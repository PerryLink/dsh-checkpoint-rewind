// test/glob.test.mjs — lib/glob.mjs 匹配语义：段名/跨段/相对路径/大小写。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeGlobMatcher } from '../lib/glob.mjs'

describe('makeGlobMatcher（copy provider 排除 glob）', () => {
  it('无斜杠模式：任意深度段名匹配（与旧"精确段名"排除兼容）', () => {
    const excluded = makeGlobMatcher(['node_modules', 'dist'])
    assert.equal(excluded('node_modules'), true)
    assert.equal(excluded('a/node_modules'), true)
    assert.equal(excluded('a/b/node_modules'), true)
    assert.equal(excluded('a/node_modules/x.js'), true)
    assert.equal(excluded('dist'), true)
    assert.equal(excluded('a/dist'), true)
    assert.equal(excluded('distribute'), false, '精确段名而非前缀匹配')
    assert.equal(excluded('a.txt'), false)
  })

  it('* 与 ?：单段内通配，不跨 '/'', () => {
    const excluded = makeGlobMatcher(['*.log'])
    assert.equal(excluded('a.log'), true)
    assert.equal(excluded('dir/a.log'), true)
    assert.equal(excluded('dir/sub/b.log'), true)
    assert.equal(excluded('a.log.txt'), false)
    const question = makeGlobMatcher(['file?.tmp'])
    assert.equal(question('file1.tmp'), true)
    assert.equal(question('file12.tmp'), false)
    assert.equal(question('dir/file1.tmp'), true)
  })

  it('含斜杠模式：按相对工作区路径匹配', () => {
    const excluded = makeGlobMatcher(['dist/*'])
    assert.equal(excluded('dist'), false, 'dist 目录本身不被 dist/* 排除（进入后子项被排除）')
    assert.equal(excluded('dist/a.js'), true)
    assert.equal(excluded('dist/sub/a.js'), true, '子目录命中 dist/* ⇒ 其内容也被排除（gitignore 语义）')
    const nested = makeGlobMatcher(['a/b/c'])
    assert.equal(nested('a/b/c'), true)
    assert.equal(nested('a/b'), false)
    assert.equal(nested('a/b/c/d'), true, '目录命中即整个子树排除')
  })

  it('** 跨任意段（含 0 段）', () => {
    const excluded = makeGlobMatcher(['**/*.tmp'])
    assert.equal(excluded('a.tmp'), true)
    assert.equal(excluded('x/a.tmp'), true)
    assert.equal(excluded('x/y/z/a.tmp'), true)
    assert.equal(excluded('x/a.txt'), false)
    const mid = makeGlobMatcher(['src/**/gen'])
    assert.equal(mid('src/gen'), true)
    assert.equal(mid('src/a/gen'), true)
    assert.equal(mid('src/a/b/gen'), true)
    assert.equal(mid('other/gen'), false)
  })

  it('反斜杠归一与空模式容错', () => {
    const excluded = makeGlobMatcher(['dir\\*.log'])
    assert.equal(excluded('dir/a.log'), true)
    assert.equal(excluded('other/a.log'), false)
    const empty = makeGlobMatcher([])
    assert.equal(empty('anything/at/all'), false)
    const junk = makeGlobMatcher(['', '/', '///'])
    assert.equal(junk('a.txt'), false)
  })

  it('Windows 大小写不敏感（其余平台敏感）', () => {
    const excluded = makeGlobMatcher(['Build'])
    if (process.platform === 'win32') {
      assert.equal(excluded('a/build'), true)
      assert.equal(excluded('a/BUILD'), true)
    } else {
      assert.equal(excluded('a/build'), false)
      assert.equal(excluded('a/Build'), true)
    }
  })

  it('无斜杠模式等价于任意深度前缀（**/段名）', () => {
    const byName = makeGlobMatcher(['.dsh'])
    const byGlob = makeGlobMatcher(['**/.dsh'])
    for (const rel of ['.dsh', 'a/.dsh', 'a/b/.dsh', '.dsh/x']) {
      assert.equal(byName(rel), byGlob(rel), rel)
    }
  })

  it('连续 ** 压缩：语义不变、无冗余回溯分支', () => {
    const collapsed = makeGlobMatcher(['a/**/**/b', '**/**'])
    const plain = makeGlobMatcher(['a/**/b', '**'])
    for (const rel of ['a/b', 'a/x/b', 'a/x/y/b', 'other', 'c/d/e']) {
      assert.equal(collapsed(rel), plain(rel), rel)
    }
  })
})
