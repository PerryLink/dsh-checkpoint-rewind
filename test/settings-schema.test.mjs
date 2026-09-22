// test/settings-schema.test.mjs — 'checkpoint-rewind' 配置 schema（单一真源）：
// volatile 标记、数值边界、以及纯函数跨字段校验。
//
// 0.1.7-alpha.1 起宿主删除了 settings 注册面，Config schema 直接就是设置页
// 表单 schema（只有 volatile 字段进表单），所以「双源一致」不再需要断言——
// 双源已合一，本文件改为断言合一后的契约。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Config, resolveConfig } from '../index.mjs'
import {
  checkpointLegacySettingsSchema,
  checkpointSettingsNamespace,
  checkpointSettingsSchema,
  validateCheckpointSettings,
} from '../lib/settings-schema.mjs'

describe('checkpointSettingsNamespace', () => {
  it('命名空间为合法小写 kebab-case（也是 Loader 条目 id 约定）', () => {
    assert.equal(checkpointSettingsNamespace(), 'checkpoint-rewind')
    assert.match(checkpointSettingsNamespace(), /^[a-z][a-z0-9-]*$/)
  })
})

/**
 * schema 解析值 → 纯值：标了 volatile 的字段在 3.18.3+ 上是 Volatile 引用
 * （宿主就地更新），比对/校验前必须先 .get()。
 * @param {unknown} value - schema 解析值。
 * @returns {any} 纯值。
 */
function plain(value) {
  if (Array.isArray(value)) return value.map(plain)
  if (value !== null && typeof value === 'object') {
    if (typeof (/** @type {any} */ (value)).get === 'function') return plain(/** @type {any} */ (value).get())
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)]))
  }
  return value
}

describe('Config schema = 设置页表单 schema（单一真源）', () => {
  it('插件导出的 Config 就是该 schema（宿主按条目读取 runtime.Config）', () => {
    assert.equal(Config, checkpointSettingsSchema)
  })

  it('schema 是可调用函数（宿主把 schema 当函数调用）', () => {
    assert.equal(typeof checkpointSettingsSchema, 'function')
    const value = /** @type {any} */ (checkpointSettingsSchema({}))
    assert.equal(typeof value.enabled.get, 'function', 'volatile 字段解析为引用')
    assert.equal(typeof value.enabled.get(), 'boolean')
  })

  it('schema 解析出与 resolveConfig 完全相同的顶层键集与默认值', () => {
    const schemaValue = /** @type {Record<string, unknown>} */ (plain(checkpointSettingsSchema({})))
    const entryValue = /** @type {Record<string, unknown>} */ (resolveConfig({}))
    assert.deepEqual(Object.keys(schemaValue).sort(), Object.keys(entryValue).sort())
    for (const key of Object.keys(entryValue)) {
      assert.deepEqual(schemaValue[key], entryValue[key], `default mismatch on ${key}`)
    }
  })

  it('resolveConfig 直接吃 schema 解析出的 volatile 配置（真引用，非合成）', () => {
    const resolved = resolveConfig(/** @type {any} */ (checkpointSettingsSchema({ provider: 'git', maxSnapshots: 3 })))
    assert.equal(resolved.provider, 'git')
    assert.equal(resolved.maxSnapshots, 3)
    assert.equal(resolved.snapshotDir, '', '未提供的字段仍补齐默认')
  })

  it('schema 解析值（解包 volatile 后）能通过跨字段语义校验', () => {
    assert.doesNotThrow(() => validateCheckpointSettings(plain(checkpointSettingsSchema({}))))
  })

  it('每个用户可配置字段都标了 volatile（宿主只把 volatile 字段投影进设置页）', () => {
    const dict = /** @type {Record<string, any>} */ (/** @type {any} */ (checkpointSettingsSchema).dict)
    assert.ok(Object.keys(dict).length > 0, 'schema 有字段')
    for (const [key, field] of Object.entries(dict)) {
      if (key === 'autoCheckpoint') {
        for (const [nested, child] of Object.entries(/** @type {Record<string, any>} */ (field.dict))) {
          assert.equal(child.meta?.volatile, true, `autoCheckpoint.${nested} 必须 volatile`)
        }
        continue
      }
      assert.equal(field.meta?.volatile, true, `${key} 必须 volatile`)
    }
  })

  it('旧宿主注册面用同形但未标 volatile 的副本（旧 provider 会把 schema 当函数调用）', () => {
    const volatileDict = /** @type {Record<string, any>} */ (/** @type {any} */ (checkpointSettingsSchema).dict)
    const legacyDict = /** @type {Record<string, any>} */ (/** @type {any} */ (checkpointLegacySettingsSchema).dict)
    assert.deepEqual(Object.keys(legacyDict).sort(), Object.keys(volatileDict).sort())
    for (const [key, field] of Object.entries(legacyDict)) {
      assert.equal(field.meta?.volatile, undefined, `${key} 在旧宿主 schema 上不得标 volatile`)
    }
    assert.deepEqual(checkpointLegacySettingsSchema({}), plain(checkpointSettingsSchema({})))
  })

  it('宿主在持久化前就能拒绝越界值（边界/整数性写在 schema 上）', () => {
    assert.throws(() => checkpointSettingsSchema({ listLimit: 999 }), /listLimit/)
    assert.throws(() => checkpointSettingsSchema({ maxSnapshots: 1.5 }), /maxSnapshots/)
    assert.throws(() => checkpointSettingsSchema({ autoCheckpoint: { intervalMinutes: -1 } }), /intervalMinutes/)
    assert.throws(() => checkpointSettingsSchema({ gitBin: '' }), /gitBin/)
    assert.throws(() => checkpointSettingsSchema({ provider: 'rsync' }), /provider/)
  })

  it('resolveConfig 仍校验非法值（settings 之外的响亮失败面）', () => {
    // 非法值负例：类型上按 any 传入（这些正是要证明会被加载期校验拒绝的值）。
    assert.throws(() => resolveConfig(/** @type {any} */ ({ workspaceRestore: 'clean' })), /workspaceRestore/)
    assert.throws(() => resolveConfig(/** @type {any} */ ({ autoCheckpoint: { intervalMinutes: -1 } })), /intervalMinutes/)
    assert.throws(() => resolveConfig(/** @type {any} */ ({ autoCheckpoint: { enabled: 'yes' } })), /autoCheckpoint\.enabled/)
    assert.throws(() => resolveConfig(/** @type {any} */ ({ promptSection: 1 })), /promptSection/)
    assert.throws(() => resolveConfig(/** @type {any} */ ({ checkpointTool: 1 })), /checkpointTool/)
  })
})

describe('validateCheckpointSettings（跨字段语义校验，纯函数）', () => {
  const base = plain(checkpointSettingsSchema({}))

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
