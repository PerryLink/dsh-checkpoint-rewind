// lib/providers/git.mjs — git 快照 provider（零 DSH 依赖）。
//
// 无副作用原语快照：`git stash create`（脏状态 → 未引用的 stash 提交对象，
// 不动工作树/索引/历史）；工作树干净时退化为 `git commit-tree <HEAD>^{tree}
// -p <HEAD>` 生成同样未引用的提交对象（带父指针，变更集为空）。恢复用
// `git restore --source=<ref> --worktree -- .`（仅工作树、不动索引）。
// 绝不发出 reset/clean/stash-apply 一类命令（ALLOWED_VERBS 白名单 + restore
// 必须带 --worktree，双保险）。
//
// 只覆盖已跟踪文件：快照之后新建的文件（未跟踪或已暂存）在恢复后保留并
// 报告（与 copy provider 的覆盖式回滚同一安全边界）。非 git 目录由消费方
// 降级 copy。可用性探测（含 unborn HEAD 拒绝）按工作区键缓存：git-ness 在
// 进程生命周期内视为不变。

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
  'reset',
])

/** 快照对象 sha 的合法形态（sha1=40 / sha256=64 hex；记录被篡改时拒绝注入 git 选项）。 */
const SAFE_SHA = /^[0-9a-f]{40,64}$/iu

/**
 * 校验 ref 是快照对象 sha：ref 会被拼进 git 命令参数，记录介质被篡改为
 * '--output=<path>'（git diff 的真实选项）等形态时不得通过。
 * @param {string} ref - 记录中的 provider ref。
 */
export function assertSafeRef(ref) {
  if (typeof ref !== 'string' || !SAFE_SHA.test(ref)) {
    throw new Error(`checkpoint ref is not a valid git object id: ${JSON.stringify(ref)}`)
  }
}

/** 单次 restore 的显式路径批量上限（长命令行防御）。 */
const RESTORE_PATH_BATCH = 200

/**
 * git 子进程环境：终端提示关闭（凭据/确认提示会让命令挂起，快照链永久卡死），
 * 可选锁关闭（只读/工作树原语不需要 index.lock 等）。
 */
export const GIT_SPAWN_ENV = Object.freeze({
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
})

/** 按固定大小切分数组（restore 显式路径分块用）。 */
function chunkList(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

/**
 * 默认 runner：真实 spawn git（生产路径）。测试注入 scripted runner。
 * @param {string} gitBin - Config.gitBin。
 * @returns {(args: string[], opts?: {cwd?: string}) => Promise<{code: number, stdout: string, stderr: string}>}
 */
export function spawnGitRunner(gitBin) {
  return (args, opts = {}) => new Promise((resolve, reject) => {
    const child = spawn(gitBin, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...GIT_SPAWN_ENV },
    })
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
  // reset 只允许显式 reset-hard 模式（消费方必须先过确认门；目标是快照提交
  // 对象 sha，已经 assertSafeRef 校验），绝不允许 reset --soft/--mixed/路径式。
  if (verb === 'reset' && (args[1] !== '--hard' || args.length !== 3)) {
    throw new Error('git provider only runs "git reset --hard <snapshot-ref>"')
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
  /** @type {Map<string, import('./definition.mjs').Availability>} 每工作区探测缓存（含负结果）。 */
  #probeCache = new Map()

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
   * 探测：合法 git 工作树、HEAD 已存在（拒绝 unborn 仓库：stash create 与
   * commit-tree 回退都依赖 HEAD）、仓库功能正常。结果按工作区键缓存至
   * 进程结束（git-ness 视为不变）。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @returns {Promise<import('./definition.mjs').Availability>} 探测结果。
   */
  async available(workspace) {
    const cached = this.#probeCache.get(workspace.key)
    if (cached !== undefined) return cached
    const probe = await this.#probe(workspace)
    this.#probeCache.set(workspace.key, probe)
    return probe
  }

  /** 单次探测（未缓存路径）。 */
  async #probe(workspace) {
    try {
      const inside = await this.#git(workspace.cwd, ['rev-parse', '--is-inside-work-tree'])
      if (inside.stdout.trim() !== 'true') return { ok: false, reason: 'not inside a git working tree' }
      const head = await this.#git(workspace.cwd, ['rev-parse', '--verify', 'HEAD'])
      if (head.code !== 0 || head.stdout.trim() === '') {
        return { ok: false, reason: 'repository has no commits (unborn HEAD); snapshot primitives require HEAD' }
      }
      await this.#git(workspace.cwd, ['status', '--porcelain'])
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 未跟踪（非忽略）文件清单：`git ls-files --others --exclude-standard`
   * （只读，白名单动词）。无锁——restore/preview 已在同 key 锁内调用，
   * 公开方法 untrackedFiles 负责加锁。
   * @param {string} cwd - 仓库根。
   * @returns {Promise<string[]>} 未跟踪路径清单（按 git 输出顺序）。
   */
  async #untracked(cwd) {
    const out = (await this.#git(cwd, ['ls-files', '--others', '--exclude-standard'])).stdout
    return out.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  }

  /**
   * 未跟踪（非忽略）文件清单（只读；去重提示用：git 快照只覆盖已跟踪文件，
   * 消费方借此给出"git add 纳入后续快照"的可操作提示）。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @returns {Promise<string[]>} 未跟踪路径清单。
   */
  async untrackedFiles(workspace) {
    return withLock(this.#chains, workspace.key, async () => this.#untracked(workspace.cwd))
  }

  /**
   * 捕获当前状态为未引用的提交对象。与 previousRef 树一致时返回 null（去重）。
   * bytes 是增量记账：相对父提交变更文件（真正写入 odb 的 blob）的字节和，
   * 不是整棵树——干净树的快照字节接近 0。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {{triggerTool: string, previousRef?: string, signal?: AbortSignal}} ctx - 捕获上下文。
   * @returns {Promise<import('./definition.mjs').SnapshotResult|null>} 捕获结果。
   */
  snapshot(workspace, ctx) {
    return withLock(this.#chains, workspace.key, async () => {
      if (ctx.previousRef !== undefined) assertSafeRef(ctx.previousRef)
      let sha = (await this.#git(workspace.cwd, ['stash', 'create'])).stdout.trim()
      if (sha === '') {
        // 工作树干净：没有可 stash 的脏状态；用 commit-tree 固定 HEAD 树。
        // -p HEAD 让快照提交的父指针为 HEAD：变更集为空、增量字节为 0。
        const head = (await this.#git(workspace.cwd, ['rev-parse', 'HEAD'])).stdout.trim()
        sha = (await this.#git(workspace.cwd, ['commit-tree', `${head}^{tree}`, '-p', head, '-m', 'dsh-checkpoint-rewind snapshot'])).stdout.trim()
      }
      if (sha === '') throw providerFailed(PROVIDERS.GIT, 'snapshot', 'git produced an empty snapshot object id')
      if (ctx.previousRef !== undefined) {
        const same = await this.#git(workspace.cwd, ['diff', '--quiet', ctx.previousRef, sha, '--'])
        if (same.code === 0) return null
      }
      // 变更集必须对第一父提交显式 diff：stash 提交带 HEAD + 索引树两个父，
      // 单参 diff-tree 走合并提交的 combined diff（结果与任一父一致即不列出），
      // 未暂存变更会得到空变更集。无父提交（不可能，但防御）退回单参形式。
      const parent = (await this.#git(workspace.cwd, ['rev-parse', `${sha}^`])).stdout.trim()
      const changed = parent === ''
        ? (await this.#git(workspace.cwd, ['diff-tree', '--name-only', '-r', sha])).stdout
        : (await this.#git(workspace.cwd, ['diff-tree', '--name-only', '-r', parent, sha])).stdout
      const files = changed.trim().split('\n').filter(line => line.length > 0)
      const bytes = await this.#changedBytes(workspace.cwd, sha, files)
      // 三态模型：tree = 快照提交的 tree SHA（工作区态的身份）；ref = 提交对象
      // （restore/reset 的恢复句柄）。
      const tree = (await this.#git(workspace.cwd, ['rev-parse', `${sha}^{tree}`])).stdout.trim()
      if (tree === '' || !SAFE_SHA.test(tree)) {
        throw providerFailed(PROVIDERS.GIT, 'snapshot', `git produced an invalid snapshot tree id ${JSON.stringify(tree)}`)
      }
      return { ref: sha, tree, files: files.length, bytes, notes: [] }
    })
  }

  /**
   * 恢复：把工作树文件设为 ref 捕获的状态（不动索引，绝不删除任何文件）。
   * 显式路径分块恢复（只传 ref 树中存在的路径）：`git restore --source=<ref>
   * --worktree -- .` 会删除"已跟踪但 ref 中没有"的文件（检查点之后 git add
   * 的新文件），违反"覆盖回滚、绝不删除"边界，因此这里逐路径白名单恢复。
   * restored 计数 = ref 中存在且工作树不同的文件数（实际被恢复的文件）。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} ref - 快照对象 sha。
   * @param {AbortSignal} [_signal] - 取消信号（尽力而为，git 无中断语义）。
   * @returns {Promise<import('./definition.mjs').RestoreResult>} 恢复结果。
   */
  async restore(workspace, ref, _signal) {
    assertSafeRef(ref)
    return withLock(this.#chains, workspace.key, async () => {
      const tracked = (await this.#git(workspace.cwd, ['ls-tree', '-r', '--name-only', ref])).stdout
        .trim().split('\n').filter(line => line.length > 0)
      const changed = (await this.#git(workspace.cwd, ['diff', '--name-only', ref, '--'])).stdout
        .trim().split('\n').filter(line => line.length > 0)
      const restorable = new Set(tracked)
      const restoredCount = changed.filter(name => restorable.has(name)).length
      for (const chunk of chunkList(tracked, RESTORE_PATH_BATCH)) {
        const applied = await this.#git(workspace.cwd, ['restore', `--source=${ref}`, '--worktree', '--', ...chunk])
        if (applied.code !== 0) {
          throw providerFailed(PROVIDERS.GIT, 'restore', applied.stderr.trim() || `git restore exited ${applied.code}`)
        }
      }
      // 遗留报告：未跟踪新文件 ∪ 检查点后新增且已进入索引的文件（工作树相对
      // ref 的新增路径）——都只报告、不删除，与 copy provider 对称。
      const untracked = await this.#untracked(workspace.cwd)
      const added = (await this.#git(workspace.cwd, ['diff', '--name-only', '--diff-filter=A', ref, '--'])).stdout
        .trim().split('\n').filter(line => line.length > 0)
      const leftovers = [...new Set([...untracked, ...added])].sort()
      return {
        restored: restoredCount,
        leftovers,
        notes: leftovers.length > 0
          ? [`${leftovers.length} file(s) created after the checkpoint were left in place (never deleted without git clean)`]
          : [],
      }
    })
  }

  /**
   * 只读恢复预览：不写任何文件，报告恢复将覆盖的文件清单/数量、与检查点
   * 一致的文件数、以及快照之后新建将被保留的文件。计数逻辑与 restore 的
   * restored 一致（ref 树 ∩ 工作树差异），但不执行 restore 命令。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} ref - 快照对象 sha。
   * @returns {Promise<import('./definition.mjs').PreviewResult>} 预览结果。
   */
  async preview(workspace, ref) {
    assertSafeRef(ref)
    return withLock(this.#chains, workspace.key, async () => {
      const tracked = (await this.#git(workspace.cwd, ['ls-tree', '-r', '--name-only', ref])).stdout
        .trim().split('\n').filter(line => line.length > 0)
      const changed = (await this.#git(workspace.cwd, ['diff', '--name-only', ref, '--'])).stdout
        .trim().split('\n').filter(line => line.length > 0)
      const trackedSet = new Set(tracked)
      const changes = changed.filter(name => trackedSet.has(name)).sort()
      const untracked = await this.#untracked(workspace.cwd)
      const added = (await this.#git(workspace.cwd, ['diff', '--name-only', '--diff-filter=A', ref, '--'])).stdout
        .trim().split('\n').filter(line => line.length > 0)
      const leftovers = [...new Set([...untracked, ...added])].sort()
      return { restore: changes.length, unchanged: tracked.length - changes.length, leftovers, changes }
    })
  }

  /**
   * 两两文件对比：两个快照提交（同仓库）之间的文件变更集。
   * 纯读取（diff-tree），绝不触碰工作树。计数与清单供列表/对比渲染。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} fromRef - 旧快照提交 sha。
   * @param {string} toRef - 新快照提交 sha。
   * @returns {Promise<{changed: number, added: number, removed: number, names: string[]}>} 变更统计与路径清单（按字母序）。
   */
  async diffFiles(workspace, fromRef, toRef) {
    assertSafeRef(fromRef)
    assertSafeRef(toRef)
    return withLock(this.#chains, workspace.key, async () => {
      const out = (await this.#git(workspace.cwd, ['diff-tree', '--name-status', '-r', fromRef, toRef])).stdout
      const names = []
      let added = 0
      let removed = 0
      for (const line of out.split('\n')) {
        if (line.trim() === '') continue
        const [status, name] = line.split('\t')
        if (name === undefined) continue
        names.push(name)
        if (status === 'A') added += 1
        else if (status === 'D') removed += 1
      }
      names.sort()
      return { changed: names.length, added, removed, names }
    })
  }

  /**
   * CC 对标的工作区回滚：git reset --hard <快照提交>（显式 reset-hard 模式，
   * 消费方必须先经确认门并捕获 pre-rewind 保护检查点）。分支头移动到快照
   * 提交（对象库/reflog 保留原历史，可撤回）；工作树与索引一致化为快照树；
   * 未跟踪文件不受触碰（与 restore 模式同一"绝不 git clean"边界）。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} ref - 快照提交 sha。
   * @param {AbortSignal} [_signal] - 取消信号（尽力而为，git 无中断语义）。
   * @returns {Promise<import('./definition.mjs').RestoreResult>} 恢复结果。
   */
  async resetHard(workspace, ref, _signal) {
    assertSafeRef(ref)
    return withLock(this.#chains, workspace.key, async () => {
      const changed = (await this.#git(workspace.cwd, ['diff', '--name-only', ref, '--'])).stdout
        .trim().split('\n').filter(line => line.length > 0)
      const applied = await this.#git(workspace.cwd, ['reset', '--hard', ref])
      if (applied.code !== 0) {
        throw providerFailed(PROVIDERS.GIT, 'reset', applied.stderr.trim() || `git reset exited ${applied.code}`)
      }
      const untracked = await this.#untracked(workspace.cwd)
      return {
        restored: changed.length,
        leftovers: untracked,
        notes: [
          `branch head moved to snapshot commit ${ref.slice(0, 12)} (git reset --hard); pre-snapshot history remains recoverable via reflog`,
          ...(untracked.length > 0 ? [`${untracked.length} untracked file(s) were left in place (never deleted without git clean)`] : []),
        ],
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
   * 变更文件的内容字节数（配额记账）：ls-tree 全树行按 diff-tree 变更集过滤求和。
   * 干净树快照的变更集为空 → 0 字节（对象自身开销忽略不计）。
   * @param {string} cwd - 仓库根。
   * @param {string} ref - 提交对象 sha。
   * @param {string[]} changedPaths - diff-tree --name-only 的变更路径。
   * @returns {Promise<number>} 字节数。
   */
  async #changedBytes(cwd, ref, changedPaths) {
    if (changedPaths.length === 0) return 0
    const changed = new Set(changedPaths)
    const out = (await this.#git(cwd, ['ls-tree', '-r', '-l', ref])).stdout
    let bytes = 0
    for (const line of out.split('\n')) {
      if (line.trim() === '') continue
      const [meta, name] = line.split('\t')
      if (name === undefined || !changed.has(name)) continue
      const size = Number((meta ?? '').split(/\s+/)[3])
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
