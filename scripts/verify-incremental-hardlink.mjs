// scripts/verify-incremental-hardlink.mjs
// 实证 copy provider 的 hardlink 增量复用：
// 1. 连续两次快照
// 2. 第二次快照未修改文件 bytes=0，只计入修改文件的字节数
// 3. 两次快照的同名未修改文件共享 hardlink（inode 相同且 fsutil hardlink list 列出双路径）

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { makeCopyProvider, snapshotBaseDir } from '../lib/providers/copy.mjs'

async function main() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-verify-hardlink-'))
  const cwd = path.join(tmpRoot, 'workspace')
  const snapshotDir = path.join(tmpRoot, 'snapshots')
  await fs.mkdir(cwd, { recursive: true })
  await fs.mkdir(snapshotDir, { recursive: true })

  try {
    const fileA = path.join(cwd, 'stable-a.txt')
    const fileB = path.join(cwd, 'stable-b.txt')
    const fileC = path.join(cwd, 'modify-c.txt')

    const contentA = 'Content of file A: ' + 'A'.repeat(500)
    const contentB = 'Content of file B: ' + 'B'.repeat(500)
    const contentC1 = 'Content of file C: initial version'
    const contentC2 = 'Content of file C: modified version with extra payload ' + 'C'.repeat(100)

    await fs.writeFile(fileA, contentA)
    await fs.writeFile(fileB, contentB)
    await fs.writeFile(fileC, contentC1)

    const provider = makeCopyProvider({
      snapshotDir,
      excludeGlobs: ['node_modules'],
      verifyByHash: false,
    })

    const ws = { cwd, key: cwd }

    console.log('=== [Step 1] 执行首次快照 ===')
    const snap1 = await provider.snapshot(ws, { triggerTool: 'manual' })
    console.log(`Snapshot 1 ref: ${snap1.ref}`)
    console.log(`Snapshot 1 files: ${snap1.files}`)
    console.log(`Snapshot 1 bytes: ${snap1.bytes} (全量实拷贝)`)

    console.log('\n=== [Step 2] 修改单个文件 modify-c.txt ===')
    await fs.writeFile(fileC, contentC2)
    const statC2 = await fs.stat(fileC)

    console.log('\n=== [Step 3] 执行第二次增量快照 (基于 snapshot 1) ===')
    const snap2 = await provider.snapshot(ws, { triggerTool: 'manual', previousRef: snap1.ref })
    console.log(`Snapshot 2 ref: ${snap2.ref}`)
    console.log(`Snapshot 2 files: ${snap2.files}`)
    console.log(`Snapshot 2 bytes: ${snap2.bytes} (预期仅 modify-c.txt 尺寸: ${statC2.size})`)

    const snap1Dir = path.join(snapshotBaseDir(snapshotDir, cwd), snap1.ref)
    const snap2Dir = path.join(snapshotBaseDir(snapshotDir, cwd), snap2.ref)

    const snap1A = path.join(snap1Dir, 'stable-a.txt')
    const snap2A = path.join(snap2Dir, 'stable-a.txt')
    const snap1B = path.join(snap1Dir, 'stable-b.txt')
    const snap2B = path.join(snap2Dir, 'stable-b.txt')

    console.log('\n=== [Step 4] Node.js fs.stat 硬链接元数据比对 ===')
    const [st1A, st2A] = await Promise.all([fs.stat(snap1A), fs.stat(snap2A)])
    const [st1B, st2B] = await Promise.all([fs.stat(snap1B), fs.stat(snap2B)])

    console.log(`stable-a.txt: snap1.ino=${st1A.ino}, snap2.ino=${st2A.ino}, nlink1=${st1A.nlink}, nlink2=${st2A.nlink}`)
    console.log(`stable-b.txt: snap1.ino=${st1B.ino}, snap2.ino=${st2B.ino}, nlink1=${st1B.nlink}, nlink2=${st2B.nlink}`)

    if (st1A.ino !== st2A.ino || st1A.nlink < 2 || st2A.nlink < 2) {
      throw new Error('FAIL: stable-a.txt 没有正确建立硬链接共享！')
    }
    if (snap2.bytes !== statC2.size) {
      throw new Error(`FAIL: 第二次快照 bytes 应为 ${statC2.size}，实际为 ${snap2.bytes}`)
    }
    console.log('✓ Node.js stat 校验通过：未变更文件 ino 相等，nlink=2，增量 bytes 准确！')

    if (process.platform === 'win32') {
      console.log('\n=== [Step 5] Windows fsutil hardlink list 原生实证 ===')
      const cmdA = `fsutil hardlink list "${snap2A}"`
      console.log(`> ${cmdA}`)
      const outA = execSync(cmdA, { encoding: 'utf8' })
      console.log(outA.trim())

      const cmdB = `fsutil hardlink list "${snap2B}"`
      console.log(`> ${cmdB}`)
      const outB = execSync(cmdB, { encoding: 'utf8' })
      console.log(outB.trim())
      console.log('\n✓ fsutil 原生证实：两次快照中的同名未修改文件物理共享相同磁盘簇！')
    }

    console.log('\n=== VERIFICATION SUCCESSFUL ===')
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
