// test/no-storage.test.mjs — 无 storageDomain 组装：插件必须照常挂载（绝不把
// profile 卡在 pending），checkpoint/rewind 命令路径返回结构化错误并说明组合
// 存储栈的方法，自动快照/补记/清理等事件路径静默降级（只记日志、绝不抛出）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mountPlugin, openStep, closeStep, settle } from './helpers/ctx-harness.mjs'

function command(app, line) {
  return app.root.commands.execute(app.agent, line, [], new AbortController().signal)
}

describe('storageDomain 未组合（可选服务降级）', () => {
  it('插件照常挂载：inject 只声明 sessions/commands，/rewind 与 /checkpoint 仍在', async () => {
    const { inject } = await import('../index.mjs')
    assert.deepEqual(inject, ['sessions', 'commands'])
    const app = await mountPlugin({ storageDomain: false })
    const listed = app.root.commands.list(app.agent)
    assert.ok(listed.some((entry) => entry.name === 'rewind'))
    assert.ok(listed.some((entry) => entry.name === 'checkpoint'))
    await app.dispose()
  })

  it('/rewind 返回结构化错误并提示组合存储栈', async () => {
    const app = await mountPlugin({ storageDomain: false })
    const result = await command(app, '/rewind')
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /storageDomain/)
    assert.match(result?.result.text, /dsh-storage-domain/)
    await app.dispose()
  })

  it('/checkpoint list 返回结构化错误并提示组合存储栈', async () => {
    const app = await mountPlugin({ storageDomain: false })
    const result = await command(app, '/checkpoint list')
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /storageDomain/)
    await app.dispose()
  })

  it('事件钩子（自动快照/边界补记/清理）在无存储时静默降级，不抛出不阻塞', async () => {
    const app = await mountPlugin({ storageDomain: false, config: { autoCheckpoint: { enabled: true } } })
    openStep(app.session, 1, 1)
    await settle()
    closeStep(app.session, 1, 1, true)
    await settle()
    // 事件路径未抛出；命令路径仍返回结构化的"不可用"错误（失败大声）。
    const result = await command(app, '/rewind')
    assert.equal(result?.result.kind, 'error')
    assert.match(result?.result.text, /storageDomain/)
    await app.dispose()
  })
})
