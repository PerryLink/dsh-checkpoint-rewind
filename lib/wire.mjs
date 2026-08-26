// lib/wire.mjs — 设置页面板 Typert wire 契约（允许 zod：wire 载荷是
// 持久/传输边界校验器，与 lib/projection.mjs 同一理由）。
// host ./typert 清单与 client Remote 贡献共用本文件的 descriptor 常量，
// 两端 codec 永不漂移（对齐 dsh-mcp-panel 的 wire.ts 惯例）。

import { z } from 'zod'
import { LIMITS, PANEL_SERVICE } from './constants.mjs'

const PACKAGE = 'dsh-checkpoint-rewind'

/** 时间线单行（面板只读视图）。 */
export const timelineRowSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  time: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  kind: z.enum(['manual', 'auto', 'guard', 'mutation']),
  provider: z.enum(['git', 'copy']),
  triggerTool: z.string().min(1),
  turn: z.number().int().positive(),
  step: z.number().int().positive(),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  tree: z.string().nullable(),
  note: z.string().nullable(),
  sessionBoundary: z.number().int().nonnegative().nullable(),
})

/** checkpointPanel/timeline 返回：时间线 + 有界存储配额现状。 */
export const timelineSnapshotSchema = z.object({
  rows: z.array(timelineRowSchema),
  total: z.number().int().nonnegative(),
  bytes: z.number(),
  maxSnapshots: z.number().int(),
  maxSnapshotBytes: z.number(),
  diffRenderer: z.enum(['pairwise', 'side-by-side']),
  selectiveRestore: z.boolean(),
})

/** 逐文件变更条目（per-file 并排渲染输入）。 */
const diffFileEntrySchema = z.object({
  path: z.string().min(1),
  status: z.enum(['added', 'removed', 'changed']),
})

/** checkpointPanel/diff 返回：文件变更统计、配置行 diff、会话游标差。 */
export const diffResultSchema = z.object({
  from: z.string(),
  to: z.string(),
  error: z.string().nullable(),
  files: z.object({
    changed: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    names: z.array(z.string()),
    truncated: z.boolean(),
    entries: z.array(diffFileEntrySchema).optional(),
  }),
  configDiff: z.object({
    changed: z.boolean(),
    lines: z.number().int().nonnegative(),
    text: z.string(),
  }),
  session: z.object({
    fromSeq: z.number().int().nonnegative(),
    toSeq: z.number().int().nonnegative(),
    fromTurn: z.number().int().positive().nullable(),
    fromStep: z.number().int().positive().nullable(),
    toTurn: z.number().int().positive().nullable(),
    toStep: z.number().int().positive().nullable(),
    dropped: z.number().int().nonnegative(),
  }),
  fromNote: z.string().nullable(),
  toNote: z.string().nullable(),
})

/** checkpointPanel/restorePreview 返回：单个检查点的逐文件可恢复条目 + 字节大小。 */
export const restorePreviewResultSchema = z.object({
  id: z.string(),
  error: z.string().nullable(),
  provider: z.enum(['git', 'copy']).nullable(),
  files: z.array(z.object({
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
  })),
  totalBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
})

const SOURCE_LOCATION = Object.freeze({ file: 'lib/wire.mjs', line: 1, column: 1 })

/**
 * 只读时间线调用描述符（host manifest 与 client Remote 共用）。
 */
export const TIMELINE_DESCRIPTOR = Object.freeze({
  id: `${PACKAGE}#${PANEL_SERVICE}/timeline`,
  service: PANEL_SERVICE,
  namespace: PANEL_SERVICE,
  method: 'timeline',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([Object.freeze({
    name: 'limit',
    wire: 'limit',
    source: 'json',
    // 网关 exact-args 检查只认显式 acceptsUndefined（或 src-json codec）；
    // zod .optional() 只校验"已提供的值"，不授权字段缺席。
    acceptsUndefined: true,
    codec: Object.freeze({
      mode: 'strict',
      typeSymbol: `${PACKAGE}/types#TimelineLimit`,
      schema: z.number().int().min(1).max(200).optional(),
    }),
  })]),
  result: Object.freeze({
    mode: 'strict',
    typeSymbol: `${PACKAGE}/types#TimelineSnapshot`,
    schema: timelineSnapshotSchema,
  }),
  sourceLocation: SOURCE_LOCATION,
})

/**
 * 两两对比调用描述符（host manifest 与 client Remote 共用）。
 */
export const DIFF_DESCRIPTOR = Object.freeze({
  id: `${PACKAGE}#${PANEL_SERVICE}/diff`,
  service: PANEL_SERVICE,
  namespace: PANEL_SERVICE,
  method: 'diff',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({
      name: 'from',
      wire: 'from',
      source: 'json',
      codec: Object.freeze({
        mode: 'strict',
        typeSymbol: `${PACKAGE}/types#CheckpointIdRef`,
        schema: z.string().min(1),
      }),
    }),
    Object.freeze({
      name: 'to',
      wire: 'to',
      source: 'json',
      codec: Object.freeze({
        mode: 'strict',
        typeSymbol: `${PACKAGE}/types#CheckpointIdRef`,
        schema: z.string().min(1),
      }),
    }),
  ]),
  result: Object.freeze({
    mode: 'strict',
    typeSymbol: `${PACKAGE}/types#DiffResult`,
    schema: diffResultSchema,
  }),
  sourceLocation: SOURCE_LOCATION,
})

/**
 * 只读恢复预览调用描述符（host manifest 与 client Remote 共用）。
 * 逐文件勾选 + 大小统计的数据来源（只读，绝不写文件）。
 */
export const RESTORE_PREVIEW_DESCRIPTOR = Object.freeze({
  id: `${PACKAGE}#${PANEL_SERVICE}/restorePreview`,
  service: PANEL_SERVICE,
  namespace: PANEL_SERVICE,
  method: 'restorePreview',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({
      name: 'id',
      wire: 'id',
      source: 'json',
      codec: Object.freeze({
        mode: 'strict',
        typeSymbol: `${PACKAGE}/types#CheckpointIdRef`,
        schema: z.string().min(1),
      }),
    }),
  ]),
  result: Object.freeze({
    mode: 'strict',
    typeSymbol: `${PACKAGE}/types#RestorePreviewResult`,
    schema: restorePreviewResultSchema,
  }),
  sourceLocation: SOURCE_LOCATION,
})

/** 面板 wire 调用清单（./typert 清单与 client Remote 贡献共用）。 */
export const PANEL_INVOCATIONS = Object.freeze([
  TIMELINE_DESCRIPTOR,
  DIFF_DESCRIPTOR,
  RESTORE_PREVIEW_DESCRIPTOR,
])

/** 时间线渲染上限（LIMITS.MAX_DIFF_FILES 是 diff 文件清单上限）。 */
export const TIMELINE_MAX_ROWS = 200
