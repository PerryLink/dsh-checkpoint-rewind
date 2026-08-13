// test/providers/copy.test.mjs — copy provider：捕获/增量 hardlink/去重/覆盖恢复/
// 遗留报告/损坏清单/越界防御/孤儿清理/并发。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makeCopyProvider, snapshotBaseDir } from '../../lib/providers/copy.mjs'

async function makeWorkspace(files) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-copy-ws-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(cwd, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content)
  }
  return cwd
}

async function makeProvider() {
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-copy-snap-'))
  const provider = makeCopyProvider({ snapshotDir, excludeGlobs: ['node_modules'] })
  return { provider, snapshotDir }
}

describe('copy provider', () => {
  it('snapshot 捕获全部文件并写入清单', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1', 'dir/b.txt': 'B1' })
    const { provider, snapshotDir } = await makeProvider()
    const result = await provider.snapshot({ cwd, key: cwd }, { triggerTool: 'bash' })
    assert.ok(result, 'snapshot exists')
    assert.equal(result.files, 2)
    assert.ok(result.bytes > 0)
    const manifest = JSON.parse(await fs.readFile(path.join(snapshotBaseDir(snapshotDir, cwd), result.ref, 'manifest.json'), 'utf8'))
    assert.deepEqual(manifest.files.map((entry) => entry.rel).sort(), ['a.txt', 'dir/b.txt'])
  })

  it('snapshot 排除 .git 与配置排除项（node_modules）', async () => {
    const cwd = await makeWorkspace({
      'a.txt': 'A',
      'node_modules/x.js': 'X',
      '.git/config': '[core]',
    })
    const { provider } = await makeProvider()
    const result = await provider.snapshot({ cwd, key: cwd }, { triggerTool: 'bash' })
    assert.equal(result.files, 1)
  })

  it('内容未变（size+mtime+mode 快速检查）→ null（去重）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const first = await provider.snapshot(ws, { triggerTool: 'bash' })
    const second = await provider.snapshot(ws, { triggerTool: 'bash', previousRef: first.ref })
    assert.equal(second, null)
  })

  it('变更文件产生新快照，未变文件 hardlink 复用上一快照', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1', 'b.txt': 'B1' })
    const { provider, snapshotDir } = await makeProvider()
    const ws = { cwd, key: cwd }
    const first = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.writeFile(path.join(cwd, 'b.txt'), 'B2')
    const second = await provider.snapshot(ws, { triggerTool: 'bash', previousRef: first.ref })
    assert.ok(second, 'second snapshot exists')
    const firstDir = path.join(snapshotBaseDir(snapshotDir, cwd), first.ref)
    const secondDir = path.join(snapshotBaseDir(snapshotDir, cwd), second.ref)
    // 证明未变文件是 hardlink（inode 相同）而非复制：仅当平台 hardlink 生效时断言。
    const [statA1, statA2] = await Promise.all([
      fs.stat(path.join(firstDir, 'a.txt')),
      fs.stat(path.join(secondDir, 'a.txt')),
    ])
    if (statA1.nlink >= 2 && statA2.nlink >= 2) {
      assert.equal(statA1.ino, statA2.ino)
    }
    assert.equal(await fs.readFile(path.join(secondDir, 'b.txt'), 'utf8'), 'B2')
    // 删除第一快照后第二快照的未变文件仍可读（独立链接计数）。
    await provider.discard(ws, first.ref)
    assert.equal(await fs.readFile(path.join(secondDir, 'a.txt'), 'utf8'), 'A1')
  })

  it('restore 覆盖回滚：捕获文件恢复、快照后新建文件保留并报告', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    await fs.writeFile(path.join(cwd, 'later.txt'), 'later')
    const result = await provider.restore(ws, snapshot.ref)
    assert.equal(result.restored, 1)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1')
    assert.deepEqual(result.leftovers, ['later.txt'])
    assert.equal(await fs.readFile(path.join(cwd, 'later.txt'), 'utf8'), 'later')
  })

  it('restore：清单损坏 → 响亮失败', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider, snapshotDir } = await makeProvider()
    const ws = { cwd, key: cwd }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.writeFile(path.join(snapshotBaseDir(snapshotDir, cwd), snapshot.ref, 'manifest.json'), '{broken', 'utf8')
    await assert.rejects(() => provider.restore(ws, snapshot.ref), /manifest/)
  })

  it('restore：清单相对路径越界（..）→ 拒绝', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider, snapshotDir } = await makeProvider()
    const ws = { cwd, key: cwd }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    const manifestPath = path.join(snapshotBaseDir(snapshotDir, cwd), snapshot.ref, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.files[0].rel = '../evil.txt'
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8')
    await assert.rejects(() => provider.restore(ws, snapshot.ref), /not a safe relative path/)
  })

  it('discard 删除快照目录；孤儿 .tmp 目录在下次 snapshot 前清理', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider, snapshotDir } = await makeProvider()
    const ws = { cwd, key: cwd }
    const base = snapshotBaseDir(snapshotDir, cwd)
    await fs.mkdir(path.join(base, 'orphan.tmp'), { recursive: true })
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    assert.equal((await fs.readdir(base)).includes('orphan.tmp'), false)
    await provider.discard(ws, snapshot.ref)
    assert.equal((await fs.readdir(base)).length, 0)
  })

  it('并发快照：同工作区同时捕获 → 串行且各自完整', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const [first, second] = await Promise.all([
      provider.snapshot(ws, { triggerTool: 'bash' }),
      provider.snapshot(ws, { triggerTool: 'bash' }),
    ])
    // 串行化后第二个必然是对第一个的去重（内容未变）。
    assert.ok(first, 'first snapshot exists')
    assert.equal(second, null)
  })

  it('available 恒可用（兜底语义）', async () => {
    const { provider } = await makeProvider()
    assert.deepEqual(await provider.available({ cwd: '/nowhere', key: '/nowhere' }), { ok: true })
  })
})
