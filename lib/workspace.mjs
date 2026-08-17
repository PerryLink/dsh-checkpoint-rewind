// lib/workspace.mjs — 工作区键与目录解析（零依赖）。

import path from 'node:path'
import os from 'node:os'

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
 * - 空值：$DSH_HOME/dsh-checkpoint-rewind；$DSH_HOME 缺失时回退
 *   ~/.dsh/dsh-checkpoint-rewind（dsh 的默认 DSH_HOME 同址）。绝不抛错——
 *   "运行于 dsh 之下"不保证导出 $DSH_HOME（issue #4），快照是安全网，
 *   目录解析失败不该让捕获路径崩溃。
 * @param {string} snapshotDir - Config.snapshotDir。
 * @param {string|undefined} [dshHome] - 环境 $DSH_HOME（测试注入）。
 * @returns {string} 绝对路径。
 */
export function resolveSnapshotDir(snapshotDir, dshHome = process.env.DSH_HOME) {
  if (snapshotDir) {
    const base = dshHome ?? process.cwd()
    return path.isAbsolute(snapshotDir) ? path.normalize(snapshotDir) : path.resolve(base, snapshotDir)
  }
  const home = dshHome ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'dsh-checkpoint-rewind')
}

/**
 * 平台默认的临时根目录（集成测试等使用）。
 * @returns {string} 绝对路径。
 */
export function defaultTempDir() {
  return os.tmpdir()
}
