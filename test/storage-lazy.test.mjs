// test/storage-lazy.test.mjs — storageDomain 挂载时序竞态回归
// （dev/handoff-storageDomain-race.md）：插件 apply 先于 storage-domain 行注册
// 服务完成时，注册表必须经惰性 getter 在首次使用时解析服务——服务就绪后捕获
// 正常落盘，绝不一次性捕获成永久不可用（一切快照静默失败）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mountPlugin, openStep, dispatchWriteIntent } from './helpers/ctx-harness.mjs'

function command(app, line) {
  return app.root.commands.execute(app.agent, line, [], new AbortController().signal)
}

async function makeWorkspace(files) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-lazy-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(cwd, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content)
  }
  return cwd
}

/** 轮询等待表内记录数（捕获经领域写链异步落盘）。 */
async function waitForRecords(records, count, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hits = [...records.entries()].filter(([, record]) => record.sessionId === 'session-under-test')
    if (hits.length >= count) return hits
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${count} records (have ${records.size})`)
}

describe('storageDomain 晚于插件 apply 提供（挂载时序竞态回归）', () => {
  it('apply 时服务缺失、首次使用时已就绪：快照捕获正常落盘', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-rewind-lazy-snaps-'))
    // storageDomain: 'late' —— 插件 apply 完成后再提供服务（模拟 sibling 行
    // 挂载时序：dsh-storage-domain 的 apply 异步，rewind 行抢先完成）。
    const app = await mountPlugin({ cwd, config: { provider: 'copy', snapshotDir }, storageDomain: 'late' })
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    const records = await waitForRecords(app.records, 1)
    assert.equal(records[0][1].provider, 'copy')
    assert.equal(records[0][1].triggerTool, 'fs/write-intent')
    await app.dispose()
  })

  it('晚提供的服务同样经 /rewind 列表路径可用（非结构化错误）', async () => {
    const app = await mountPlugin({ storageDomain: 'late' })
    const result = await command(app, '/rewind')
    assert.equal(result?.result.kind, 'success')
    await app.dispose()
  })
})
