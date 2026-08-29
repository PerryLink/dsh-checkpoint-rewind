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
  const provider = makeCopyProvider({
    snapshotDir,
    excludeGlobs: opts.excludeGlobs ?? ['node_modules'],
    verifyByHash: opts.verifyByHash === true,
  })
  return { provider, snapshotDir }
}

/** symlink 能力检测（Windows 无开发者模式/特权时 EPERM，跳过并说明原因）。 */
async function requireSymlink(t) {
  const probeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-linkprobe-'))
  const probeTarget = path.join(probeDir, 'target.txt')
  const probeLink = path.join(probeDir, 'link.txt')
  await fs.writeFile(probeTarget, 'x')
  try {
    await fs.symlink(probeTarget, probeLink)
    return true
  } catch (error) {
    t.skip(`symlink creation unavailable on this platform/user (${error.code ?? error.message})`)
    return false
  } finally {
    await fs.rm(probeDir, { recursive: true, force: true })
  }
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

  it('restore：files 选择性恢复只恢复指定文件；未知路径失败关闭', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1', 'b.txt': 'B1' })
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2')
    await fs.writeFile(path.join(cwd, 'b.txt'), 'B2')
    const result = await provider.restore(ws, snapshot.ref, undefined, ['a.txt'])
    assert.equal(result.restored, 1, '只恢复勾选的 a.txt')
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1', '勾选文件已恢复')
    assert.equal(await fs.readFile(path.join(cwd, 'b.txt'), 'utf8'), 'B2', '未勾选文件保持不变')
    await assert.rejects(
      () => provider.restore(ws, snapshot.ref, undefined, ['nope.txt']),
      /unknown file\(s\) not present in the checkpoint manifest: nope\.txt/,
    )
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

  it('restore/discard：ref 路径遍历（..）→ 响亮拒绝', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    await assert.rejects(() => provider.restore(ws, '../evil'), /not a safe snapshot id/)
    await assert.rejects(() => provider.restore(ws, 'a/b'), /not a safe snapshot id/)
    await assert.rejects(() => provider.discard(ws, '../..'), /not a safe snapshot id/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1', '工作区未被触碰')
  })

  it('restore：目标文件被换成符号链接 → 拒绝，外部文件不被改写', async (t) => {
    if (!(await requireSymlink(t))) return
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-outside-'))
    const target = path.join(outside, 'victim.txt')
    await fs.writeFile(target, 'outside-content')
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.rm(path.join(cwd, 'a.txt'))
    await fs.symlink(target, path.join(cwd, 'a.txt'))
    await assert.rejects(() => provider.restore(ws, snapshot.ref), /symbolic links are refused/)
    assert.equal(await fs.readFile(target, 'utf8'), 'outside-content', '工作区外文件未被改写')
  })

  it('restore：中间目录被换成符号链接 → 拒绝', async (t) => {
    if (!(await requireSymlink(t))) return
    const cwd = await makeWorkspace({ 'dir/a.txt': 'A1' })
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-outside-'))
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.rm(path.join(cwd, 'dir'), { recursive: true, force: true })
    await fs.symlink(outside, path.join(cwd, 'dir'))
    await assert.rejects(() => provider.restore(ws, snapshot.ref), /symbolic links are refused/)
    assert.deepEqual(await fs.readdir(outside), [], '外部目录未被写入')
  })

  it('restore：快照存储内文件被换成符号链接 → 拒绝（不读外部文件）', async (t) => {
    if (!(await requireSymlink(t))) return
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-outside-'))
    const secret = path.join(outside, 'secret.txt')
    await fs.writeFile(secret, 'secret')
    const { provider, snapshotDir } = await makeProvider()
    const ws = { cwd, key: cwd }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    const snapFile = path.join(snapshotBaseDir(snapshotDir, cwd), snapshot.ref, 'a.txt')
    await fs.rm(snapFile)
    await fs.symlink(secret, snapFile)
    await assert.rejects(() => provider.restore(ws, snapshot.ref), /snapshot storage contains a symbolic link/)
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A1', '外部内容未进入工作区')
  })

  it('restore：目标路径祖先目录不存在（快照后删除）→ 重建并恢复', async () => {
    const cwd = await makeWorkspace({ 'dir/a.txt': 'A1' })
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.rm(path.join(cwd, 'dir'), { recursive: true, force: true })
    const result = await provider.restore(ws, snapshot.ref)
    assert.equal(result.restored, 1)
    assert.equal(await fs.readFile(path.join(cwd, 'dir/a.txt'), 'utf8'), 'A1', '目录被重建')
  })

  it('snapshot：物化失败的文件跳过并警告，快照仍成功（能力检测）', async (t) => {
    if (process.platform === 'win32') {
      t.skip('Windows 不执行 chmod 000 语义')
      return
    }
    const cwd = await makeWorkspace({ 'a.txt': 'A1', 'locked.txt': 'L1' })
    const locked = path.join(cwd, 'locked.txt')
    await fs.chmod(locked, 0o000)
    try {
      await fs.readFile(locked)
      t.skip('以 root 运行：chmod 000 不阻止读取（物化会成功）')
      return
    } catch {
      // 有防护：copyFile 将失败，验证跳过路径。
    }
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const result = await provider.snapshot(ws, { triggerTool: 'bash' })
    assert.ok(result, '快照仍成功')
    assert.equal(result.files, 1, 'locked.txt 被跳过（不进清单）')
    assert.ok(result.notes.some(note => note.includes('locked.txt')), '警告包含被跳过文件')
    const restore = await provider.restore(ws, result.ref)
    assert.equal(restore.restored, 1, '恢复只涉及清单内文件')
  })

  it('excludeGlobs glob 语义：**/*.tmp 排除任意深度临时文件', async () => {
    const cwd = await makeWorkspace({
      'a.txt': 'A',
      'x/a.tmp': 'T',
      'x/y/b.tmp': 'T',
      'x/keep.log': 'L',
    })
    const { provider } = await makeProvider({ excludeGlobs: ['**/*.tmp'] })
    const result = await provider.snapshot({ cwd, key: cwd }, { triggerTool: 'bash' })
    assert.deepEqual(result.files, 2, '仅 a.txt 与 keep.log')
  })

  it('preview：报告将覆盖/未变/遗留（不写任何文件）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1', 'b.txt': 'B1' })
    const { provider } = await makeProvider()
    const ws = { cwd, key: cwd }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    // 尺寸变化：快检去重不依赖 mtime 精度，消除并行负载下的偶发误判。
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A2!!')
    await fs.writeFile(path.join(cwd, 'new.txt'), 'new')
    const preview = await provider.preview(ws, snapshot.ref)
    assert.deepEqual(preview, {
      restore: 1, unchanged: 1, leftovers: ['new.txt'], changes: ['a.txt'],
      entries: [{ path: 'a.txt', bytes: 'A1'.length }],
    })
    assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'A2!!', 'preview 不写文件')
    assert.equal(await fs.readFile(path.join(cwd, 'new.txt'), 'utf8'), 'new')
  })

  it('preview：verifyByHash 按内容哈希判定（mtime 保留的同尺寸变更被检出）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'AAAA' })
    const { provider } = await makeProvider({ verifyByHash: true })
    const ws = { cwd, key: cwd }
    const file = path.join(cwd, 'a.txt')
    const before = await fs.stat(file)
    const exactMs = Math.trunc(before.mtimeMs)
    await fs.utimes(file, before.atime, new Date(exactMs))
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.writeFile(file, 'BBBB')
    await fs.utimes(file, before.atime, new Date(exactMs))
    const preview = await provider.preview(ws, snapshot.ref)
    assert.equal(preview.restore, 1, '哈希比对检出内容变更')
    assert.deepEqual(preview.changes, ['a.txt'])
  })

  it('preview：ref 非法 → 拒绝', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const { provider } = await makeProvider()
    await assert.rejects(() => provider.preview({ cwd, key: cwd }, '../evil'), /not a safe snapshot id/)
  })

  it('dynamic getter: excludeGlobs and snapshotDir update without provider reconstruction', async () => {
    const cwd = await makeWorkspace({ 'keep.txt': 'K', 'ignore1.log': 'L1', 'ignore2.tmp': 'T2' })
    let currentExclude = ['*.log']
    let currentSnapDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-snap-dyn1-'))
    const provider = makeCopyProvider({
      snapshotDir: () => currentSnapDir,
      excludeGlobs: () => currentExclude,
    })
    const ws = { cwd, key: cwd }

    // First snapshot with currentExclude = ['*.log']
    const snap1 = await provider.snapshot(ws, { triggerTool: 'bash' })
    const manifest1 = JSON.parse(await fs.readFile(path.join(snapshotBaseDir(currentSnapDir, cwd), snap1.ref, 'manifest.json'), 'utf8'))
    assert.deepEqual(manifest1.files.map((e) => e.rel).sort(), ['ignore2.tmp', 'keep.txt'])

    // Update exclude dynamically to ['*.tmp']
    currentExclude = ['*.tmp']
    const snap2 = await provider.snapshot(ws, { triggerTool: 'bash' })
    const manifest2 = JSON.parse(await fs.readFile(path.join(snapshotBaseDir(currentSnapDir, cwd), snap2.ref, 'manifest.json'), 'utf8'))
    assert.deepEqual(manifest2.files.map((e) => e.rel).sort(), ['ignore1.log', 'keep.txt'])

    // Update snapshotDir dynamically
    const nextSnapDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-snap-dyn2-'))
    currentSnapDir = nextSnapDir
    const snap3 = await provider.snapshot(ws, { triggerTool: 'bash' })
    const manifest3 = JSON.parse(await fs.readFile(path.join(snapshotBaseDir(nextSnapDir, cwd), snap3.ref, 'manifest.json'), 'utf8'))
    assert.ok(manifest3.id, 'snapshot written to dynamic snapshot directory')
  })
})
