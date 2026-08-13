// lib/providers/copy.mjs — copy 快照 provider（目录增量拷贝，零 DSH 依赖）。
//
// 非 git 目录的兜底 provider：每个检查点一个快照目录（$snapshotDir/<workspaceKey>/<id>/），
// manifest.json 记录文件清单。增量策略：与上一检查点 manifest 比对
// （size + mtimeMs + mode 快速检查，rsync 惯例），未变文件经 hardlink
// 复用上一快照的文件，变更/新增文件实拷贝。恢复是覆盖式回滚：捕获的文件
// 被拷回（覆盖），快照之后新建的文件保留并报告——绝不删除用户文件。
//
// 安全边界：'.git' 与快照根目录无论配置如何都被排除；恢复拒绝越界相对路径。

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { withLock } from '../lock.mjs'
import { COPY_MANIFEST, COPY_TMP_SUFFIX, PROVIDERS } from '../constants.mjs'
import { providerFailed } from '../errors.mjs'

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
 * 排除项（精确路径段名，win32 大小写不敏感）。'.git' 与快照根永在。
 * @param {string[]} globs - Config.excludeGlobs。
 * @returns {(segment: string) => boolean} 段名排除谓词。
 */
function makeExcluder(globs) {
  const names = new Set(['.git', ...globs.map(item => item.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() ?? item)])
  const lowered = process.platform === 'win32' ? new Set([...names].map(name => name.toLowerCase())) : names
  return (segment) => process.platform === 'win32' ? lowered.has(segment.toLowerCase()) : names.has(segment)
}

/** 清单文件条目。 */
const manifestEntrySchema = ['rel', 'size', 'mtimeMs', 'mode']

/**
 * 校验清单（持久边界：损坏/越界清单响亮拒绝，绝不用于恢复）。
 * @param {unknown} value - JSON.parse 产物。
 * @returns {{id: string, base: string|null, files: Array<{rel: string, size: number, mtimeMs: number, mode: number}>, bytes: number}} 校验过的清单。
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
  /** @type {(segment: string) => boolean} 段名排除谓词。 */
  #excluded
  /** @type {Map<string, Promise<unknown>>} 每工作区串行链。 */
  #chains = new Map()

  /**
   * @param {object} deps - {snapshotDir, excludeGlobs}；snapshotDir 为绝对路径
   *   或返回绝对路径的函数（首次使用时求值，非法/缺失响亮失败）。
   */
  constructor(deps) {
    this.#snapshotDir = typeof deps.snapshotDir === 'function' ? deps.snapshotDir : () => path.resolve(deps.snapshotDir)
    this.#excluded = makeExcluder(deps.excludeGlobs ?? [])
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
        files: files.map(entry => ({ rel: entry.rel, size: entry.size, mtimeMs: entry.mtimeMs, mode: entry.mode })),
        bytes,
      }
      await fs.writeFile(path.join(tmp, COPY_MANIFEST), JSON.stringify(manifest), 'utf8')
      await fs.rename(tmp, final)
      return { ref: id, files: files.length, bytes, notes }
    })
  }

  /**
   * 覆盖式恢复：把清单中的文件拷回工作区（覆盖）。快照之后新建的文件保留并报告。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} ref - 快照目录名。
   * @param {AbortSignal} [signal] - 取消信号（每个文件拷贝前检查）。
   * @returns {Promise<import('./definition.mjs').RestoreResult>} 恢复结果。
   */
  async restore(workspace, ref, signal) {
    return withLock(this.#chains, workspace.key, async () => {
      const base = this.#baseDir(workspace)
      const manifest = await this.#loadManifest(base, ref)
      const snapshotRoot = path.join(base, ref)
      let restored = 0
      for (const entry of manifest.files) {
        signal?.throwIfAborted()
        const src = path.join(snapshotRoot, entry.rel)
        const dst = path.resolve(workspace.cwd, entry.rel)
        if (!dst.startsWith(path.resolve(workspace.cwd) + path.sep) && dst !== path.resolve(workspace.cwd)) {
          throw new Error(`checkpoint manifest entry escapes the workspace: ${entry.rel}`)
        }
        await fs.mkdir(path.dirname(dst), { recursive: true })
        try {
          await fs.copyFile(src, dst)
        } catch (error) {
          throw providerFailed(PROVIDERS.COPY, 'restore', `copying ${entry.rel}: ${error instanceof Error ? error.message : String(error)}`)
        }
        restored += 1
      }
      const leftovers = await this.#listLeftovers(workspace, manifest.files)
      return {
        restored,
        leftovers,
        notes: leftovers.length > 0
          ? [`${leftovers.length} file(s) created after the checkpoint were left in place (overwrite rollback never deletes files)`]
          : [],
      }
    })
  }

  /**
   * 删除快照目录（hardlink 不碍事：其余快照各自的链接计数独立）。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} ref - 快照目录名。
   * @returns {Promise<void>} 完成。
   */
  async discard(workspace, ref) {
    return withLock(this.#chains, workspace.key, async () => {
      const base = this.#baseDir(workspace)
      await fs.rm(path.join(base, ref), { recursive: true, force: true })
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
      return
    }
    for (const entry of entries) {
      if (entry.endsWith(COPY_TMP_SUFFIX)) {
        await fs.rm(path.join(base, entry), { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  /**
   * 递归遍历工作区并物化快照目录：未变文件 hardlink 复用上一快照，
   * 变更/新增文件实拷贝。返回完整文件集。
   * @param {import('./definition.mjs').WorkspaceInfo} workspace - 目标工作区。
   * @param {string} tmp - 本次快照的 .tmp 目录。
   * @param {ReturnType<typeof assertManifest>|undefined} previous - 上一快照清单。
   * @param {string[]} notes - 备注收集器。
   * @returns {Promise<{files: Array<{rel: string, size: number, mtimeMs: number, mode: number}>, bytes: number, warnings: string[]}>}
   */
  async #walk(workspace, tmp, previous, notes) {
    const files = []
    const warnings = []
    let bytes = 0
    const previousByRel = new Map((previous?.files ?? []).map(entry => [entry.rel, entry]))
    const previousRoot = previous === undefined ? undefined : path.join(this.#baseDir(workspace), previous.id)
    const workspaceRoot = path.resolve(workspace.cwd)
    const snapshotBase = path.resolve(this.#snapshotDir())

    const visit = async (dir) => {
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
        if (entry.name === '.git') continue
        if (this.#excluded(entry.name)) continue
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          await visit(abs)
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
        const rel = path.relative(workspaceRoot, abs).split(path.sep).join('/')
        const meta = { rel, size: stat.size, mtimeMs: stat.mtimeMs, mode: stat.mode }
        files.push(meta)
        bytes += stat.size
        const prev = previousByRel.get(rel)
        const relTmp = path.join(tmp, rel)
        await fs.mkdir(path.dirname(relTmp), { recursive: true })
        if (prev !== undefined && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs && prev.mode === stat.mode) {
          // 内容未变（快速检查）：hardlink 复用上一快照文件，省磁盘与 IO。
          const prevAbs = previousRoot === undefined ? '' : path.join(previousRoot, rel)
          let linked = false
          try {
            await fs.link(prevAbs, relTmp)
            linked = true
          } catch {
            linked = false
          }
          if (!linked) await fs.copyFile(abs, relTmp)
        } else {
          await fs.copyFile(abs, relTmp)
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
    const visit = async (dir) => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name)
        if (abs === snapshotBase || abs.startsWith(snapshotBase + path.sep)) continue
        if (entry.name === '.git') continue
        if (this.#excluded(entry.name)) continue
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          await visit(abs)
          continue
        }
        if (!entry.isFile()) continue
        const rel = path.relative(workspaceRoot, abs).split(path.sep).join('/')
        if (!known.has(rel)) leftovers.push(rel)
      }
    }
    await visit(workspaceRoot)
    leftovers.sort()
    return leftovers.slice(0, 20)
  }
}

/** 两份文件集是否一致（数量、相对路径与快速检查字段全等）。 */
function sameFileSet(previous, current) {
  if (previous.length !== current.length) return false
  const currentByRel = new Map(current.map(entry => [entry.rel, entry]))
  for (const prev of previous) {
    const curr = currentByRel.get(prev.rel)
    if (curr === undefined || curr.size !== prev.size || curr.mtimeMs !== prev.mtimeMs || curr.mode !== prev.mode) return false
  }
  return true
}

/**
 * 构造 copy provider。
 * @param {object} deps - {snapshotDir, excludeGlobs}。
 * @returns {CopySnapshotProvider} provider 实例。
 */
export function makeCopyProvider(deps) {
  return new CopySnapshotProvider(deps)
}
