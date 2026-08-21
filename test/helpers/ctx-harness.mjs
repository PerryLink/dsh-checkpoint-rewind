// test/helpers/ctx-harness.mjs — 组装测试用 Cordis 上下文（真 cordis + 真 SessionStore
// + 真 CommandRuntime + mock storageDomain / userQuestions / approval）。
//
// 语义对齐真 Cordis 的关键点：
// - 全部服务经 ctx.plugin 挂载（inject 解析、生命周期与真实装配一致）；
// - storageDomain 是 mock 领域 facility：内存表，实现 open(spec) → domain.table(name)
//   返回真实 KvTable 形状的 {get, put, delete, update, entries(): [K,V] 迭代器, keys, size}；
// - userQuestions/approval 按测试注入（默认两者缺失 → 确认门失败关闭）。
//
// 介质版本语义对齐真 json 后端（@deepseek-ai/dsh-storage-json 的 parse）：
// - mediumVersion 指定 = 介质已存在且盖该版本章：open 的 spec.version 不匹配时
//   抛 {code: 'version-mismatch'}（与后端 StorageError 同 code）；
// - mediumVersion 缺省 = 新介质：任意 spec 版本可创建，首次 open 后按该 spec 盖章。

import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import path from 'node:path'
import { checkpointsDomainSpec } from '../../lib/domain.mjs'

/**
 * 构造 mock 存储领域 facility（'checkpoints' 单表内存实现）。
 * 返回的 `records` 是权威记录 Map（测试直接断言）。
 * @param {object} [opts] - {mediumVersion}。
 * @returns {{facility: object, records: Map<string, object>, opened: object[], specVersions: number[]}}
 */
export function makeDomainFacility({ mediumVersion } = {}) {
  const store = new Map()
  const records = new Map()
  store.set(checkpointsDomainSpec.name, records)
  const opened = []
  const specVersions = []
  // 已存在介质的版本；undefined = 新介质（首个 spec 创建并盖章）。
  let sealedVersion = mediumVersion
  const makeTable = (map) => ({
    get: (key) => map.get(key),
    put: async (key, value) => { map.set(key, value) },
    delete: async (key) => map.delete(key),
    update: async (key, fn) => {
      const current = map.get(key)
      if (current === undefined) throw new Error('missing-key')
      map.set(key, fn(current))
    },
    entries: () => [...map.entries()][Symbol.iterator](),
    keys: () => [...map.keys()][Symbol.iterator](),
    size: () => map.size,
  })
  const facility = {
    async open(spec) {
      if (spec.name !== checkpointsDomainSpec.name) throw new Error(`unexpected domain ${spec.name}`)
      if (sealedVersion !== undefined && spec.version !== sealedVersion) {
        throw Object.assign(
          new Error(`unit '${spec.name}': stored version ${sealedVersion} != expected ${spec.version}`),
          { code: 'version-mismatch' },
        )
      }
      if (sealedVersion === undefined) sealedVersion = spec.version
      const map = store.get(spec.name) ?? new Map()
      store.set(spec.name, map)
      const domain = {
        name: spec.name,
        table: (name) => makeTable(map),
        close: async () => {},
      }
      opened.push(domain)
      specVersions.push(spec.version)
      return domain
    },
  }
  return { facility, records, opened, specVersions }
}

/**
 * 组装完整测试上下文。
 * @param {object} [opts] - {config, userQuestions, approval, cwd, sessionId, mediumVersion, seedRecords}。
 * @returns {Promise<{root: Context, dispose: () => Promise<void>, records: Map, opened: object[], specVersions: number[], agent: object, session: object, makeSession: (cwd?: string) => object}>}
 */
export async function mountPlugin(opts = {}) {
  const root = new Context()
  const fibers = []
  const mount = async (plugin, config) => {
    fibers.push(await root.plugin(plugin, config))
  }
  const { facility, records, opened, specVersions } = makeDomainFacility({ mediumVersion: opts.mediumVersion })
  // 预置介质记录（v1/v2 形状均可；测试直接放进权威 Map，open 后立即可见）。
  for (const [key, record] of Object.entries(opts.seedRecords ?? {})) {
    records.set(key, record)
  }
  // storageDomain: false 模拟未组合存储栈的宿主（插件必须照常挂载并降级）。
  if (opts.storageDomain !== false) root.provide('storageDomain', facility)
  if (opts.userQuestions !== undefined) root.provide('userQuestions', opts.userQuestions)
  if (opts.approval !== undefined) root.provide('approval', opts.approval)
  if (opts.tools !== undefined) root.provide('tools', opts.tools)
  if (opts.systemPrompt !== undefined) root.provide('systemPrompt', opts.systemPrompt)
  await mount(SessionStore)
  await mount(CommandRuntime)
  const plugin = await import('../../index.mjs')
  // 默认关闭自动间隔快照（openStep 的 step/start 会触发）：既有测试断言的是
  // 变更安全网/手动路径的精确记录数；autoCheckpoint 相关行为在专门测试中显式开启。
  const config = {
    autoCheckpoint: { enabled: false },
    ...(opts.config ?? {}),
  }
  await mount(Object.assign({}, plugin, {
    // Config 走 cordis 的 config 注入：plugin 函数形式在 plugin() 下用第 0 号 config。
    // 直接用默认导出的 apply 手动挂载等价于 config 全默认；此处传入自定义 config。
    apply: (ctx) => plugin.apply(ctx, config),
  }))

  // 合成绝对路径（跨平台）：session 头校验要求绝对路径，Windows 风格 'C:/…'
  // 在 Linux 上只是相对路径。目录无需真实存在——快照 walk 读不到即得空快照。
  const cwd = opts.cwd ?? path.resolve('/work', 'proj')
  const session = root.sessions.create(SessionId(opts.sessionId ?? 'session-under-test'), { meta: { cwd } })
  const agent = { id: session.id, session }
  return {
    root,
    records,
    opened,
    specVersions,
    agent,
    session,
    makeSession: (dir = cwd) => {
      const s = root.sessions.create(undefined, { meta: { cwd: dir } })
      return { session: s, agent: { id: s.id, session: s } }
    },
    dispose: async () => {
      // Cordis 无 Context.dispose()：按逆序卸载各 plugin fiber（含插件自身 effect）。
      for (const fiber of fibers.reverse()) {
        await fiber.dispose()
      }
    },
  }
}

/**
 * 便捷断言辅助：等待插件内部领域操作链排空（命令执行前已自动排空，
 * 此处用于直接断言表内容前的稳定化）。
 * @returns {Promise<void>} 一个宏任务后完成。
 */
export async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 向会话追加一个完整步骤骨架（turn/start、step/start；不含消息内容）。
 * @param {object} session - 真实 Session。
 * @param {number} turn - turn 号。
 * @param {number} step - step 号。
 */
export function openStep(session, turn, step) {
  if (session.events.length === 0 || session.events.at(-1).type !== 'turn/start') {
    session.append('turn/start', { turn })
  }
  session.append('step/start', { turn, step })
}

/**
 * 关闭当前步骤/轮次。
 * @param {object} session - 真实 Session。
 * @param {number} turn - turn 号。
 * @param {number} step - step 号。
 * @param {boolean} [endTurn] - 同时关闭轮次。
 * @returns {number} 最后一个事件的 seq。
 */
export function closeStep(session, turn, step, endTurn = false) {
  const stepEnd = session.append('step/end', { turn, step })
  let seq = stepEnd.seq
  if (endTurn) {
    const turnEnd = session.append('turn/end', { turn, reason: { kind: 'completed' } })
    seq = turnEnd.seq
  }
  return seq
}

/**
 * 派发一次 fs/write-intent waterfall（模拟 dsh-tool-fs 的执行器路径）。
 * @param {Context} root - 挂载根。
 * @param {object} agent - {session}。
 * @param {string} toolName - 执行器工具名（write/edit/str_replace_editor）。
 * @returns {Promise<unknown>} 决策结果（无策略监听时 undefined）。
 */
export function dispatchWriteIntent(root, agent, toolName = 'write') {
  const exec = { agent, name: toolName, callId: `call-${Math.random().toString(36).slice(2)}`, signal: new AbortController().signal, arguments: {} }
  return root.waterfall('fs/write-intent', { key: 'target', path: 'x' }, exec, () => undefined)
}

/**
 * 派发一次 tools/pre-execute waterfall（模拟工具注册表策略管线）。
 * @param {Context} root - 挂载根。
 * @param {object} agent - {session}。
 * @param {string} toolName - 工具名。
 * @returns {Promise<unknown>} 决策结果。
 */
export function dispatchPreExecute(root, agent, toolName) {
  const exec = { agent, name: toolName, callId: `call-${Math.random().toString(36).slice(2)}`, signal: new AbortController().signal, arguments: {} }
  return root.waterfall('tools/pre-execute', exec, () => 'allow')
}
