// test/panel.test.mjs — 设置页 wire 服务：描述符契约（issue #5）与
// cordis traceable proxy 下的私有品牌检查（issue #6）回归。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { CheckpointPanelService } from '../lib/panel.mjs'
import { TIMELINE_DESCRIPTOR } from '../lib/wire.mjs'

/** 合成领域记录（面板只读视图所需字段 + diff 所需 ref/config/cwd）。 */
function recordOf(over = {}) {
  return {
    id: 'aaaa1111',
    sessionId: 'session-1',
    time: 1000,
    seq: 10,
    kind: 'manual',
    provider: 'copy',
    triggerTool: 'write',
    turn: 1,
    step: 1,
    files: 1,
    bytes: 10,
    tree: null,
    note: null,
    sessionBoundary: null,
    cwd: '/work/proj',
    ref: 'ref-a',
    config: {},
    ...over,
  }
}

/** 面板依赖夹具：内存表 + 空写链 + copy provider 的 diffFiles 桩。 */
function makeDeps(records) {
  const table = new Map(records.map((record) => [record.id, record]))
  return {
    getTable: () => Promise.resolve(table),
    ops: Promise.resolve(),
    registry: {
      get: (name) => name === 'copy'
        ? {
          name: 'copy',
          diffFiles: async () => ({
            changed: 1, added: 0, removed: 0, names: ['a.txt'],
            entries: [{ path: 'a.txt', status: 'changed' }],
          }),
          preview: async () => ({ restore: 2, unchanged: 1, leftovers: [], changes: ['a.txt', 'b.txt'], entries: [{ path: 'a.txt', bytes: 10 }, { path: 'b.txt', bytes: 20 }] }),
        }
        : undefined,
    },
    getLive: () => ({ maxSnapshots: 8, maxSnapshotBytes: 1024 }),
  }
}

/** 经代理调用服务方法，复刻 cordis getTraceable 的 this=Proxy 形态。 */
function makeProxiedService(records) {
  const service = new CheckpointPanelService(new Context(), makeDeps(records))
  return new Proxy(service, {})
}

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

describe('CheckpointPanelService 经 traceable proxy 调用（issue #6 回归）', () => {
  it('timeline：代理调用返回时间线快照（无私有品牌检查异常）', async () => {
    const proxy = makeProxiedService([recordOf()])
    const snapshot = await proxy.timeline()
    assert.equal(snapshot.total, 1)
    assert.equal(snapshot.rows[0].id, 'aaaa1111')
    assert.equal(snapshot.maxSnapshots, 8)
    assert.equal(snapshot.maxSnapshotBytes, 1024)
  })

  it('timeline：渲染器与选择性恢复开关有防御默认（getLive 缺失字段不抛错）', async () => {
    const proxy = makeProxiedService([recordOf()])
    const snapshot = await proxy.timeline()
    assert.equal(snapshot.diffRenderer, 'pairwise', '缺失时回落 pairwise')
    assert.equal(snapshot.selectiveRestore, false, '缺失时默认关闭')
  })

  it('timeline：limit 缺席回退默认上限，显式 limit 封顶', async () => {
    const records = [1, 2, 3].map((n) => recordOf({ id: `aaaa111${n}`, time: 1000 + n, seq: 10 + n }))
    const proxy = makeProxiedService(records)
    assert.equal((await proxy.timeline()).rows.length, 3)
    assert.equal((await proxy.timeline(2)).rows.length, 2)
  })

  it('diff：代理调用返回两两对比（error 为 null）', async () => {
    const from = recordOf({ id: 'aaaa1111', seq: 10, ref: 'ref-a' })
    const to = recordOf({ id: 'bbbb2222', seq: 20, ref: 'ref-b' })
    const proxy = makeProxiedService([from, to])
    const result = await proxy.diff('aaaa', 'bbbb')
    assert.equal(result.error, null)
    assert.deepEqual(result.files.names, ['a.txt'])
    assert.deepEqual(result.files.entries, [{ path: 'a.txt', status: 'changed' }])
    assert.equal(result.session.fromSeq, 10)
    assert.equal(result.session.toSeq, 20)
  })

  it('restorePreview：返回逐文件条目 + 字节大小（只读）', async () => {
    const proxy = makeProxiedService([recordOf({ id: 'aaaa1111', ref: 'ref-a' })])
    const result = await proxy.restorePreview('aaaa')
    assert.equal(result.error, null)
    assert.equal(result.provider, 'copy')
    assert.deepEqual(result.files, [{ path: 'a.txt', bytes: 10 }, { path: 'b.txt', bytes: 20 }])
    assert.equal(result.totalBytes, 30)
    assert.equal(result.truncated, false)
  })

  it('restorePreview：未知 id 返回 error（不抛业务异常）', async () => {
    const proxy = makeProxiedService([recordOf()])
    const result = await proxy.restorePreview('nope')
    assert.match(result.error, /unknown checkpoint id/)
    assert.deepEqual(result.files, [])
  })
})
