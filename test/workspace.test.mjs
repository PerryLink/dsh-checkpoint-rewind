// test/workspace.test.mjs — 工作区键规范化与快照目录解析（含 issue #4 回归：
// $DSH_HOME 缺失时回退 ~/.dsh/dsh-checkpoint-rewind，绝不抛错）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { workspaceKeyOf, resolveSnapshotDir } from '../lib/workspace.mjs'

/** 临时移除 process.env.DSH_HOME 后执行 fn（模拟未导出的干净环境）。 */
function withUnsetDshHome(fn) {
  const saved = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    return fn()
  } finally {
    if (saved !== undefined) process.env.DSH_HOME = saved
  }
}

describe('workspaceKeyOf', () => {
  it('空/非法 cwd → 空键', () => {
    assert.equal(workspaceKeyOf(''), '')
    assert.equal(workspaceKeyOf(undefined), '')
    assert.equal(workspaceKeyOf(null), '')
  })

  it('绝对路径规范化为解析后的键（Windows 大小写不敏感）', () => {
    const resolved = path.resolve('/work/proj')
    const expected = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    assert.equal(workspaceKeyOf('/work/proj/../proj'), expected)
  })
})

describe('resolveSnapshotDir', () => {
  it('显式绝对路径：原样规范化（无需 DSH_HOME）', () => {
    const dir = path.resolve(os.tmpdir(), 'snaps-x')
    assert.equal(withUnsetDshHome(() => resolveSnapshotDir(dir)), path.normalize(dir))
  })

  it('显式相对路径 + 无 DSH_HOME：相对进程 cwd', () => {
    const dir = withUnsetDshHome(() => resolveSnapshotDir('snaps-rel'))
    assert.equal(dir, path.resolve(process.cwd(), 'snaps-rel'))
  })

  it('显式相对路径 + DSH_HOME：相对 DSH_HOME', () => {
    assert.equal(resolveSnapshotDir('snaps-rel', '/ds/home'), path.resolve('/ds/home', 'snaps-rel'))
  })

  it('默认值 + DSH_HOME：$DSH_HOME/dsh-checkpoint-rewind', () => {
    assert.equal(resolveSnapshotDir(undefined, '/ds/home'), path.join('/ds/home', 'dsh-checkpoint-rewind'))
  })

  it('issue #4 回归：默认值 + 无 DSH_HOME → ~/.dsh/dsh-checkpoint-rewind，不抛错', () => {
    const expected = path.join(os.homedir(), '.dsh', 'dsh-checkpoint-rewind')
    assert.equal(withUnsetDshHome(() => resolveSnapshotDir(undefined)), expected)
  })
})
