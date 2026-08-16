// test/settings-schema.test.mjs — settings 命名空间 zod schema 与 Schemastery
// Config 的键一致性（Schema 配置双源：cordis.yml + 设置页），及语义校验。

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

describe('双源 schema 键一致（cordis.yml Schemastery ⇄ settings zod）', () => {
  it('zod schema 解析出与 resolveConfig 完全相同的顶层键集', () => {
    const zodKeys = Object.keys(checkpointSettingsSchema.parse({}))
    const entryKeys = Object.keys(resolveConfig({}))
    assert.deepEqual(zodKeys.sort(), entryKeys.sort())
  })

  it('zod 默认值与 entry 默认值一致（设置页与 cordis.yml 同源默认）', () => {
    const zodValue = checkpointSettingsSchema.parse({})
    const entryValue = resolveConfig({})
    for (const key of Object.keys(entryValue)) {
      assert.deepEqual(zodValue[key], entryValue[key], `default mismatch on ${key}`)
    }
  })

  it('settings 解析值能通过 entry 语义校验（validateCheckpointSettings）', () => {
    const value = checkpointSettingsSchema.parse({})
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

describe('validateCheckpointSettings（跨字段语义校验）', () => {
  const base = checkpointSettingsSchema.parse({})

  it('合法值通过', () => {
    assert.doesNotThrow(() => validateCheckpointSettings(base))
    assert.doesNotThrow(() => validateCheckpointSettings({ ...base, enabled: false })) // 未启用时不校验语义
  })

  it('非法 provider/confirmVia/workspaceRestore/preRewindCheckpoint 拒绝', () => {
    for (const patch of [
      { provider: 'rsync' },
      { confirmVia: 'silent' },
      { workspaceRestore: 'clean' },
      { preRewindCheckpoint: 'always' },
    ]) {
      assert.throws(() => validateCheckpointSettings({ ...base, ...patch }), /checkpoint-rewind settings:/)
    }
  })
})
