// lib/lock.mjs — 按键串行化的进程内互斥（零依赖）。

/**
 * 在 key 对应的互斥链上串行执行 fn。同 key 并发调用按先来后到排队，
 * 不同 key 互不阻塞。异常透传，锁始终释放。
 * @template T
 * @param {Map<string, Promise<unknown>>} chains - 键 → 当前链尾 Promise。
 * @param {string} key - 互斥键。
 * @param {() => Promise<T>} fn - 串行执行的任务。
 * @returns {Promise<T>} fn 的结果。
 */
export function withLock(chains, key, fn) {
  const tail = chains.get(key) ?? Promise.resolve()
  const run = tail.then(fn, fn)
  // 链尾吞掉结果，避免未处理拒绝污染后续链。
  chains.set(key, run.then(() => undefined, () => undefined))
  return run
}
