// test/lifecycle.test.mjs — HMR-safety（C1）与导出契约（C2）套件。
//
// C1：真实 Cordis + 真实 SessionStore/CommandRuntime/ToolRuntime + mock
// storageDomain/systemPrompt 组装；保存贡献 fiber，释放后重查权威注册表，
// 断言 /rewind、/checkpoint 命令与 checkpoint 工具随 fiber 撤销消失。
// C2：模块命名空间无 default 导出，且 Loader.unwrapExports 往返返回同一命名空间
// （bundle 插件在无 inject 场景下的唯一防线）。
// @module dsh-checkpoint-rewind/test/lifecycle.test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as plugin from '../index.mjs'
import { makeDomainFacility } from './helpers/ctx-harness.mjs'

/** 结构化完整假 agent（覆盖真实 session）。 */
function makeAgent(/** @type {any} */ session) {
  return {
    id: session.id,
    options: { provider: 'deepseek', model: 'demo-model' },
    session,
    inbox: {},
    status: 'idle',
    ctx: new Context(),
    cancel: () => undefined,
    whenIdle: async () => undefined,
    runMaintenance: async (/** @type {(signal: AbortSignal) => Promise<unknown>} */ task) => task(new AbortController().signal),
    send: () => undefined,
    followup: () => undefined,
    steer: () => undefined,
    inject: () => undefined,
  }
}

/** 组装真实 Cordis 上下文（含真实 commands/tools 注册表与 mock 存储领域）。 */
async function mountHarness(config = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  // A real platform-absolute path: a Windows-style literal reads as relative
  // on POSIX runners and the session header rejects it at mount.
  const session = ctx.sessions.create(SessionId('dsh-checkpoint-rewind-lifecycle'), { meta: { cwd: resolve('work/proj') } })
  ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined })
  ctx.provide('storageDomain', makeDomainFacility().facility)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  const agent = /** @type {any} */ (makeAgent(session))
  const pluginFiber = await ctx.plugin(plugin, config)
  return { ctx, session, agent, pluginFiber }
}

// ---------------------------------------------------------------------------
// C2：函数插件命名空间必须经 Loader 解包往返
// ---------------------------------------------------------------------------

test('module carries no default export and Loader unwrap round-trips the namespace', () => {
  assert.equal('default' in plugin, false)
  const loader = Object.create(Loader.prototype)
  const unwrapped = loader.unwrapExports(plugin)
  assert.equal(unwrapped, plugin)
  assert.equal(unwrapped.name, 'checkpoint-rewind')
  assert.deepEqual(unwrapped.inject, ['sessions', 'commands'])
  assert.ok(unwrapped.Config !== undefined)
  assert.equal(typeof unwrapped.apply, 'function')
})

// ---------------------------------------------------------------------------
// C1：释放贡献 fiber 后，权威注册表里 /rewind、/checkpoint 与 checkpoint 工具消失
// ---------------------------------------------------------------------------

test('disposing the contributing fiber removes /rewind, /checkpoint and the checkpoint tool', async () => {
  const harness = await mountHarness()
  try {
    const before = harness.ctx.commands.list(harness.agent).map((entry) => entry.name)
    assert.ok(before.includes('rewind'))
    assert.ok(before.includes('checkpoint'))
    assert.ok(harness.ctx.tools.get('checkpoint') !== undefined)

    await harness.pluginFiber.dispose()

    const after = harness.ctx.commands.list(harness.agent).map((entry) => entry.name)
    assert.equal(after.includes('rewind'), false, '/rewind should disappear after fiber dispose')
    assert.equal(after.includes('checkpoint'), false, '/checkpoint should disappear after fiber dispose')
    assert.equal(harness.ctx.tools.get('checkpoint'), undefined, 'checkpoint tool should disappear after fiber dispose')
  } finally {
    await harness.ctx.fiber.dispose()
  }
})
