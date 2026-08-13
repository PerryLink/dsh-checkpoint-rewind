// test/providers/git.test.mjs — git provider：scripted runner 覆盖命令序列与
// 安全白名单；真实 git 块检测环境能力（git 可执行且可 spawn）后运行。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { assertSafe, makeGitProvider } from '../../lib/providers/git.mjs'

const workspace = { cwd: '/repo', key: '/repo' }

/**
 * scripted git：按 (args) → 响应 的脚本表回放，记录全部调用。
 * @param {object} script - { 'verb sub...': {code, stdout, stderr} | '...' }。
 */
function scriptedGit(script) {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    const key = args.join(' ')
    const entry = script[key] ?? script[args[0]]
    if (entry === undefined) throw new Error(`unscripted git ${key}`)
    if (entry instanceof Error) throw entry
    return entry
  }
  return { run, calls }
}

describe('git provider（scripted runner）', () => {
  it('available：工作树检查通过 → ok', async () => {
    const { run } = scriptedGit({
      'rev-parse --is-inside-work-tree': { code: 0, stdout: 'true\n', stderr: '' },
      'status --porcelain': { code: 0, stdout: '', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const probe = await provider.available(workspace)
    assert.equal(probe.ok, true)
  })

  it('available：非 git 目录 → ok=false + 原因', async () => {
    const { run } = scriptedGit({
      'rev-parse --is-inside-work-tree': { code: 0, stdout: 'false\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const probe = await provider.available(workspace)
    assert.equal(probe.ok, false)
    assert.match(probe.reason, /not inside a git working tree/)
  })

  it('snapshot：脏工作树走 stash create，返回 sha/文件数/字节数', async () => {
    const { run, calls } = scriptedGit({
      'stash create': { code: 0, stdout: 'abc123\n', stderr: '' },
      'diff-tree --name-only -r abc123': { code: 0, stdout: 'a.txt\nb.txt\n', stderr: '' },
      'ls-tree -r -l abc123': { code: 0, stdout: '100644 blob x 100\ta.txt\n100644 blob y 24\tb.txt\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.snapshot(workspace, { triggerTool: 'bash' })
    assert.deepEqual(result, { ref: 'abc123', files: 2, bytes: 124, notes: [] })
    assert.deepEqual(calls[0], ['stash', 'create'])
  })

  it('snapshot：干净工作树（stash create 空）退化为 commit-tree HEAD^{tree}', async () => {
    const { run, calls } = scriptedGit({
      'stash create': { code: 0, stdout: '', stderr: '' },
      'rev-parse HEAD': { code: 0, stdout: 'deadbeef\n', stderr: '' },
      'commit-tree deadbeef^{tree} -m dsh-checkpoint-rewind snapshot': { code: 0, stdout: 'feedface\n', stderr: '' },
      'diff-tree --name-only -r feedface': { code: 0, stdout: 'a.txt\n', stderr: '' },
      'ls-tree -r -l feedface': { code: 0, stdout: '100644 blob x 10\ta.txt\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.snapshot(workspace, { triggerTool: 'write' })
    assert.equal(result?.ref, 'feedface')
    assert.deepEqual(calls.map((args) => args.join(' '))[1], 'rev-parse HEAD')
  })

  it('snapshot：与 previousRef 树一致 → null（内容去重）', async () => {
    const { run } = scriptedGit({
      'stash create': { code: 0, stdout: 'abc123\n', stderr: '' },
      'diff --quiet prev123 abc123 --': { code: 0, stdout: '', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.snapshot(workspace, { triggerTool: 'bash', previousRef: 'prev123' })
    assert.equal(result, null)
  })

  it('snapshot：与 previousRef 不一致 → 继续返回结果', async () => {
    const { run } = scriptedGit({
      'stash create': { code: 0, stdout: 'abc123\n', stderr: '' },
      'diff --quiet prev123 abc123 --': { code: 1, stdout: '', stderr: '' },
      'diff-tree --name-only -r abc123': { code: 0, stdout: 'a.txt\n', stderr: '' },
      'ls-tree -r -l abc123': { code: 0, stdout: '100644 blob x 10\ta.txt\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.snapshot(workspace, { triggerTool: 'bash', previousRef: 'prev123' })
    assert.equal(result?.ref, 'abc123')
  })

  it('restore：worktree-only restore + 未跟踪遗留报告', async () => {
    const { run, calls } = scriptedGit({
      'restore --source=abc123 --worktree -- .': { code: 0, stdout: '', stderr: '' },
      'ls-tree -r --name-only abc123': { code: 0, stdout: 'a.txt\nb.txt\n', stderr: '' },
      'ls-files --others --exclude-standard': { code: 0, stdout: 'new.txt\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.restore(workspace, 'abc123')
    assert.equal(result.restored, 2)
    assert.deepEqual(result.leftovers, ['new.txt'])
    assert.match(result.notes[0], /untracked file\(s\)/)
    assert.deepEqual(calls[0], ['restore', '--source=abc123', '--worktree', '--', '.'])
  })

  it('restore：git 报错 → providerFailed（响亮失败）', async () => {
    const { run } = scriptedGit({
      'restore --source=abc123 --worktree -- .': { code: 128, stdout: '', stderr: 'bad object\n' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    await assert.rejects(() => provider.restore(workspace, 'abc123'), /restore failed: bad object/)
  })

  it('discard：git 侧 no-op（对象留给 gc）', async () => {
    const { run, calls } = scriptedGit({})
    const provider = makeGitProvider({ gitBin: 'git', run })
    await provider.discard(workspace, 'abc123')
    assert.equal(calls.length, 0)
  })

  it('安全白名单：reset/clean/stash 子命令（除 create）/restore 不带 --worktree 一律拒绝', () => {
    const banned = [
      ['reset', '--hard'],
      ['reset', 'HEAD~1'],
      ['clean', '-fd'],
      ['clean', '-xdf'],
      ['stash', 'apply'],
      ['stash', 'pop'],
      ['stash', 'drop'],
      ['restore', '--source=x', '.'],
      ['checkout', '--', '.'],
      ['rm', '-rf', '.'],
    ]
    for (const args of banned) {
      assert.throws(() => assertSafe(args), /refuses to run forbidden git verb|only runs "git stash create"|only runs worktree-only/)
    }
  })

  it('安全白名单：允许的原语通过（快照/恢复只依赖这些）', () => {
    const allowed = [
      ['rev-parse', '--is-inside-work-tree'],
      ['status', '--porcelain'],
      ['stash', 'create'],
      ['commit-tree', 'HEAD^{tree}', '-m', 'msg'],
      ['diff', '--quiet', 'a', 'b', '--'],
      ['diff-tree', '--name-only', '-r', 'abc123'],
      ['ls-tree', '-r', '-l', 'abc123'],
      ['ls-files', '--others', '--exclude-standard'],
      ['restore', '--source=abc123', '--worktree', '--', '.'],
    ]
    for (const args of allowed) {
      assert.doesNotThrow(() => assertSafe(args))
    }
  })
})

describe('git provider（真实 git，能力检测）', () => {
  it('真实仓库：快照 → 修改 → 恢复 → 内容还原；索引与历史不动', async (t) => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-git-'))
    const runReal = async (args) => {
      const result = await new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (c) => { stdout += String(c) })
        child.stderr.on('data', (c) => { stderr += String(c) })
        child.on('error', reject)
        child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
      })
      return result
    }
    const init = await runReal(['init', '-q']).catch((error) => {
      t.skip(`git init unavailable (${error.message})`)
      return undefined
    })
    if (init === undefined) return
    const provider = makeGitProvider({ gitBin: 'git', run: runReal })
    const ws = { cwd: repo, key: repo }
    await fs.writeFile(path.join(repo, 'a.txt'), 'v1\n')
    await runReal(['config', 'user.email', 'test@example.com'])
    await runReal(['config', 'user.name', 'tester'])
    await runReal(['add', '-A'])
    await runReal(['commit', '-q', '-m', 'initial'])
    const headBefore = (await runReal(['rev-parse', 'HEAD'])).stdout.trim()
    const statusBefore = (await runReal(['status', '--porcelain'])).stdout

    await fs.writeFile(path.join(repo, 'a.txt'), 'v2\n')
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    assert.ok(snapshot, 'snapshot should exist')
    assert.ok(snapshot.bytes > 0)
    assert.equal(snapshot.files, 1)

    await fs.writeFile(path.join(repo, 'a.txt'), 'v3\n')
    await fs.writeFile(path.join(repo, 'new.txt'), 'untracked\n')
    const restore = await provider.restore(ws, snapshot.ref)
    // 快照时只有 a.txt(v2)：恢复覆盖 a.txt，new.txt 是快照后的未跟踪文件 → 遗留报告。
    assert.equal(restore.restored, 1)
    assert.equal(await fs.readFile(path.join(repo, 'a.txt'), 'utf8'), 'v2\n')
    assert.deepEqual(restore.leftovers, ['new.txt'])
    // 历史与索引未被改写：HEAD 不变，工作树状态与快照一致。
    const headAfter = (await runReal(['rev-parse', 'HEAD'])).stdout.trim()
    assert.equal(headAfter, headBefore)
    const statusAfter = (await runReal(['status', '--porcelain'])).stdout
    assert.ok(statusAfter.includes('a.txt'), 'restored dirty state still shows as modified vs HEAD')
    assert.ok(statusBefore === '', 'initial repo was clean')
    await fs.rm(repo, { recursive: true, force: true })
  })
})
