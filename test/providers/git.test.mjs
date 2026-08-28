// test/providers/git.test.mjs — git provider：scripted runner 覆盖命令序列与
// 安全白名单；真实 git 块检测环境能力（git 可执行且可 spawn）后运行。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { assertSafe, assertSafeRef, GIT_SPAWN_ENV, makeGitProvider } from '../../lib/providers/git.mjs'

const workspace = { cwd: '/repo', key: '/repo' }

/** 40 位 hex 假 sha：restore 的 ref 与 snapshot 的 previousRef 经格式校验。 */
const SHA = '0123456789abcdef0123456789abcdef01234567'
const SHA2 = 'fedcba9876543210fedcba9876543210fedcba98'

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
      'rev-parse --verify HEAD': { code: 0, stdout: 'deadbeef\n', stderr: '' },
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

  it('available：unborn HEAD（无初始提交）→ ok=false + 原因（快照原语依赖 HEAD）', async () => {
    const { run } = scriptedGit({
      'rev-parse --is-inside-work-tree': { code: 0, stdout: 'true\n', stderr: '' },
      'rev-parse --verify HEAD': { code: 128, stdout: '', stderr: 'fatal: Needed a single revision\n' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const probe = await provider.available(workspace)
    assert.equal(probe.ok, false)
    assert.match(probe.reason, /unborn HEAD/)
  })

  it('available：探测结果按工作区键缓存（第二次调用不再 spawn）', async () => {
    const { run, calls } = scriptedGit({
      'rev-parse --is-inside-work-tree': { code: 0, stdout: 'false\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const first = await provider.available(workspace)
    const second = await provider.available(workspace)
    assert.equal(first.ok, false)
    assert.equal(second.ok, false)
    assert.equal(calls.length, 1, '负结果同样缓存')
  })

  it('snapshot：脏工作树走 stash create，返回 sha/tree/文件数/字节数', async () => {
    const { run, calls } = scriptedGit({
      'stash create': { code: 0, stdout: 'abc123\n', stderr: '' },
      'rev-parse abc123^': { code: 0, stdout: 'parent123\n', stderr: '' },
      'diff-tree --name-only -r parent123 abc123': { code: 0, stdout: 'a.txt\nb.txt\n', stderr: '' },
      'ls-tree -r -l abc123': { code: 0, stdout: '100644 blob x 100\ta.txt\n100644 blob y 24\tb.txt\n', stderr: '' },
      'rev-parse abc123^{tree}': { code: 0, stdout: 'beefface00000000000000000000000000000000\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.snapshot(workspace, { triggerTool: 'bash' })
    assert.deepEqual(result, { ref: 'abc123', tree: 'beefface00000000000000000000000000000000', files: 2, bytes: 124, notes: [] })
    assert.deepEqual(calls[0], ['stash', 'create'])
  })

  it('snapshot：干净工作树（stash create 空）退化为带父指针的 commit-tree', async () => {
    const { run, calls } = scriptedGit({
      'stash create': { code: 0, stdout: '', stderr: '' },
      'rev-parse HEAD': { code: 0, stdout: 'deadbeef\n', stderr: '' },
      'commit-tree deadbeef^{tree} -p deadbeef -m dsh-checkpoint-rewind snapshot': { code: 0, stdout: 'feedface\n', stderr: '' },
      'rev-parse feedface^': { code: 0, stdout: 'deadbeef\n', stderr: '' },
      'diff-tree --name-only -r deadbeef feedface': { code: 0, stdout: 'a.txt\n', stderr: '' },
      'ls-tree -r -l feedface': { code: 0, stdout: '100644 blob x 10\ta.txt\n', stderr: '' },
      'rev-parse feedface^{tree}': { code: 0, stdout: 'c0ffee0000000000000000000000000000000000\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.snapshot(workspace, { triggerTool: 'write' })
    assert.equal(result?.ref, 'feedface')
    assert.equal(result?.tree, 'c0ffee0000000000000000000000000000000000')
    assert.deepEqual(calls.map((args) => args.join(' '))[1], 'rev-parse HEAD')
    assert.deepEqual(calls.map((args) => args.join(' '))[2], 'commit-tree deadbeef^{tree} -p deadbeef -m dsh-checkpoint-rewind snapshot')
  })

  it('snapshot：干净树（变更集为空）→ bytes 0（增量记账）', async () => {
    const { run } = scriptedGit({
      'stash create': { code: 0, stdout: '', stderr: '' },
      'rev-parse HEAD': { code: 0, stdout: 'deadbeef\n', stderr: '' },
      'commit-tree deadbeef^{tree} -p deadbeef -m dsh-checkpoint-rewind snapshot': { code: 0, stdout: 'feedface\n', stderr: '' },
      'rev-parse feedface^': { code: 0, stdout: 'deadbeef\n', stderr: '' },
      'diff-tree --name-only -r deadbeef feedface': { code: 0, stdout: '', stderr: '' },
      'rev-parse feedface^{tree}': { code: 0, stdout: 'c0ffee0000000000000000000000000000000000\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.snapshot(workspace, { triggerTool: 'write' })
    assert.deepEqual(result, { ref: 'feedface', tree: 'c0ffee0000000000000000000000000000000000', files: 0, bytes: 0, notes: [] })
  })

  it('snapshot：bytes 只计变更文件（ls-tree 全树行按 diff-tree 变更集过滤）', async () => {
    const { run } = scriptedGit({
      'stash create': { code: 0, stdout: 'abc123\n', stderr: '' },
      'rev-parse abc123^': { code: 0, stdout: 'parent123\n', stderr: '' },
      'diff-tree --name-only -r parent123 abc123': { code: 0, stdout: 'b.txt\n', stderr: '' },
      'ls-tree -r -l abc123': { code: 0, stdout: '100644 blob x 100\ta.txt\n100644 blob y 24\tb.txt\n', stderr: '' },
      'rev-parse abc123^{tree}': { code: 0, stdout: 'beefface00000000000000000000000000000000\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.snapshot(workspace, { triggerTool: 'bash' })
    assert.equal(result.bytes, 24, '未变更的 a.txt 不计入增量')
  })

  it('snapshot：与 previousRef 树一致 → null（内容去重）', async () => {
    const { run } = scriptedGit({
      'stash create': { code: 0, stdout: 'abc123\n', stderr: '' },
      [`diff --quiet ${SHA} abc123 --`]: { code: 0, stdout: '', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.snapshot(workspace, { triggerTool: 'bash', previousRef: SHA })
    assert.equal(result, null)
  })

  it('snapshot：与 previousRef 不一致 → 继续返回结果', async () => {
    const { run } = scriptedGit({
      'stash create': { code: 0, stdout: 'abc123\n', stderr: '' },
      [`diff --quiet ${SHA} abc123 --`]: { code: 1, stdout: '', stderr: '' },
      'rev-parse abc123^': { code: 0, stdout: 'parent123\n', stderr: '' },
      'diff-tree --name-only -r parent123 abc123': { code: 0, stdout: 'a.txt\n', stderr: '' },
      'ls-tree -r -l abc123': { code: 0, stdout: '100644 blob x 10\ta.txt\n', stderr: '' },
      'rev-parse abc123^{tree}': { code: 0, stdout: 'beefface00000000000000000000000000000000\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.snapshot(workspace, { triggerTool: 'bash', previousRef: SHA })
    assert.equal(result?.ref, 'abc123')
  })

  it('snapshot：previousRef 非 sha 形态（注入 git 选项）→ 拒绝且不 spawn 任何命令', async () => {
    const { run, calls } = scriptedGit({})
    const provider = makeGitProvider({ gitBin: 'git', run })
    await assert.rejects(
      () => provider.snapshot(workspace, { triggerTool: 'bash', previousRef: '--output=evil' }),
      /not a valid git object id/,
    )
    assert.equal(calls.length, 0, '格式校验先于任何 git 命令')
  })

  it('restore：显式路径恢复 + 遗留报告（未跟踪 ∪ 已暂存新文件，绝不删除）', async () => {
    const { run, calls } = scriptedGit({
      [`cat-file -e ${SHA}`]: { code: 0, stdout: '', stderr: '' },
      [`ls-tree -r --name-only ${SHA}`]: { code: 0, stdout: 'a.txt\nb.txt\n', stderr: '' },
      [`diff --name-only ${SHA} --`]: { code: 0, stdout: 'a.txt\nstaged.txt\n', stderr: '' },
      [`restore --source=${SHA} --worktree -- a.txt b.txt`]: { code: 0, stdout: '', stderr: '' },
      'ls-files --others --exclude-standard': { code: 0, stdout: 'new.txt\n', stderr: '' },
      [`diff --name-only --diff-filter=A ${SHA} --`]: { code: 0, stdout: 'staged.txt\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.restore(workspace, SHA)
    assert.equal(result.restored, 1, '只计 ref 中存在且工作树不同的文件（staged.txt 不在 ref）')
    assert.deepEqual(result.leftovers, ['new.txt', 'staged.txt'])
    assert.match(result.notes[0], /left in place/)
    assert.deepEqual(calls[3], ['restore', `--source=${SHA}`, '--worktree', '--', 'a.txt', 'b.txt'])
  })

  it('restore：显式路径按批分块（超过批量上限拆多次 restore）', async () => {
    const count = 201
    const names = Array.from({ length: count }, (_, index) => `f${index}.txt`)
    const script = {
      [`cat-file -e ${SHA}`]: { code: 0, stdout: '', stderr: '' },
      [`ls-tree -r --name-only ${SHA}`]: { code: 0, stdout: `${names.join('\n')}\n`, stderr: '' },
      [`diff --name-only ${SHA} --`]: { code: 0, stdout: 'f0.txt\n', stderr: '' },
      'ls-files --others --exclude-standard': { code: 0, stdout: '', stderr: '' },
      [`diff --name-only --diff-filter=A ${SHA} --`]: { code: 0, stdout: '', stderr: '' },
    }
    script[`restore --source=${SHA} --worktree -- ${names.slice(0, 200).join(' ')}`] = { code: 0, stdout: '', stderr: '' }
    script[`restore --source=${SHA} --worktree -- ${names.slice(200).join(' ')}`] = { code: 0, stdout: '', stderr: '' }
    const { run } = scriptedGit(script)
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.restore(workspace, SHA)
    assert.equal(result.restored, 1)
    assert.deepEqual(result.leftovers, [])
  })

  it('restore：files 选择性恢复只恢复指定路径；未知路径失败关闭', async () => {
    const { run, calls } = scriptedGit({
      [`cat-file -e ${SHA}`]: { code: 0, stdout: '', stderr: '' },
      [`ls-tree -r --name-only ${SHA}`]: { code: 0, stdout: 'a.txt\nb.txt\n', stderr: '' },
      [`diff --name-only ${SHA} --`]: { code: 0, stdout: 'a.txt\n', stderr: '' },
      [`restore --source=${SHA} --worktree -- a.txt`]: { code: 0, stdout: '', stderr: '' },
      'ls-files --others --exclude-standard': { code: 0, stdout: '', stderr: '' },
      [`diff --name-only --diff-filter=A ${SHA} --`]: { code: 0, stdout: '', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.restore(workspace, SHA, undefined, ['a.txt'])
    assert.equal(result.restored, 1)
    assert.deepEqual(calls[3], ['restore', `--source=${SHA}`, '--worktree', '--', 'a.txt'], '只恢复勾选路径')
    await assert.rejects(
      () => provider.restore(workspace, SHA, undefined, ['nope.txt']),
      /unknown file\(s\) not present in the checkpoint tree: nope\.txt/,
    )
  })

  it('restore：git 报错 → providerFailed（响亮失败）', async () => {
    const { run } = scriptedGit({
      [`cat-file -e ${SHA}`]: { code: 0, stdout: '', stderr: '' },
      [`ls-tree -r --name-only ${SHA}`]: { code: 0, stdout: 'a.txt\n', stderr: '' },
      [`diff --name-only ${SHA} --`]: { code: 0, stdout: 'a.txt\n', stderr: '' },
      [`restore --source=${SHA} --worktree -- a.txt`]: { code: 128, stdout: '', stderr: 'bad object\n' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    await assert.rejects(() => provider.restore(workspace, SHA), /restore failed: bad object/)
  })

  it('restore：快照对象被 gc/prune 删除（cat-file 失败）→ 响亮失败（关闭静默 restored:0 盲区）', async () => {
    const { run } = scriptedGit({
      [`cat-file -e ${SHA}`]: { code: 1, stdout: '', stderr: 'fatal: Not a valid object name\n' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    await assert.rejects(
      () => provider.restore(workspace, SHA),
      /restore failed: checkpoint commit object .* is missing or garbage-collected/,
    )
  })

  it('restore：ref 非 sha 形态（注入 git 选项）→ 拒绝且不 spawn 任何命令', async () => {
    const { run, calls } = scriptedGit({})
    const provider = makeGitProvider({ gitBin: 'git', run })
    await assert.rejects(
      () => provider.restore(workspace, '--output=evil'),
      /not a valid git object id/,
    )
    assert.equal(calls.length, 0)
  })

  it('preview：只读预览命令序列（ls-tree/diff/ls-files/diff-filter，绝不 spawn restore）', async () => {
    const { run, calls } = scriptedGit({
      [`ls-tree -r --name-only ${SHA}`]: { code: 0, stdout: 'a.txt\nb.txt\n', stderr: '' },
      [`diff --name-only ${SHA} --`]: { code: 0, stdout: 'a.txt\nstaged.txt\n', stderr: '' },
      'ls-files --others --exclude-standard': { code: 0, stdout: 'new.txt\n', stderr: '' },
      [`diff --name-only --diff-filter=A ${SHA} --`]: { code: 0, stdout: 'staged.txt\n', stderr: '' },
      [`ls-tree -r -l ${SHA}`]: { code: 0, stdout: '100644 blob x 1234\ta.txt\n100644 blob y 5678\tb.txt\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.preview(workspace, SHA)
    assert.deepEqual(result, {
      restore: 1, unchanged: 1, leftovers: ['new.txt', 'staged.txt'], changes: ['a.txt'],
      entries: [{ path: 'a.txt', bytes: 1234 }],
    })
    assert.equal(calls.some((args) => args[0] === 'restore'), false, 'preview 不执行 restore')
  })

  it('子进程环境：终端提示与可选锁关闭（防凭据提示挂起快照链）', () => {
    assert.equal(GIT_SPAWN_ENV.GIT_TERMINAL_PROMPT, '0')
    assert.equal(GIT_SPAWN_ENV.GIT_OPTIONAL_LOCKS, '0')
  })

  it('ref 格式校验：40/64 位 hex 通过，其余拒绝', () => {
    assert.doesNotThrow(() => assertSafeRef(SHA))
    assert.doesNotThrow(() => assertSafeRef('f'.repeat(64)))
    for (const bad of ['abc123', '--output=x', 'x'.repeat(39), 'g'.repeat(40), 'x'.repeat(65), '../sha']) {
      assert.throws(() => assertSafeRef(bad), /not a valid git object id/)
    }
  })

  it('discard：git 侧 no-op（对象留给 gc）', async () => {
    const { run, calls } = scriptedGit({})
    const provider = makeGitProvider({ gitBin: 'git', run })
    await provider.discard(workspace, 'abc123')
    assert.equal(calls.length, 0)
  })

  it('安全白名单：clean/危险 stash 子命令（除 create）/restore 不带 --worktree/非法 reset 一律拒绝', () => {
    const banned = [
      ['reset', '--soft', 'HEAD~1'],
      ['reset', 'HEAD~1'],
      ['reset', '--hard', 'a', 'extra'],
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
      assert.throws(() => assertSafe(args), /refuses to run forbidden git verb|only runs "git stash create"|only runs worktree-only|only runs "git reset --hard <snapshot-ref>"/)
    }
  })

  it('安全白名单：允许的原语通过（快照/恢复/对比/reset-hard 只依赖这些）', () => {
    const allowed = [
      ['rev-parse', '--is-inside-work-tree'],
      ['rev-parse', '--verify', 'HEAD'],
      ['rev-parse', 'abc123^'],
      ['rev-parse', 'abc123^{tree}'],
      ['status', '--porcelain'],
      ['stash', 'create'],
      ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'msg'],
      ['diff', '--quiet', 'a', 'b', '--'],
      ['diff', '--name-only', 'a', '--'],
      ['diff', '--name-only', '--diff-filter=A', 'a', '--'],
      ['diff-tree', '--name-only', '-r', 'abc123'],
      ['diff-tree', '--name-only', '-r', 'parent123', 'abc123'],
      ['diff-tree', '--name-status', '-r', SHA, 'abc123'],
      ['ls-tree', '-r', '-l', 'abc123'],
      ['ls-tree', '-r', '--name-only', 'abc123'],
      ['ls-files', '--others', '--exclude-standard'],
      ['restore', '--source=abc123', '--worktree', '--', 'a.txt'],
      ['reset', '--hard', SHA],
    ]
    for (const args of allowed) {
      assert.doesNotThrow(() => assertSafe(args))
    }
  })

  it('resetHard：git reset --hard <快照提交> 并报告遗留（未跟踪文件保留）', async () => {
    const { run, calls } = scriptedGit({
      [`diff --name-only ${SHA} --`]: { code: 0, stdout: 'a.txt\nb.txt\n', stderr: '' },
      [`reset --hard ${SHA}`]: { code: 0, stdout: '', stderr: '' },
      'ls-files --others --exclude-standard': { code: 0, stdout: 'new.txt\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.resetHard(workspace, SHA)
    assert.equal(result.restored, 2)
    assert.deepEqual(result.leftovers, ['new.txt'])
    assert.match(result.notes[0], /branch head moved/)
    assert.deepEqual(calls[1], ['reset', '--hard', SHA])
  })

  it('resetHard：git 报错 → providerFailed；ref 非 sha → 拒绝', async () => {
    const { run } = scriptedGit({
      [`diff --name-only ${SHA} --`]: { code: 0, stdout: 'a.txt\n', stderr: '' },
      [`reset --hard ${SHA}`]: { code: 128, stdout: '', stderr: 'bad object\n' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    await assert.rejects(() => provider.resetHard(workspace, SHA), /reset failed: bad object/)
    await assert.rejects(() => provider.resetHard(workspace, '--output=evil'), /not a valid git object id/)
  })

  it('diffFiles：两个快照提交之间的 --name-status 变更集（纯读取）', async () => {
    const { run, calls } = scriptedGit({
      [`diff-tree --name-status -r ${SHA} ${SHA2}`]: { code: 0, stdout: 'M\ta.txt\nA\tnew.txt\nD\tgone.txt\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.diffFiles(workspace, SHA, SHA2)
    assert.deepEqual(result, {
      changed: 3, added: 1, removed: 1, names: ['a.txt', 'gone.txt', 'new.txt'],
      entries: [
        { path: 'a.txt', status: 'changed' },
        { path: 'gone.txt', status: 'removed' },
        { path: 'new.txt', status: 'added' },
      ],
    })
    assert.equal(calls.some((args) => args[0] === 'restore' || args[0] === 'reset'), false, 'diffFiles 绝不写工作区')
  })

  it('untrackedFiles：ls-files --others --exclude-standard 只读清单', async () => {
    const { run, calls } = scriptedGit({
      'ls-files --others --exclude-standard': { code: 0, stdout: 'new.txt\nsub/dir.txt\n', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.untrackedFiles(workspace)
    assert.deepEqual(result, ['new.txt', 'sub/dir.txt'])
    assert.deepEqual(calls, [['ls-files', '--others', '--exclude-standard']])
  })

  it('untrackedFiles：空输出返回空清单（无未跟踪文件）', async () => {
    const { run, calls } = scriptedGit({
      'ls-files --others --exclude-standard': { code: 0, stdout: '', stderr: '' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    const result = await provider.untrackedFiles(workspace)
    assert.deepEqual(result, [])
    assert.deepEqual(calls, [['ls-files', '--others', '--exclude-standard']])
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
    // 字节级断言：关闭换行转换，避免 Windows autocrlf 干扰内容比较。
    await runReal(['config', 'core.autocrlf', 'false'])
    await runReal(['add', '-A'])
    await runReal(['commit', '-q', '-m', 'initial'])
    const headBefore = (await runReal(['rev-parse', 'HEAD'])).stdout.trim()
    const statusBefore = (await runReal(['status', '--porcelain'])).stdout

    await fs.writeFile(path.join(repo, 'a.txt'), 'v2\n')
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    assert.ok(snapshot, 'snapshot should exist')
    assert.ok(snapshot.bytes > 0)
    assert.equal(snapshot.files, 1)
    assert.match(snapshot.tree, /^[0-9a-f]{40,64}$/, '三态模型：快照携带 tree SHA')
    assert.equal((await runReal(['rev-parse', `${snapshot.ref}^{tree}`])).stdout.trim(), snapshot.tree, 'tree 与快照提交一致')

    await fs.writeFile(path.join(repo, 'a.txt'), 'v3\n')
    await fs.writeFile(path.join(repo, 'new.txt'), 'untracked\n')
    // 检查点之后 git add 的新文件：restore 必须保留（显式路径恢复，绝不删除）并报告。
    await fs.writeFile(path.join(repo, 'staged.txt'), 'staged\n')
    await runReal(['add', 'staged.txt'])
    const restore = await provider.restore(ws, snapshot.ref)
    // 快照时只有 a.txt(v2)：恢复覆盖 a.txt；new.txt/staged.txt 是快照后的新文件 → 遗留报告。
    assert.equal(restore.restored, 1)
    assert.equal(await fs.readFile(path.join(repo, 'a.txt'), 'utf8'), 'v2\n')
    assert.deepEqual(restore.leftovers, ['new.txt', 'staged.txt'])
    assert.equal(await fs.readFile(path.join(repo, 'staged.txt'), 'utf8'), 'staged\n', '已暂存新文件绝不删除')
    assert.equal(await fs.readFile(path.join(repo, 'new.txt'), 'utf8'), 'untracked\n', '未跟踪新文件绝不删除')
    // 历史与索引未被改写：HEAD 不变，工作树状态与快照一致。
    const headAfter = (await runReal(['rev-parse', 'HEAD'])).stdout.trim()
    assert.equal(headAfter, headBefore)
    const statusAfter = (await runReal(['status', '--porcelain'])).stdout
    assert.ok(statusAfter.includes('a.txt'), 'restored dirty state still shows as modified vs HEAD')
    assert.ok(statusBefore === '', 'initial repo was clean')
    await fs.rm(repo, { recursive: true, force: true })
  })

  it('真实仓库：resetHard 把分支头移到快照提交（工作树/索引一致化，未跟踪保留）', async (t) => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-reset-'))
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
    await runReal(['config', 'user.email', 'test@example.com'])
    await runReal(['config', 'user.name', 'tester'])
    await runReal(['config', 'core.autocrlf', 'false'])
    await fs.writeFile(path.join(repo, 'a.txt'), 'v1\n')
    await runReal(['add', '-A'])
    await runReal(['commit', '-q', '-m', 'initial'])
    const provider = makeGitProvider({ gitBin: 'git', run: runReal })
    const ws = { cwd: repo, key: repo }
    const snapshot = await provider.snapshot(ws, { triggerTool: 'bash' })
    // 快照后：改文件 + 提交 + 新建未跟踪文件。
    await fs.writeFile(path.join(repo, 'a.txt'), 'v2\n')
    await runReal(['commit', '-q', '-am', 'after'])
    await fs.writeFile(path.join(repo, 'untracked.txt'), 'keep me\n')
    const result = await provider.resetHard(ws, snapshot.ref)
    assert.equal(result.restored, 1)
    assert.equal(await fs.readFile(path.join(repo, 'a.txt'), 'utf8'), 'v1\n', '工作树回到快照树')
    assert.equal((await runReal(['rev-parse', 'HEAD'])).stdout.trim(), snapshot.ref, '分支头移到快照提交')
    assert.equal(await fs.readFile(path.join(repo, 'untracked.txt'), 'utf8'), 'keep me\n', '未跟踪文件不受触碰')
    await fs.rm(repo, { recursive: true, force: true })
  })

  it('真实仓库：diffFiles 对比两个快照的变更集', async (t) => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-diff-'))
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
    await runReal(['config', 'user.email', 'test@example.com'])
    await runReal(['config', 'user.name', 'tester'])
    await runReal(['config', 'core.autocrlf', 'false'])
    await fs.writeFile(path.join(repo, 'a.txt'), 'v1\n')
    await runReal(['add', '-A'])
    await runReal(['commit', '-q', '-m', 'initial'])
    const provider = makeGitProvider({ gitBin: 'git', run: runReal })
    const ws = { cwd: repo, key: repo }
    const first = await provider.snapshot(ws, { triggerTool: 'bash' })
    await fs.writeFile(path.join(repo, 'a.txt'), 'v2\n')
    await fs.writeFile(path.join(repo, 'b.txt'), 'new\n')
    await runReal(['add', 'b.txt']) // stash create 只捕获已跟踪文件：新文件先入索引
    const second = await provider.snapshot(ws, { triggerTool: 'bash' })
    const diff = await provider.diffFiles(ws, first.ref, second.ref)
    assert.deepEqual(diff.names, ['a.txt', 'b.txt'])
    assert.equal(diff.added, 1)
    assert.equal(diff.removed, 0)
    await fs.rm(repo, { recursive: true, force: true })
  })

  it('verifyObjectExists：对象存在返回 true，对象缺失返回 false', async () => {
    const { run } = scriptedGit({
      [`cat-file -e ${SHA}`]: { code: 0, stdout: '', stderr: '' },
      'cat-file -e 1111111111111111111111111111111111111111': { code: 1, stdout: '', stderr: 'fatal: Not a valid object name\n' },
    })
    const provider = makeGitProvider({ gitBin: 'git', run })
    assert.equal(await provider.verifyObjectExists(workspace, SHA), true)
    assert.equal(await provider.verifyObjectExists(workspace, '1111111111111111111111111111111111111111'), false)
  })
})
