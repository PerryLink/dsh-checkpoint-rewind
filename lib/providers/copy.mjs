// lib/providers/copy.mjs — copy 快照 provider（目录增量拷贝，零 DSH 依赖）。
//
// 非 git 目录的兜底 provider：每个检查点一个快照目录（$snapshotDir/<workspaceKey>/<id>/），
// manifest.json 记录文件清单。增量策略：与上一检查点 manifest 比对
// （size + mtimeMs + mode 快速检查，rsync 惯例；verifyByHash 开启时改为
// 内容 sha256 比对），未变文件经 hardlink 复用上一快照的文件，变更/新增
// 文件实拷贝。bytes 是增量记账：只计本次实拷贝的字节（配额度量存储成本）。
// 恢复是覆盖式回滚：捕获的文件被拷回（覆盖 + 尽力恢复 mode），快照之后
// 新建的文件保留并报告——绝不删除用户文件。verifyByHash 捕获的清单携带
// 内容哈希，恢复时校验（防快照存储损坏静默还原错误内容）。
//
// 安全边界：'.git' 与快照根目录无论配置如何都被排除；恢复拒绝越界相对路径。

import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { withLock } from '../lock.mjs'
import { makeGlobMatcher } from '../glob.mjs'
import { COPY_MANIFEST, COPY_TMP_SUFFIX, PROVIDERS } from '../constants.mjs'
import { providerFailed } from '../errors.mjs'

/** provider 生成快照 ref 的形态（randomUUID；存储记录被篡改时拒绝一切其他形态）。 */
const SAFE_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * 校验 ref 是安全快照目录名：restore/discard 会 path.join(base, ref)，
 * 记录介质（JSON 后端人读文件）被篡改为 '..' 或含分隔符时不得越界读写。
 * @param {string} ref - 记录中的 provider ref。
 */
function assertSafeRef(ref) {
  if (typeof ref !== 'string' || !SAFE_REF.test(ref)) {
    throw new Error(`checkpoint ref is not a safe snapshot id: ${JSON.stringify(ref)}`)
  }
}

/**
 * 工作区键 → 路径安全目录名（键是绝对路径，Windows 下含盘符冒号，
 * 不能直接当目录段）。sha256 前 16 位十六进制，稳定且跨平台安全。
 * @param {string} key - workspaceKeyOf(cwd)。
 * @returns {string} 目录名。
 */
export function snapshotKeyDir(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

/**
 * 快照根 + 工作区子目录（provider 与测试共用同一推导）。
 * @param {string} snapshotDir - 快照根（绝对）。
 * @param {string} key - 工作区键。
 * @returns {string} 该工作区的快照目录。
 */
export function snapshotBaseDir(snapshotDir, key) {
  const safe = key.length > 0 ? snapshotKeyDir(key) : '_unknown'
  return path.join(path.resolve(snapshotDir), safe)
}

/**
 * 排除匹配器（glob 语义：'*' 单段内任意字符、'?' 单字符、'**' 跨任意段；
 * 无 '/' 模式匹配任意深度段名，与旧"精确段名"排除兼容）。'.git' 恒被排除。
 * @param {string[]} globs - Config.excludeGlobs。
 * @returns {(relPath: string) => boolean} 相对路径排除谓词（'/' 分隔）。
 */
function makeExcluder(globs) {
  return makeGlobMatcher(['.git', ...globs])
}

/** 清单文件条目。hash 仅 verifyByHash 捕获写入（向后兼容：缺失即无哈希校验）。 */
const manifestEntrySchema = ['rel', 'size', 'mtimeMs', 'mode']

/**
 * 流式计算文件内容 sha256（verifyByHash 的复用比对与恢复校验）。
 * @param {string} abs - 文件绝对路径。
 * @returns {Promise<string>} 十六进制哈希。
 */
function hashFile(abs) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(abs)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', (error) => reject(error))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * 校验清单（持久边界：损坏/越界清单响亮拒绝，绝不用于恢复）。
 * @param {unknown} value - JSON.parse 产物。
 * @returns {{id: string, base: string|null, files: Array<{rel: string, size: number, mtimeMs: number, mode: number, hash?: string}>, bytes: number}} 校验过的清单。
 */
function assertManifest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('checkpoint manifest is not an object')
  }
  const manifest = value
  if (typeof manifest.id !== 'string' || manifest.id.length === 0) throw new Error('checkpoint manifest lacks id')
  if (manifest.base !== null && typeof manifest.base !== 'string') throw new Error('checkpoint manifest base is invalid')
  if (!Array.isArray(manifest.files)) throw new Error('checkpoint manifest files is not an array')
  if (typeof manifest.bytes !== 'number' || !Number.isFinite(manifest.bytes) || manifest.bytes < 0) {
    throw new Error('checkpoint manifest bytes is invalid')
  }
  const seen = new Set()
  for (const entry of manifest.files) {
    if (entry === null || typeof entry !== 'object') throw new Error('checkpoint manifest entry is not an object')
    for (const key of manifestEntrySchema) {
      const value2 = entry[key]
      if (key === 'rel') {
        if (typeof value2 !== 'string' || value2.length === 0 || value2.startsWith('/') || value2.includes('..')) {
          throw new Error('checkpoint manifest entry rel is not a safe relative path')
        }
      } else if (typeof value2 !== 'number' || !Number.isFinite(value2) || value2 < 0) {
        throw new Error(`checkpoint manifest entry ${key} is invalid`)
      }
    }
    if (entry.hash !== undefined && (typeof entry.hash !== 'string' || entry.hash.length === 0)) {
      throw new Error('checkpoint manifest entry hash is invalid')
    }
    if (seen.has(entry.rel)) throw new Error(`checkpoint manifest duplicates ${entry.rel}`)
    seen.add(entry.rel)
  }
  return manifest
}

/**
 * copy 快照 provider。
 */
export class CopySnapshotProvider {
  /** @type {() => string} 快照根目录解析器（惰性：git-only 部署不触发 $DSH_HOME 校验）。 */
  #snapshotDir
  /** @type {(relPath: string) => boolean} 相对路径排除谓词（'/' 分隔）。 */
  #excluded
  /** @type {boolean} 内容哈希校验（复用比对 + 恢复完整性校验）。 */
  #verifyByHash
  /** @type {Map<string, Promise<unknown>>} 每工作区串行链。 */
  #chains = new Map()

  /**
   * @param {object} deps - {snapshotDir, excludeGlobs, verifyByHash}；snapshotDir 为绝对路径
   *   或返回绝对路径的函数（首次使用时求值，非法/缺失响亮失败）。
   */
  constructor(deps) {
    this.#snapshotDir = typeof deps.snapshotDir === 'function' ? deps.snapshotDir : () => path.resolve(deps.snapshotDir)
    this.#excluded = typeof deps.excludeGlobs === 'function'
      ? (relPath) => makeExcluder(deps.excludeGlobs() ?? [])(relPath)
      : makeExcluder(deps.excludeGlobs ?? [])
    this.#verifyByHash = typeof deps.verifyByHash === 'function' ? deps.verifyByHash : () => deps.verifyByHash === true
  }

  get name() {
    return PROVIDERS.COPY
  }

  /**
   * copy provider 总是可用（兜底语义）。
   * @returns {Promise<import('./definition.mjs').Availability>} ok。
   */
  async available() {
    return { ok: true }
  }

  /**
   * 捕获当前工作区状态。与 previousRef 文件集一致时返回 null（去重）。
   * bytes 是增量记账：本次实拷贝（未 hardlink 复用）的字节数。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {{triggerTool: string, previousRef?: string, signal?: AbortSignal}} ctx - 捕获上下文。
   * @returns {Promise<import('./definition.mjs').SnapshotResult|null>} 捕获结果。
   */
  snapshot(workspace, ctx) {
    return withLock(this.#chains, workspace.key, async () => {
      const base = this.#baseDir(workspace)
      await fs.mkdir(base, { recursive: true })
      await this.#cleanOrphans(base)
      const previous = ctx.previousRef === undefined ? undefined : await this.#loadManifest(base, ctx.previousRef)
      const id = randomUUID()
      const tmp = path.join(base, `${id}${COPY_TMP_SUFFIX}`)
      const final = path.join(base, id)
      await fs.mkdir(tmp, { recursive: true })
      const notes = []
      const { files, bytes, warnings } = await this.#walk(workspace, tmp, previous, notes)
      notes.push(...warnings)
      if (previous !== undefined && sameFileSet(previous.files, files)) {
        await fs.rm(tmp, { recursive: true, force: true })
        return null
      }
      const manifest = {
        id,
        base: previous?.id ?? null,
        files: files.map(entry => ({ rel: entry.rel, size: entry.size, mtimeMs: entry.mtimeMs, mode: entry.mode, ...(entry.hash === undefined ? {} : { hash: entry.hash }) })),
        bytes,
      }
      await fs.writeFile(path.join(tmp, COPY_MANIFEST), JSON.stringify(manifest), 'utf8')
      await fs.rename(tmp, final)
      return { ref: id, files: files.length, bytes, notes }
    })
  }

  /**
   * 覆盖式恢复：把清单中的文件拷回工作区（覆盖 + 尽力恢复 mode + 可选内容
   * 哈希校验）。快照之后新建的文件保留并报告。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} ref - 快照目录名。
   * @param {AbortSignal} [signal] - 取消信号（每个文件拷贝前检查）。
   * @param {string[]} [files] - 可选选择性恢复：只恢复这些相对路径（未知路径失败关闭）。
   * @returns {Promise<import('./definition.mjs').RestoreResult>} 恢复结果。
   */
  async restore(workspace, ref, signal, files) {
    return withLock(this.#chains, workspace.key, async () => {
      const base = this.#baseDir(workspace)
      const manifest = await this.#loadManifest(base, ref)
      const byRel = new Map(manifest.files.map(entry => [entry.rel, entry]))
      let targetEntries = manifest.files
      if (files !== undefined) {
        const unknown = files.filter(rel => !byRel.has(rel))
        if (unknown.length > 0) {
          throw providerFailed(PROVIDERS.COPY, 'restore', `unknown file(s) not present in the checkpoint manifest: ${unknown.join(', ')}`)
        }
        targetEntries = files.map(rel => byRel.get(rel))
      }
      const snapshotRoot = path.join(base, ref)
      const workspaceRoot = path.resolve(workspace.cwd)
      const notes = []
      const checkedDirs = new Set([workspaceRoot])
      let restored = 0
      for (const entry of targetEntries) {
        signal?.throwIfAborted()
        const src = path.join(snapshotRoot, entry.rel)
        const dst = path.resolve(workspace.cwd, entry.rel)
        if (!dst.startsWith(workspaceRoot + path.sep) && dst !== workspaceRoot) {
          throw new Error(`checkpoint manifest entry escapes the workspace: ${entry.rel}`)
        }
        // 写目标必须走真实路径：copyFile 会跟随符号链接，dst 或其祖先被换成
        // 指向工作区外的 symlink 时会把内容写到工作区之外——响亮拒绝。
        await this.#assertRealFileTarget(workspaceRoot, dst, checkedDirs)
        // 快照存储内的符号链接同样拒绝：跟随它读会把外部文件内容拷进工作区。
        const srcStat = await fs.lstat(src).catch(() => undefined)
        if (srcStat?.isSymbolicLink() === true) {
          throw providerFailed(PROVIDERS.COPY, 'restore', `snapshot storage contains a symbolic link: ${entry.rel} (refusing to read through it)`)
        }
        await fs.mkdir(path.dirname(dst), { recursive: true })
        try {
          await fs.copyFile(src, dst)
        } catch (error) {
          throw providerFailed(PROVIDERS.COPY, 'restore', `copying ${entry.rel}: ${error instanceof Error ? error.message : String(error)}`)
        }
        if (entry.hash !== undefined) {
          const actual = await hashFile(dst)
          if (actual !== entry.hash) {
            throw providerFailed(PROVIDERS.COPY, 'restore', `content hash mismatch for ${entry.rel}: checkpoint storage may be corrupted`)
          }
        }
        try {
          await fs.chmod(dst, entry.mode & 0o7777)
        } catch (error) {
          notes.push(`mode restore failed for ${entry.rel} (content restored): ${error instanceof Error ? error.message : String(error)}`)
        }
        restored += 1
      }
      const leftovers = await this.#listLeftovers(workspace, manifest.files)
      if (leftovers.length > 0) {
        notes.push(`${leftovers.length} file(s) created after the checkpoint were left in place (overwrite rollback never deletes files)`)
      }
      return { restored, leftovers, notes }
    })
  }

  /**
   * 恢复写目标的真实路径断言：祖先目录逐段 lstat（已通过者缓存；不存在的
   * 段由后续 mkdir 重建真实目录，无需再查更深段），dst 自身存在时必须是
   * 常规文件。符号链接/非常规文件 → 抛错（绝不跟随链接写工作区外）。
   * @param {string} workspaceRoot - 工作区绝对根。
   * @param {string} dst - 目标文件绝对路径。
   * @param {Set<string>} checkedDirs - 已通过检查的目录缓存。
   */
  async #assertRealFileTarget(workspaceRoot, dst, checkedDirs) {
    const ancestors = []
    let dir = path.dirname(dst)
    while (dir !== workspaceRoot && dir.startsWith(workspaceRoot + path.sep)) {
      ancestors.push(dir)
      dir = path.dirname(dir)
    }
    for (const ancestor of ancestors.reverse()) {
      if (checkedDirs.has(ancestor)) continue
      let stat
      try {
        stat = await fs.lstat(ancestor)
      } catch {
        stat = undefined
      }
      if (stat === undefined) break // 更深段必然也不存在；mkdir 将重建真实目录
      if (!stat.isDirectory()) {
        throw new Error(`restore target path is not a real directory: ${path.relative(workspaceRoot, ancestor)} (symbolic links are refused)`)
      }
      checkedDirs.add(ancestor)
    }
    let stat
    try {
      stat = await fs.lstat(dst)
    } catch {
      stat = undefined
    }
    if (stat !== undefined && !stat.isFile()) {
      throw new Error(`restore target is not a regular file: ${path.relative(workspaceRoot, dst)} (symbolic links are refused)`)
    }
  }

  /**
   * 删除快照目录（hardlink 不碍事：其余快照各自的链接计数独立）。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} ref - 快照目录名。
   * @returns {Promise<void>} 完成。
   */
  async discard(workspace, ref) {
    assertSafeRef(ref)
    return withLock(this.#chains, workspace.key, async () => {
      const base = this.#baseDir(workspace)
      await fs.rm(path.join(base, ref), { recursive: true, force: true })
    })
  }

  /**
   * 两两文件对比：两个 copy 快照清单（同工作区）之间的文件变更集。
   * 同 rel 文件按内容比对（双哈希优先，否则大小）；仅清单比对，纯读取。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} fromRef - 旧快照目录名。
   * @param {string} toRef - 新快照目录名。
   * @returns {Promise<{changed: number, added: number, removed: number, names: string[]}>} 变更统计与路径清单（按字母序）。
   */
  async diffFiles(workspace, fromRef, toRef) {
    assertSafeRef(fromRef)
    assertSafeRef(toRef)
    return withLock(this.#chains, workspace.key, async () => {
      const base = this.#baseDir(workspace)
      const [from, to] = await Promise.all([
        this.#loadManifest(base, fromRef),
        this.#loadManifest(base, toRef),
      ])
      const fromFiles = new Map(from.files.map(entry => [entry.rel, entry]))
      const toFiles = new Map(to.files.map(entry => [entry.rel, entry]))
      const sameContent = (a, b) => {
        if (a.hash !== undefined && b.hash !== undefined) return a.hash === b.hash
        return a.size === b.size
      }
      const names = new Set()
      const statusByRel = new Map()
      let added = 0
      let removed = 0
      for (const rel of toFiles.keys()) {
        const before = fromFiles.get(rel)
        if (before === undefined) {
          added += 1
          names.add(rel)
          statusByRel.set(rel, 'added')
        } else if (!sameContent(before, toFiles.get(rel))) {
          names.add(rel)
          statusByRel.set(rel, 'changed')
        }
      }
      for (const rel of fromFiles.keys()) {
        if (!toFiles.has(rel)) {
          removed += 1
          names.add(rel)
          statusByRel.set(rel, 'removed')
        }
      }
      const sorted = [...names].sort()
      const entries = sorted.map(rel => ({ path: rel, status: statusByRel.get(rel) ?? 'changed' }))
      return { changed: sorted.length, added, removed, names: sorted, entries }
    })
  }

  /** 快照根 + 工作区子目录。 */
  #baseDir(workspace) {
    return snapshotBaseDir(this.#snapshotDir(), workspace.key)
  }

  /**
   * 读取并校验清单（损坏即 providerFailed，响亮失败）。
   * @param {string} base - 工作区快照根。
   * @param {string} ref - 快照目录名。
   * @returns {Promise<ReturnType<typeof assertManifest>>} 清单。
   */
  async #loadManifest(base, ref) {
    assertSafeRef(ref)
    try {
      const text = await fs.readFile(path.join(base, ref, COPY_MANIFEST), 'utf8')
      return assertManifest(JSON.parse(text))
    } catch (error) {
      throw providerFailed(PROVIDERS.COPY, 'manifest', `checkpoint "${ref}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 清理未完成的捕获残留（*.tmp 目录，崩溃遗留）。
   * @param {string} base - 工作区快照根。
   * @returns {Promise<void>} 完成。
   */
  async #cleanOrphans(base) {
    let entries
    try {
      entries = await fs.readdir(base)
    } catch {
      // 快照基目录尚未创建或不可读：没有孤儿可清理，下次捕获再试。
      return
    }
    for (const entry of entries) {
      if (entry.endsWith(COPY_TMP_SUFFIX)) {
        // 残留清理是尽力而为：单条失败不阻断本次捕获，留给下次 snapshot 重试。
        await fs.rm(path.join(base, entry), { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  /**
   * 递归遍历工作区并物化快照目录：未变文件 hardlink 复用上一快照，
   * 变更/新增文件实拷贝。返回完整文件集与增量字节数（仅实拷贝的字节）。
   * verifyByHash 开启时复用判定改为内容哈希比对（mtime 保留/低精度文件
   * 系统下仍精确），清单条目携带哈希。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} tmp - 本次快照的 .tmp 目录。
   * @param {ReturnType<typeof assertManifest>|undefined} previous - 上一快照清单。
   * @param {string[]} notes - 备注收集器。
   * @returns {Promise<{files: Array<{rel: string, size: number, mtimeMs: number, mode: number, hash?: string}>, bytes: number, warnings: string[]}>}
   */
  async #walk(workspace, tmp, previous, notes) {
    const files = []
    const warnings = []
    let bytes = 0
    const previousByRel = new Map((previous?.files ?? []).map(entry => [entry.rel, entry]))
    const previousRoot = previous === undefined ? undefined : path.join(this.#baseDir(workspace), previous.id)
    const workspaceRoot = path.resolve(workspace.cwd)
    const snapshotBase = path.resolve(this.#snapshotDir())

    const visit = async (dir, relDir = '') => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch (error) {
        warnings.push(`unreadable directory skipped: ${path.relative(workspaceRoot, dir)} (${error instanceof Error ? error.message : String(error)})`)
        return
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (abs === snapshotBase || abs.startsWith(snapshotBase + path.sep)) continue
        const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`
        if (this.#excluded(relPath)) continue
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          await visit(abs, relPath)
          continue
        }
        if (!entry.isFile()) continue
        let stat
        try {
          stat = await fs.stat(abs)
        } catch (error) {
          warnings.push(`unreadable file skipped: ${path.relative(workspaceRoot, abs)} (${error instanceof Error ? error.message : String(error)})`)
          continue
        }
        const rel = relPath
        let hash
        if (this.#verifyByHash()) {
          try {
            hash = await hashFile(abs)
          } catch (error) {
            warnings.push(`unhashable file skipped: ${path.relative(workspaceRoot, abs)} (${error instanceof Error ? error.message : String(error)})`)
            continue
          }
        }
        const meta = { rel, size: stat.size, mtimeMs: stat.mtimeMs, mode: stat.mode, ...(hash === undefined ? {} : { hash }) }
        const prev = previousByRel.get(rel)
        const relTmp = path.join(tmp, rel)
        await fs.mkdir(path.dirname(relTmp), { recursive: true })
        const reuse = prev !== undefined && (this.#verifyByHash
          ? prev.hash !== undefined && prev.hash === hash
          : prev.size === stat.size && prev.mtimeMs === stat.mtimeMs && prev.mode === stat.mode)
        // 物化快照文件：hardlink 复用优先，失败降级实拷贝；再失败（遍历与
        // 拷贝之间文件被删/锁定）跳过该文件并警告——快照是安全网，单文件
        // 缺失不应让整条快照失败（该文件不进清单，恢复时不涉及）。
        try {
          if (reuse) {
            // 内容未变：hardlink 复用上一快照文件，省磁盘与 IO（不占增量字节）。
            const prevAbs = previousRoot === undefined ? '' : path.join(previousRoot, rel)
            try {
              await fs.link(prevAbs, relTmp)
            } catch {
              await fs.copyFile(abs, relTmp)
              bytes += stat.size
            }
          } else {
            await fs.copyFile(abs, relTmp)
            bytes += stat.size
          }
          files.push(meta)
        } catch (error) {
          warnings.push(`file skipped (copy failed): ${path.relative(workspaceRoot, abs)} (${error instanceof Error ? error.message : String(error)})`)
        }
      }
    }
    await visit(workspaceRoot)
    return { files, bytes, warnings }
  }

  /**
   * 快照之后新建的文件（当前工作区有、清单没有）→ 报告，不删除。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {Array<{rel: string}>} manifestFiles - 清单文件集。
   * @returns {Promise<string[]>} 遗留文件相对路径（最多 20 条）。
   */
  async #listLeftovers(workspace, manifestFiles) {
    const known = new Set(manifestFiles.map(entry => entry.rel))
    const leftovers = []
    const workspaceRoot = path.resolve(workspace.cwd)
    const snapshotBase = path.resolve(this.#snapshotDir())
    const visit = async (dir, relDir = '') => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (abs === snapshotBase || abs.startsWith(snapshotBase + path.sep)) continue
        const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`
        if (this.#excluded(relPath)) continue
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          await visit(abs, relPath)
          continue
        }
        if (!entry.isFile()) continue
        if (!known.has(relPath)) leftovers.push(relPath)
      }
    }
    await visit(workspaceRoot)
    leftovers.sort()
    return leftovers.slice(0, 20)
  }

  /**
   * 只读恢复预览：不写任何文件，报告该检查点恢复将覆盖的文件数/清单、
   * 与检查点一致的文件数、以及快照之后新建将被保留的文件（leftovers）。
   * 比对判据与 #walk 的去重判据一致（verifyByHash 时按内容哈希）。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} ref - 快照目录名。
   * @returns {Promise<import('./definition.mjs').PreviewResult>} 预览结果。
   */
  async preview(workspace, ref) {
    return withLock(this.#chains, workspace.key, async () => {
      const base = this.#baseDir(workspace)
      const manifest = await this.#loadManifest(base, ref)
      const workspaceRoot = path.resolve(workspace.cwd)
      const changes = []
      const entries = []
      let unchanged = 0
      for (const entry of manifest.files) {
        const dst = path.resolve(workspaceRoot, entry.rel)
        let stat
        try {
          stat = await fs.stat(dst)
        } catch {
          changes.push(entry.rel) // 文件已不存在：恢复将重建
          entries.push({ path: entry.rel, bytes: entry.size })
          continue
        }
        let same
        if (this.#verifyByHash && entry.hash !== undefined) {
          same = (await hashFile(dst).catch(() => undefined)) === entry.hash
        } else {
          same = stat.size === entry.size && stat.mtimeMs === entry.mtimeMs && stat.mode === entry.mode
        }
        if (same) {
          unchanged += 1
        } else {
          changes.push(entry.rel)
          entries.push({ path: entry.rel, bytes: entry.size })
        }
      }
      changes.sort()
      entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      const leftovers = await this.#listLeftovers(workspace, manifest.files)
      return { restore: changes.length, unchanged, leftovers, changes, entries }
    })
  }
}

/** 两份文件集是否一致（数量、相对路径与复用判据全等；双哈希时按哈希比对）。 */
function sameFileSet(previous, current) {
  if (previous.length !== current.length) return false
  const currentByRel = new Map(current.map(entry => [entry.rel, entry]))
  for (const prev of previous) {
    const curr = currentByRel.get(prev.rel)
    if (curr === undefined) return false
    if (prev.hash !== undefined && curr.hash !== undefined) {
      if (prev.hash !== curr.hash) return false
    } else if (curr.size !== prev.size || curr.mtimeMs !== prev.mtimeMs || curr.mode !== prev.mode) {
      return false
    }
  }
  return true
}

/**
 * 构造 copy provider。
 * @param {object} deps - {snapshotDir, excludeGlobs, verifyByHash}。
 * @returns {CopySnapshotProvider} provider 实例。
 */
export function makeCopyProvider(deps) {
  return new CopySnapshotProvider(deps)
}
