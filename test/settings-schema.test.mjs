// test/settings-schema.test.mjs — settings 命名空间 Schemastery schema 与
// Schemastery Config 的键一致性（Schema 配置双源：cordis.yml + 设置页），
// 及语义校验。

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

describe('双源 schema 键一致（cordis.yml Schemastery ⇄ settings Schemastery）', () => {
  it('schema 是可调用函数（宿主 settings 服务当函数调用的 B4 判据）', () => {
    assert.equal(typeof checkpointSettingsSchema, 'function')
    // 真实调用并产生规范化输出（不是 zod 实例那种不可调用的对象）。
    const value = checkpointSettingsSchema({})
    assert.equal(typeof value.enabled, 'boolean')
  })

  it('schema 解析出与 resolveConfig 完全相同的顶层键集', () => {
    const schemaKeys = Object.keys(checkpointSettingsSchema({}))
    const entryKeys = Object.keys(resolveConfig({}))
    assert.deepEqual(schemaKeys.sort(), entryKeys.sort())
  })

  it('schema 默认值与 entry 默认值一致（设置页与 cordis.yml 同源默认）', () => {
    const schemaValue = /** @type {Record<string, unknown>} */ (checkpointSettingsSchema({}))
    const entryValue = /** @type {Record<string, unknown>} */ (resolveConfig({}))
    for (const key of Object.keys(entryValue)) {
      assert.deepEqual(schemaValue[key], entryValue[key], `default mismatch on ${key}`)
    }
  })

  it('settings 解析值能通过 entry 语义校验（validateCheckpointSettings）', () => {
    const value = checkpointSettingsSchema({})
    assert.doesNotThrow(() => validateCheckpointSettings(value))
  })

  it('Config schema 加载期仍校验非法值（settings 之外的响亮失败面）', () => {
    // 非法值负例：类型上按 any 传入（这些正是要证明会被加载期校验拒绝的值）。
    assert.throws(() => resolveConfig(/** @type {any} */ ({ workspaceRestore: 'clean' })), /workspaceRestore/)
    assert.throws(() => resolveConfig(/** @type {any} */ ({ autoCheckpoint: { intervalMinutes: -1 } })), /intervalMinutes/)
    assert.throws(() => resolveConfig(/** @type {any} */ ({ autoCheckpoint: { enabled: 'yes' } })), /autoCheckpoint\.enabled/)
    assert.throws(() => resolveConfig(/** @type {any} */ ({ promptSection: 1 })), /promptSection/)
    assert.throws(() => resolveConfig(/** @type {any} */ ({ checkpointTool: 1 })), /checkpointTool/)
  })
})

describe('validateCheckpointSettings（跨字段语义校验）', () => {
  const base = checkpointSettingsSchema({})

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
