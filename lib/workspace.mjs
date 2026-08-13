// lib/workspace.mjs — 工作区键与目录解析（零依赖）。

import path from 'node:path'
import os from 'node:os'
import { badConfig } from './errors.mjs'

/**
 * 把会话 cwd 规范化为 workspaceKey。空/非法 cwd 得到 ''（正常 DSH 会话
 * cwd 必为绝对路径；空键的会话不做快照）。
 * Windows 下大小写不敏感（盘符/路径大小写差异不产生两个隔离层）。
 * @param {string|undefined|null} cwd - 会话 cwd。
 * @returns {string} 规范化键。
 */
export function workspaceKeyOf(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return ''
  const resolved = path.resolve(cwd)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * 解析快照根目录（copy provider 的文件快照存放处）。
 * - 显式绝对路径：原样规范化。
 * - 显式相对路径：相对 $DSH_HOME（有则），否则相对进程 cwd。
 * - 空值：$DSH_HOME/dsh-checkpoint-rewind；$DSH_HOME 缺失时响亮失败。
 * @param {string} snapshotDir - Config.snapshotDir。
 * @param {string|undefined} [dshHome] - 环境 $DSH_HOME（测试注入）。
 * @returns {string} 绝对路径。
 */
export function resolveSnapshotDir(snapshotDir, dshHome = process.env.DSH_HOME) {
  if (snapshotDir) {
    const base = dshHome ?? process.cwd()
    return path.isAbsolute(snapshotDir) ? path.normalize(snapshotDir) : path.resolve(base, snapshotDir)
  }
  if (!dshHome) {
    throw badConfig('snapshotDir is not configured and $DSH_HOME is not set; run under dsh or set snapshotDir explicitly')
  }
  return path.join(dshHome, 'dsh-checkpoint-rewind')
}

/**
 * 平台默认的临时根目录（集成测试等使用）。
 * @returns {string} 绝对路径。
 */
export function defaultTempDir() {
  return os.tmpdir()
}
