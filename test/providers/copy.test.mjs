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

async function makeProvider(opts = {}) {
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-copy-snap-'))
  const provider = makeCopyProvider({ snapshotDir, excludeGlobs: ['node_modules'], verifyByHash: opts.verifyByHash === true })
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
    await fs.writeFile(path.join(cwd, 'b.txt'), 'B2!') // 尺寸变化：去重判据不依赖 mtime 精度
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
    assert.equal(await fs.readFile(path.join(secondDir, 'b.txt'), 'utf8'), 'B2!')
    // 删除第一快照后第二快照的未变文件仍可读（独立链接计数）。
    await provider.discard(ws, first.ref)
    assert.equal(await fs.readFile(path.join(secondDir, 'a.txt'), 'utf8'), 'A1')
  })

  it('bytes 是增量记账：hardlink 复用文件不计入（仅实拷贝字节）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1', 'b.txt': 'B1' })
    const { provider, snapshotDir } = await makeProvider()
    const ws = { cwd, key: cwd }
    const first = await provider.snapshot(ws, { triggerTool: 'bash' })
    assert.equal(first.bytes, 4, '首次捕获全量实拷贝（A1 + B1）')
    await fs.writeFile(path.join(cwd, 'b.txt'), 'B2!')
    const second = await provider.snapshot(ws, { triggerTool: 'bash', previousRef: first.ref })
    assert.ok(second, 'second snapshot exists')
    const [statA1, statA2] = await Promise.all([
      fs.stat(path.join(snapshotBaseDir(snapshotDir, cwd), first.ref, 'a.txt')),
      fs.stat(path.join(snapshotBaseDir(snapshotDir, cwd), second.ref, 'a.txt')),
    ])
    if (statA1.nlink >= 2 && statA2.nlink >= 2) {
      assert.equal(second.bytes, 3, 'hardlink 复用的 a.txt 不计增量，只计变更的 b.txt')
    } else {
      assert.ok(second.bytes <= 5, '无 hardlink 平台退化为实拷贝（全量）')
    }
  })

  it('verifyByHash：同内容不同 mtime 仍按哈希去重', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider } = await makeProvider({ verifyByHash: true })
    const ws = { cwd, key: cwd }
    const first = await provider.snapshot(ws, { triggerTool: 'bash' })
    // 重写同内容（mtime 变化、size 相同）：哈希比对 → 去重 null。
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A1')
    const second = await provider.snapshot(ws, { triggerTool: 'bash', previousRef: first.ref })
    assert.equal(second, null)
  })

  it('verifyByHash：mtime 被精确保留的同尺寸内容变更被检出（快检盲区覆盖）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'AAAA' })
    const { provider } = await makeProvider({ verifyByHash: true })
    const ws = { cwd, key: cwd }
    const file = path.join(cwd, 'a.txt')
    // 把 mtime 预截断到整数毫秒：后续可精确还原（utimes 整数 ms 往返无损）。
    const before = await fs.stat(file)
    const exactMs = Math.trunc(before.mtimeMs)
    await fs.utimes(file, before.atime, new Date(exactMs))
    const first = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.writeFile(file, 'BBBB')
    await fs.utimes(file, before.atime, new Date(exactMs)) // 快检字段全等
    const second = await provider.snapshot(ws, { triggerTool: 'bash', previousRef: first.ref })
    assert.ok(second, '哈希比对检出内容变更（快检会漏）')
    const restore = await provider.restore(ws, second.ref)
    assert.equal(restore.restored, 1)
    assert.equal(await fs.readFile(file, 'utf8'), 'BBBB')
  })

  it('默认快检模式的文档化边界：mtime 精确还原的同尺寸变更被漏检（去重为 null）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'AAAA' })
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const file = path.join(cwd, 'a.txt')
    const before = await fs.stat(file)
    const exactMs = Math.trunc(before.mtimeMs)
    await fs.utimes(file, before.atime, new Date(exactMs))
    const first = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.writeFile(file, 'BBBB')
    await fs.utimes(file, before.atime, new Date(exactMs))
    const second = await provider.snapshot(ws, { triggerTool: 'bash', previousRef: first.ref })
    assert.equal(second, null, 'size+mtime+mode 快检视为未变（rsync -t / touch -r 可达的已知盲区）')
  })

  it('restore：verifyByHash 清单内容被篡改 → 哈希不匹配响亮失败', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider, snapshotDir } = await makeProvider({ verifyByHash: true })
    const ws = { cwd, key: cwd }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.writeFile(path.join(snapshotBaseDir(snapshotDir, cwd), snapshot.ref, 'a.txt'), 'CORRUPT')
    await assert.rejects(() => provider.restore(ws, snapshot.ref), /content hash mismatch/)
  })

  it('restore 尽力恢复文件 mode（非 Windows 平台）', { skip: process.platform === 'win32' }, async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const file = path.join(cwd, 'a.txt')
    await fs.chmod(file, 0o700)
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.chmod(file, 0o644)
    await provider.restore(ws, snapshot.ref)
    assert.equal((await fs.stat(file)).mode & 0o777, 0o700)
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
    // previousRef 由消费方（插件）在捕获前查表注入；并发裸调无 ref 可传，
    // 这里验证 provider 自身的串行化与各自完整性（去重语义见 previousRef 测试）。
    const [first, second] = await Promise.all([
      provider.snapshot(ws, { triggerTool: 'bash' }),
      provider.snapshot(ws, { triggerTool: 'bash' }),
    ])
    assert.ok(first, 'first snapshot exists')
    assert.ok(second, 'second snapshot exists')
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    const r1 = await provider.restore(ws, first.ref)
    const r2 = await provider.restore(ws, second.ref)
    assert.equal(r1.restored, 1)
    assert.equal(r2.restored, 1)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1')
  })

  it('available 恒可用（兜底语义）', async () => {
    const { provider } = await makeProvider()
    assert.deepEqual(await provider.available({ cwd: '/nowhere', key: '/nowhere' }), { ok: true })
  })
})
