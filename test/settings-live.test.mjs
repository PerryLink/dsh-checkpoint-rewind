// test/settings-live.test.mjs — 0.1.7-alpha.1 settings 契约反转后的活配置与
// 配置写回行为。
//
// 新宿主（SettingsForms）：Config 的 volatile 字段由宿主就地更新引用，插件不
// 重挂、不注册、不 watch —— 读值必须走 getLive()；/rewind config 经
// settings.replace(条目 id, 段) 写回 profile patch。
// 旧宿主（<= 0.1.6-alpha.2，SettingsProvider）：register/watch 注册面照旧；注册
// 必须拿到未标 volatile 的同形 schema。
//
// 本机装的 schemastery 3.18.2 没有 .volatile()（宿主行 3.18.3 才有），所以引用
// 形态在这里用合成引用构造——判据与 cosmokit 的 isVolatile 同符号，正是运行时
// 探测的那一个。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mountPlugin, openStep, dispatchPreExecute } from './helpers/ctx-harness.mjs'
import { resolveConfig } from '../index.mjs'
import { checkpointLegacySettingsSchema, checkpointSettingsNamespace } from '../lib/settings-schema.mjs'

/** cosmokit 的共享 volatile 写协议符号（宿主就地更新引用用它）。 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** 合成 cosmokit 形态的 Volatile 引用。 @param {unknown} value */
function volatileRef(value) {
  let current = value
  return {
    get: () => current,
    [VOLATILE_WRITE]: (/** @type {unknown} */ next) => { current = next },
  }
}

/**
 * 把纯值配置包成新宿主交给 apply 的形态：每个字段一个 Volatile 引用
 * （与 0.1.7-alpha.1 宿主 resolveConfig 的输出同形）。
 * @param {Record<string, any>} values
 */
function volatileConfig(values) {
  /** @type {Record<string, any>} */
  const refs = {}
  /** @type {Record<string, any>} */
  const config = {}
  for (const [key, value] of Object.entries(values)) {
    if (key === 'autoCheckpoint') {
      refs[key] = { enabled: volatileRef(value.enabled), intervalMinutes: volatileRef(value.intervalMinutes) }
    } else {
      refs[key] = volatileRef(value)
    }
    config[key] = refs[key]
  }
  return { config, refs }
}

/** 覆盖一个 volatile 字段（模拟宿主提交设置页编辑）。 @param {any} ref @param {unknown} next */
function commitRef(ref, next) {
  ref[VOLATILE_WRITE](next)
}

/** @param {Record<string, string>} files */
async function makeWorkspace(files) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-ws-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(cwd, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content)
  }
  return cwd
}

async function makeSnapDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-snaps-'))
}

/** 快照是否落在该根下（快照目录 = <root>/<workspaceKey>/<id>/）。 @param {string} root @param {string} ref */
async function hasSnapshotUnder(root, ref) {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
  return entries.some(entry => entry.isDirectory() && entry.name === ref)
}

function approvingQuestions() {
  return {
    async ask() {
      return { answers: [{ id: 'rewind-confirm', selected: ['Restore', 'Restore files', 'Replay session', 'Restore config'] }] }
    },
  }
}

/** @param {Map<string, any>} table @param {number} count @param {number} [timeoutMs] */
async function waitForRecords(table, count, timeoutMs = 15000) {
  return waitForRecordsFor(table, 'session-under-test', count, timeoutMs)
}

/** @param {Map<string, any>} table @param {string} sessionId @param {number} count @param {number} [timeoutMs] */
async function waitForRecordsFor(table, sessionId, count, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  const mine = () => [...table.entries()].filter(([, record]) => record.sessionId === sessionId)
  while (Date.now() < deadline) {
    if (mine().length >= count) return mine()
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${count} records (have ${mine().length})`)
}

/** @param {any} app @param {string} line */
function command(app, line) {
  return app.root.commands.execute(app.agent, line, [], new AbortController().signal)
}

describe('resolveConfig 读取 volatile 包装的配置', () => {
  it('每个字段都经 .get() 解包（0.1.7+ 宿主形态）', () => {
    const { config } = volatileConfig({
      enabled: true,
      provider: 'git',
      maxSnapshots: 7,
      listLimit: 3,
      confirmVia: 'approval',
      selectiveRestore: false,
      mutationTools: ['bash'],
      autoCheckpoint: { enabled: true, intervalMinutes: 15 },
    })
    const resolved = resolveConfig(/** @type {any} */ (config))
    assert.equal(resolved.provider, 'git')
    assert.equal(resolved.maxSnapshots, 7)
    assert.equal(resolved.listLimit, 3)
    assert.equal(resolved.confirmVia, 'approval')
    assert.equal(resolved.selectiveRestore, false)
    assert.deepEqual(resolved.mutationTools, ['bash'])
    assert.deepEqual(resolved.autoCheckpoint, { enabled: true, intervalMinutes: 15 })
    assert.equal(resolved.snapshotDir, '', '未提供的字段仍补齐默认')
  })

  it('纯值配置（旧宿主 / 直接调用）行为不变', () => {
    const resolved = resolveConfig({ provider: 'copy', maxSnapshots: 9 })
    assert.equal(resolved.provider, 'copy')
    assert.equal(resolved.maxSnapshots, 9)
  })
})

describe('活配置：设置页编辑就地生效（不重挂插件）', () => {
  it('mutationTools 引用更新后，新工具名立即触发快照', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const { config, refs } = volatileConfig({
      provider: 'copy',
      snapshotDir,
      mutationTools: ['bash'],
      autoCheckpoint: { enabled: false, intervalMinutes: 0 },
    })
    const app = await mountPlugin({ cwd, config })
    openStep(app.session, 1, 1)

    await dispatchPreExecute(app.root, app.agent, 'terminal_send')
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(app.records.size, 0, '不在 mutationTools 里的工具不触发快照')

    // 设置页编辑：宿主就地更新引用（插件 fiber 未重挂）。
    commitRef(refs.mutationTools, ['terminal_send'])
    await dispatchPreExecute(app.root, app.agent, 'terminal_send')
    const records = await waitForRecords(app.records, 1)
    assert.equal(records[0][1].triggerTool, 'terminal_send')
    await app.dispose()
  })

  it('snapshotDir 引用更新后按新目录落盘（解析缓存失效）', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const first = await makeSnapDir()
    const second = await makeSnapDir()
    const { config, refs } = volatileConfig({
      provider: 'copy',
      snapshotDir: first,
      autoCheckpoint: { enabled: false, intervalMinutes: 0 },
    })
    const app = await mountPlugin({ cwd, config })
    openStep(app.session, 1, 1)
    await dispatchPreExecute(app.root, app.agent, 'write')
    const [firstRecord] = await waitForRecords(app.records, 1)
    const firstRef = /** @type {string} */ (firstRecord[1].ref)
    assert.equal(await hasSnapshotUnder(first, firstRef), true, '首个快照落在原目录')

    // 设置页编辑 snapshotDir；新会话（无去重基线）在更新后的目录落盘 —— 若解析
    // 缓存未失效，仍会写进原目录。
    commitRef(refs.snapshotDir, second)
    const other = app.makeSession(cwd)
    openStep(other.session, 1, 1)
    await dispatchPreExecute(app.root, other.agent, 'write')
    const records = await waitForRecordsFor(app.records, other.session.id, 1)
    const secondRef = /** @type {string} */ (records[0][1].ref)
    assert.equal(await hasSnapshotUnder(second, secondRef), true, '新快照落在更新后的目录')
    assert.equal(await hasSnapshotUnder(first, secondRef), false, '原目录不再增长')
    await app.dispose()
  })
})

describe('/rewind config 写回（两代宿主各自的写回面）', () => {
  it('新宿主：settings.replace(条目 id, 段) 持久写回 profile patch', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    /** @type {Array<[string, object|undefined]>} */
    const calls = []
    const settings = {
      async replace(/** @type {string} */ ns, /** @type {object} */ section, /** @type {number|undefined} */ revision) {
        calls.push([ns, section])
        assert.equal(revision, undefined, '不传 revision 时不带修订栅栏')
      },
    }
    const app = await mountPlugin({
      cwd,
      userQuestions: approvingQuestions(),
      settings,
      config: { provider: 'copy', snapshotDir, autoCheckpoint: { enabled: false, intervalMinutes: 0 } },
    })
    openStep(app.session, 1, 1)
    await dispatchPreExecute(app.root, app.agent, 'write')
    const [record] = await waitForRecords(app.records, 1)
    const result = await command(app, `/rewind config ${record[1].id}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /config: config restored through the settings forms \(persisted in the profile patch\)/)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], checkpointSettingsNamespace(), '按条目 id 寻址')
    assert.equal(/** @type {any} */ (calls[0][1]).provider, 'copy', '写回的是检查点 config 快照')
    await app.dispose()
  })

  it('旧宿主：注册面照旧，且注册 schema 未标 volatile', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    /** @type {any[]} */
    const registered = []
    /** @type {object[]} */
    const replaced = []
    const baseValue = { ...resolveConfig({ provider: 'copy', snapshotDir }), autoCheckpoint: { enabled: false, intervalMinutes: 0 } }
    const settings = {
      register(/** @type {string} */ ns, /** @type {any} */ schema, /** @type {any} */ options) {
        registered.push({ ns, schema, options })
        return {
          get: () => baseValue,
          watch: () => () => {},
          replace: async (/** @type {object} */ section) => { replaced.push(section) },
        }
      },
    }
    const app = await mountPlugin({
      cwd,
      userQuestions: approvingQuestions(),
      settings,
      config: { provider: 'copy', snapshotDir, autoCheckpoint: { enabled: false, intervalMinutes: 0 } },
    })
    assert.equal(registered.length, 1, '旧宿主上注册一次')
    assert.equal(registered[0].ns, checkpointSettingsNamespace())
    assert.equal(registered[0].schema, checkpointLegacySettingsSchema, '旧 provider 拿到未标 volatile 的副本')
    assert.equal(registered[0].options.expose, true)
    assert.equal(registered[0].options.applies, 'live')
    assert.equal(registered[0].options.base.provider, 'copy')

    openStep(app.session, 1, 1)
    await dispatchPreExecute(app.root, app.agent, 'write')
    const [record] = await waitForRecords(app.records, 1)
    const result = await command(app, `/rewind config ${record[1].id}`)
    assert.equal(result?.result.kind, 'success')
    assert.match(result?.result.text, /config: config restored through the settings namespace/)
    assert.equal(replaced.length, 1)
    await app.dispose()
  })
})
