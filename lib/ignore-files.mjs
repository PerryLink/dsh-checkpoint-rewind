// lib/ignore-files.mjs — 工作区 .gitignore 读取与匹配（copy provider 专用）。
// 快照遍历对巨型被忽略目录（缓存/构建产物）是灾难：非 git 工作区没有 git
// 代读 ignore 规则，必须自己实现（事故：87 万 .gitignore'd 文件被全量快照）。
// 语义：根 .gitignore + 嵌套 .gitignore（各自作用于其子树）；深层规则覆盖
// 浅层（含 ! 取反重纳）。`.git/info/exclude` 与全局 core.excludesFile 不读
// （文档化边界：快照只看项目内声明的忽略意图）。
// 本文件是 `ignore` 依赖的唯二允许处之一（插件纪律：lib/ 零三方依赖，
// 例外清单见 AGENTS.md）。

import fs from 'node:fs/promises'
import path from 'node:path'
import ignore from 'ignore'

/** 空 .gitignore 的共享实例（无规则目录短路用）。 */
const EMPTY = ignore()

/**
 * 目录级 matcher 记录：baseDir 为工作区相对目录（'' 表示根），matcher 为
 * ignore() 实例；test 的输入是工作区相对路径（POSIX 分隔）。
 * @typedef {{ baseDir: string, matcher: ReturnType<ignore> }} MatcherLevel
 */

/**
 * 创建工作区 .gitignore 读取器。`enterDirectory(relDir)` 在该目录的孩子被
 * 匹配前必须调用（可重复调用，幂等）——读取并缓存该目录的 .gitignore；
 * `isIgnored(relPath)` 对已 enter 过的目录链同步求值。单个 .gitignore
 * 不可读不视为失败（记为空规则）。
 * @param {string} workspaceRoot - 工作区绝对路径（path.resolve 后）。
 * @returns {{
 *   enterDirectory: (relDir: string) => Promise<void>,
 *   isIgnored: (relPath: string) => boolean,
 * }} 读取器；relDir/relPath 均为工作区相对路径（'' = 根，POSIX 分隔）。
 */
export function createGitignoreReader(workspaceRoot) {
  /** @type {Map<string, Promise<MatcherLevel>>} */
  const pending = new Map()
  /** @type {MatcherLevel[]} 已解析层级（根→深顺序；求值时反向扫描）。 */
  const resolved = []

  const load = (relDir) => {
    let entry = pending.get(relDir)
    if (entry === undefined) {
      entry = (async () => {
        const abs = relDir === '' ? workspaceRoot : path.join(workspaceRoot, ...relDir.split('/'))
        let text = ''
        try {
          text = await fs.readFile(path.join(abs, '.gitignore'), 'utf8')
        } catch {
          return { baseDir: relDir, matcher: EMPTY }
        }
        return { baseDir: relDir, matcher: ignore().add(text) }
      })()
      pending.set(relDir, entry)
    }
    return entry
  }

  return {
    async enterDirectory(relDir) {
      const level = await load(relDir)
      if (!resolved.includes(level)) resolved.push(level)
    },
    isIgnored(relPath) {
      // 由深到浅：第一个给出 ignored/unignored 判定的层级胜出
      // （ignore().test 返回 {ignored, unignored}，命中 ! 取反时 unignored=true）。
      for (let index = resolved.length - 1; index >= 0; index -= 1) {
        const { baseDir, matcher } = resolved[index]
        if (baseDir !== '' && relPath !== baseDir && !relPath.startsWith(`${baseDir}/`)) continue
        const verdict = matcher.test(relPath)
        if (verdict.ignored) return true
        if (verdict.unignored) return false
      }
      return false
    },
  }
}
