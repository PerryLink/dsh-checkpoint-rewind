// test/medium-compat.test.mjs — 'checkpoints' 存储介质版本兼容（回归）：
// 0.5.x 是域 v2 生产者（kind/config 必填），而 0.4.x 时代的介质是 v1
// （可选 forkSeq）。存储后端（@deepseek-ai/dsh-storage-json）对版本不匹配
// 抛 version-mismatch 且无自动迁移——0.5.3 在 v1 介质上打开失败，检查点捕获
// 静默失效（已有会话 records 不再增长）。
// 本套件验证双版本打开策略：v2 先试、version-mismatch 回退 v1 容错 spec；
// 旧记录照常可读、新捕获按 v2 形状写入同一介质、新介质仍创建 v2。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { checkpointRecordSchema, checkpointRecordSchemaCompat } from '../lib/domain.mjs'
import { mountPlugin, openStep, dispatchWriteIntent } from './helpers/ctx-harness.mjs'

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

/** 轮询等待表内记录数（插件内部领域操作异步落盘）。 */
async function waitForRecords(table, count, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const records = [...table.entries()].filter(([, record]) => record.sessionId === 'session-under-test')
    if (records.length >= count) return records
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const records = [...table.entries()].filter(([, record]) => record.sessionId === 'session-under-test')
  throw new Error(`timed out waiting for ${count} records (have ${records.length})`)
}

function command(app, line) {
  return app.root.commands.execute(app.agent, line, [], new AbortController().signal)
}

/** 0.4.x 时代的 v1 记录形状：核心字段 + 可选 forkSeq，无 kind/config。 */
function v1RecordOf(cwd) {
  return {
    id: 'v1-record-0001',
    sessionId: 'session-under-test',
    cwd,
    seq: 1,
    time: Date.now() - 60000,
    provider: 'git',
    triggerTool: 'write',
    turn: 1,
    step: 1,
    files: 1,
    bytes: 4,
    ref: 'a'.repeat(40),
    forkSeq: 0,
  }
}

/** 0.5.x 的记录形状：核心字段 + kind/config 必填（git provider，含 tree）。 */
function v2RecordOf(cwd) {
  return {
    id: 'v2-record-0001',
    sessionId: 'session-under-test',
    cwd,
    seq: 1,
    time: Date.now() - 60000,
    provider: 'git',
    kind: 'mutation',
    triggerTool: 'write',
    turn: 1,
    step: 1,
    files: 1,
    bytes: 4,
    ref: 'b'.repeat(40),
    tree: 'c'.repeat(40),
    config: { provider: 'git' },
  }
}

describe('介质记录 schema（纯 zod）', () => {
  it('容错超集 schema 接受 v1 记录（无 kind/config、带 forkSeq）', () => {
    const record = v1RecordOf('/work/proj')
    assert.equal(checkpointRecordSchemaCompat.safeParse(record).success, true)
  })

  it('容错超集 schema 接受 v2 记录（kind/config 必填形状）', () => {
    const record = v2RecordOf('/work/proj')
    assert.equal(checkpointRecordSchemaCompat.safeParse(record).success, true)
  })

  it('严格 v2 schema 拒绝 v1 记录（kind/config 缺失）——v2 生产契约不变', () => {
    const record = v1RecordOf('/work/proj')
    assert.equal(checkpointRecordSchema.safeParse(record).success, false)
  })

  it('容错超集 schema 拒绝缺核心字段的记录', () => {
    const record = v2RecordOf('/work/proj')
    delete record.seq
    assert.equal(checkpointRecordSchemaCompat.safeParse(record).success, false)
  })
})

describe('存储介质版本兼容（回归：0.5.3 打不开 v1 介质）', () => {
  it('v1 介质回退 v1 容错 spec：旧记录可读，新捕获按 v2 形状落盘', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const seed = v1RecordOf(cwd)
    const app = await mountPlugin({
      cwd,
      mediumVersion: 1,
      seedRecords: { [seed.id]: seed },
      config: { provider: 'auto', snapshotDir },
    })
    // v2 打开被 version-mismatch 拒绝 → 回退 v1：域只以版本 1 打开过一次。
    assert.deepEqual(app.specVersions, [1])

    // 旧记录立即可读：列表包含 v1 记录，kind 缺失降级为 [mutation]。
    const list0 = await command(app, '/checkpoint list')
    assert.equal(list0?.result.kind, 'success')
    assert.match(list0?.result.text, /checkpoint: 1 checkpoint/)
    assert.match(list0?.result.text, /\[mutation\]/)
    assert.match(list0?.result.text, /\(git\)/)

    // 捕获恢复：变更工具触发，新记录为 v2 形状（kind/config 落盘）。
    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    const records = await waitForRecords(app.records, 2)
    const oldRecord = records.find(([, record]) => record.id === seed.id)[1]
    const fresh = records.find(([, record]) => record.id !== seed.id)[1]
    assert.equal(oldRecord.kind, undefined, '旧 v1 记录原样保留')
    assert.equal(oldRecord.forkSeq, 0)
    assert.equal(fresh.kind, 'mutation')
    assert.equal(typeof fresh.config, 'object')
    assert.equal(fresh.config.provider, 'auto', 'config 快照 = 挂载配置（auto 模式）')
    assert.equal(fresh.forkSeq, undefined, '新记录不带 v1 字段')

    // 手动 /checkpoint 同样恢复（先改文件避免与上一记录去重）。
    await fs.writeFile(path.join(cwd, 'a.txt'), 'A22')
    const manual = await command(app, '/checkpoint')
    assert.equal(manual?.result.kind, 'success')
    assert.match(manual?.result.text, /checkpoint: captured #/)
    assert.match(manual?.result.text, /config snapshot: \d+ key\(s\)/)
    await app.dispose()
  })

  it('v2 介质（0.5.x 已创建）打开为 v2，无回退', async () => {
    const cwd = await makeWorkspace({ 'a.txt': 'A1' })
    const snapshotDir = await makeSnapDir()
    const seed = v2RecordOf(cwd)
    const app = await mountPlugin({
      cwd,
      mediumVersion: 2,
      seedRecords: { [seed.id]: seed },
      config: { provider: 'auto', snapshotDir },
    })
    assert.deepEqual(app.specVersions, [2])

    openStep(app.session, 1, 1)
    await dispatchWriteIntent(app.root, app.agent, 'write')
    const records = await waitForRecords(app.records, 2)
    const fresh = records.find(([, record]) => record.id !== seed.id)[1]
    assert.equal(fresh.kind, 'mutation')
    assert.equal(typeof fresh.config, 'object')
    await app.dispose()
  })

  it('新介质（不存在）创建为 v2', async () => {
    const app = await mountPlugin({})
    assert.deepEqual(app.specVersions, [2])
    await app.dispose()
  })
})
