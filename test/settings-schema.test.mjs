// test/settings-schema.test.mjs — settings 命名空间 Schemastery schema 与
// index.mjs Schemastery Config 的键一致性（Schema 配置双源：cordis.yml +
// 设置页），及语义校验。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Config, resolveConfig } from '../index.mjs'
import {
  checkpointSettingsNamespace,
  checkpointSettingsSchema,
  validateCheckpointSettings,
} from '../lib/settings-schema.mjs'

describe('checkpointSettingsNamespace', () => {
  it('命名空间为合法小写 kebab-case', () => {
    assert.equal(checkpointSettingsNamespace(), 'checkpoint-rewind')
    assert.match(checkpointSettingsNamespace(), /^[a-z][a-z0-9-]*$/)
  })
})

describe('双源 schema 键一致（cordis.yml Config ⇄ settings schema）', () => {
  it('settings schema 是可调用的 Schemastery schema（宿主 settings 服务直接调用）', () => {
    assert.equal(typeof checkpointSettingsSchema, 'function')
  })

  it('settings schema 解析出与 resolveConfig 完全相同的顶层键集', () => {
    const settingsKeys = Object.keys(checkpointSettingsSchema({}))
    const entryKeys = Object.keys(resolveConfig({}))
    assert.deepEqual(settingsKeys.sort(), entryKeys.sort())
  })

  it('settings 默认值与 entry 默认值一致（设置页与 cordis.yml 同源默认）', () => {
    const settingsValue = checkpointSettingsSchema({})
    const entryValue = resolveConfig({})
    for (const key of Object.keys(entryValue)) {
      assert.deepEqual(settingsValue[key], entryValue[key], `default mismatch on ${key}`)
    }
  })

  it('settings 解析值能通过 entry 语义校验（validateCheckpointSettings）', () => {
    const value = checkpointSettingsSchema({})
    assert.doesNotThrow(() => validateCheckpointSettings(value))
  })

  it('Config schema 加载期仍校验非法值（settings 之外的响亮失败面）', () => {
    assert.throws(() => resolveConfig({ workspaceRestore: 'clean' }), /workspaceRestore/)
    assert.throws(() => resolveConfig({ autoCheckpoint: { intervalMinutes: -1 } }), /intervalMinutes/)
    assert.throws(() => resolveConfig({ autoCheckpoint: { enabled: 'yes' } }), /autoCheckpoint\.enabled/)
    assert.throws(() => resolveConfig({ promptSection: 1 }), /promptSection/)
    assert.throws(() => resolveConfig({ checkpointTool: 1 }), /checkpointTool/)
  })
})

describe('validateCheckpointSettings（跨字段与边界语义校验）', () => {
  const base = checkpointSettingsSchema({})

  it('合法值通过', () => {
    assert.doesNotThrow(() => validateCheckpointSettings(base))
    assert.doesNotThrow(() => validateCheckpointSettings({ ...base, enabled: false })) // 未启用时不校验模式枚举
  })

  it('非法 provider/confirmVia/workspaceRestore/preRewindCheckpoint/diffRenderer 拒绝', () => {
    for (const patch of [
      { provider: 'rsync' },
      { confirmVia: 'silent' },
      { workspaceRestore: 'clean' },
      { preRewindCheckpoint: 'always' },
      { diffRenderer: 'split' },
    ]) {
      assert.throws(() => validateCheckpointSettings({ ...base, ...patch }), /checkpoint-rewind settings:/)
    }
  })

  it('边界非法值被 validateCheckpointSettings 拒绝（schema 不含边界约束，语义集中在验证器）', () => {
    for (const patch of [
      { maxSnapshots: 0 },
      { maxSnapshots: 1.5 },
      { maxSnapshotBytes: 100 },
      { maxSnapshotFiles: 0 },
      { snapshotTimeoutMs: 0 },
      { listLimit: 0 },
      { listLimit: 99999 },
      { gitBin: '' },
      { mutationTools: [''] },
      { excludeGlobs: [''] },
      { autoCheckpoint: { enabled: true, intervalMinutes: -1 } },
      { autoCheckpoint: { enabled: true, intervalMinutes: 99999 } },
    ]) {
      const parsed = checkpointSettingsSchema(patch)
      assert.throws(() => validateCheckpointSettings(parsed), /checkpoint-rewind settings:/)
    }
    assert.throws(() => validateCheckpointSettings({ ...base, snapshotDir: 123 }), /checkpoint-rewind settings:/)
  })

  it('enabled:false 时边界校验仍生效（与 zod parse 期语义等价）', () => {
    for (const patch of [
      { maxSnapshots: 0 },
      { listLimit: 99999 },
      { autoCheckpoint: { enabled: false, intervalMinutes: -1 } },
      { gitBin: '' },
      { mutationTools: [''] },
    ]) {
      assert.throws(() => validateCheckpointSettings({ ...base, enabled: false, ...patch }), /checkpoint-rewind settings:/)
    }
  })
})
