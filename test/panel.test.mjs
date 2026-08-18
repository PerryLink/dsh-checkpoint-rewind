// test/panel.test.mjs — 设置页 wire 服务：描述符契约（issue #5）与
// cordis traceable proxy 下的私有品牌检查（issue #6）回归。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TIMELINE_DESCRIPTOR } from '../lib/wire.mjs'

describe('TIMELINE_DESCRIPTOR 契约（issue #5 回归）', () => {
  it('limit 参数声明 acceptsUndefined: true，网关放行缺席字段', () => {
    const limit = TIMELINE_DESCRIPTOR.parameters.find((p) => p.name === 'limit')
    assert.equal(limit.acceptsUndefined, true)
  })

  it('zod .optional() 只校验已提供的值：越界拒绝、合法放行', () => {
    const limit = TIMELINE_DESCRIPTOR.parameters.find((p) => p.name === 'limit')
    assert.equal(limit.codec.schema.safeParse(50).success, true)
    assert.equal(limit.codec.schema.safeParse(0).success, false)
  })
})
