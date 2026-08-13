// lib/providers/git.mjs — git 快照 provider（零 DSH 依赖）。
//
// 无副作用原语快照：`git stash create`（脏状态 → 未引用的 stash 提交对象，
// 不动工作树/索引/历史）；工作树干净时退化为 `git commit-tree <HEAD>^{tree}`
// 生成同样未引用的提交对象。恢复用 `git restore --source=<ref> --worktree -- .`
// （仅工作树、不动索引）。绝不发出 reset/clean/stash-apply 一类命令
// （ALLOWED_VERBS 白名单 + restore 必须带 --worktree，双保险）。
//
// 只覆盖已跟踪文件：快照之后新建的未跟踪文件在恢复后保留并报告（与
// copy provider 的覆盖式回滚同一安全边界）。非 git 目录由消费方降级 copy。

import { spawn } from 'node:child_process'
import { withLock } from '../lock.mjs'
import { PROVIDERS } from '../constants.mjs'
import { providerFailed } from '../errors.mjs'

/** git provider 允许的顶层动词白名单（防破坏性命令，运行时断言）。 */
const ALLOWED_VERBS = new Set([
  'rev-parse',
  'status',
  'stash',
  'commit-tree',
  'diff',
  'diff-tree',
  'ls-tree',
  'ls-files',
  'restore',
])

/**
 * 默认 runner：真实 spawn git（生产路径）。测试注入 scripted runner。
 * @param {string} gitBin - Config.gitBin。
 * @returns {(args: string[], opts?: {cwd?: string}) => Promise<{code: number, stdout: string, stderr: string}>}
 */
export function spawnGitRunner(gitBin) {
  return (args, opts = {}) => new Promise((resolve, reject) => {
    const child = spawn(gitBin, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => reject(error))
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
  })
}

/** 断言一条命令是白名单内的无副作用原语（防未来改坏；测试直接引用）。 */
export function assertSafe(args) {
  const verb = args[0] ?? ''
  if (!ALLOWED_VERBS.has(verb)) {
    throw new Error(`git provider refuses to run forbidden git verb ${JSON.stringify(verb)}`)
  }
  if (verb === 'stash' && args[1] !== 'create') {
    throw new Error('git provider only runs "git stash create"')
  }
  if (verb === 'restore' && !args.includes('--worktree')) {
    throw new Error('git provider only runs worktree-only "git restore"')
  }
}

/**
 * git 快照 provider。
 */
export class GitSnapshotProvider {
  /** @type {(args: string[], opts?: {cwd?: string}) => Promise<{code: number, stdout: string, stderr: string}>} */
  #run
  /** @type {Map<string, Promise<unknown>>} 每工作区串行链。 */
  #chains = new Map()

  /**
   * @param {object} deps - {gitBin, run?}：run 供测试注入 scripted git。
   */
  constructor(deps) {
    this.#run = deps.run ?? spawnGitRunner(deps.gitBin)
  }

  get name() {
    return PROVIDERS.GIT
  }

  /**
   * 探测：合法 git 工作树且仓库功能正常。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @returns {Promise<import('./definition.mjs').Availability>} 探测结果。
   */
  async available(workspace) {
    try {
      const inside = await this.#git(workspace.cwd, ['rev-parse', '--is-inside-work-tree'])
      if (inside.stdout.trim() !== 'true') return { ok: false, reason: 'not inside a git working tree' }
      await this.#git(workspace.cwd, ['status', '--porcelain'])
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 捕获当前状态为未引用的提交对象。与 previousRef 树一致时返回 null（去重）。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {{triggerTool: string, previousRef?: string, signal?: AbortSignal}} ctx - 捕获上下文。
   * @returns {Promise<import('./definition.mjs').SnapshotResult|null>} 捕获结果。
   */
  snapshot(workspace, ctx) {
    return withLock(this.#chains, workspace.key, async () => {
      let sha = (await this.#git(workspace.cwd, ['stash', 'create'])).stdout.trim()
      if (sha === '') {
        // 工作树干净：没有可 stash 的脏状态；用 commit-tree 固定 HEAD 树。
        const head = (await this.#git(workspace.cwd, ['rev-parse', 'HEAD'])).stdout.trim()
        sha = (await this.#git(workspace.cwd, ['commit-tree', `${head}^{tree}`, '-m', 'dsh-checkpoint-rewind snapshot'])).stdout.trim()
      }
      if (sha === '') throw providerFailed(PROVIDERS.GIT, 'snapshot', 'git produced an empty snapshot object id')
      if (ctx.previousRef !== undefined) {
        const same = await this.#git(workspace.cwd, ['diff', '--quiet', ctx.previousRef, sha, '--'])
        if (same.code === 0) return null
      }
      const changed = (await this.#git(workspace.cwd, ['diff-tree', '--name-only', '-r', sha])).stdout
      const files = changed.trim().split('\n').filter(line => line.length > 0)
      const bytes = await this.#treeBytes(workspace.cwd, sha)
      return { ref: sha, files: files.length, bytes, notes: [] }
    })
  }

  /**
   * 恢复：把工作树文件设为 ref 捕获的状态（不动索引，不删任何文件）。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} ref - 快照对象 sha。
   * @param {AbortSignal} [_signal] - 取消信号（尽力而为，git 无中断语义）。
   * @returns {Promise<import('./definition.mjs').RestoreResult>} 恢复结果。
   */
  async restore(workspace, ref, _signal) {
    return withLock(this.#chains, workspace.key, async () => {
      const applied = await this.#git(workspace.cwd, ['restore', `--source=${ref}`, '--worktree', '--', '.'])
      if (applied.code !== 0) {
        throw providerFailed(PROVIDERS.GIT, 'restore', applied.stderr.trim() || `git restore exited ${applied.code}`)
      }
      const tracked = (await this.#git(workspace.cwd, ['ls-tree', '-r', '--name-only', ref])).stdout
      const leftovers = (await this.#git(workspace.cwd, ['ls-files', '--others', '--exclude-standard'])).stdout
        .trim().split('\n').filter(line => line.length > 0)
      return {
        restored: tracked.trim().split('\n').filter(line => line.length > 0).length,
        leftovers,
        notes: leftovers.length > 0
          ? [`${leftovers.length} untracked file(s) created after the checkpoint were left in place (never deleted without git clean)`]
          : [],
      }
    })
  }

  /**
   * git 快照是未引用的对象：删除记录即可，对象留给 git gc。
   * @param {import('./definition.mjs').WorkspaceInfo} _workspace - 未用。
   * @param {string} _ref - 未用。
   * @returns {Promise<void>} 立即完成。
   */
  async discard(_workspace, _ref) {}

  /**
   * 树内容字节数（配额记账）：ls-tree -r -l 各行第 4 列求和。
   * @param {string} cwd - 仓库根。
   * @param {string} ref - 提交对象 sha。
   * @returns {Promise<number>} 字节数。
   */
  async #treeBytes(cwd, ref) {
    const out = (await this.#git(cwd, ['ls-tree', '-r', '-l', ref])).stdout
    let bytes = 0
    for (const line of out.split('\n')) {
      if (line.trim() === '') continue
      const meta = line.split('\t')[0] ?? ''
      const size = Number(meta.split(/\s+/)[3])
      if (Number.isFinite(size)) bytes += size
    }
    return bytes
  }

  /**
   * 执行一条 git 命令：白名单断言 → runner → 失败即 providerFailed。
   * @param {string} cwd - 运行目录。
   * @param {string[]} args - git 参数（不含 gitBin）。
   * @returns {Promise<{code: number, stdout: string, stderr: string}>} 执行结果。
   */
  async #git(cwd, args) {
    assertSafe(args)
    try {
      return await this.#run(args, { cwd })
    } catch (error) {
      throw providerFailed(PROVIDERS.GIT, args[0] ?? 'git', error)
    }
  }
}

/**
 * 构造 git provider。
 * @param {object} deps - {gitBin, run?}。
 * @returns {GitSnapshotProvider} provider 实例。
 */
export function makeGitProvider(deps) {
  return new GitSnapshotProvider(deps)
}
