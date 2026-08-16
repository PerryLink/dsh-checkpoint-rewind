// lib/domain.mjs — 'checkpoints' 存储领域声明（唯一允许 zod 的 lib 模块之一：
// 领域记录 schema 是持久边界校验器，zod 是 harness 自身的校验词汇）。
// 其余允许 zod 的模块：lib/projection.mjs（会话投影 wire 校验器）与
// lib/wire.mjs（设置页面板 Typert wire 校验器）。

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { DOMAIN_NAME, LIMITS } from './constants.mjs'

/**
 * 一条检查点记录的持久 schema（一体化三态模型）。介质上每条记录在 open 时
 * 按此校验（invalid-record 响亮拒绝，绝不静默跳过）。
 * 三态：seq = 会话事件游标；tree = 工作区 git tree SHA（copy provider 为 null）；
 * config = 配置快照（JSON 对象）；note = 备注；kind = 来源分类。
 */
export const checkpointRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  // 会话事件游标（捕获时会话日志 seq）。
  seq: z.number().int().nonnegative(),
  time: z.number().int().nonnegative(),
  provider: z.enum(['git', 'copy']),
  kind: z.enum(['manual', 'auto', 'guard', 'mutation']),
  triggerTool: z.string().min(1),
  turn: z.number().int().positive(),
  step: z.number().int().positive(),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  ref: z.string().min(1),
  // 工作区 git tree SHA（git provider）；copy provider 无 git 树 → null。
  tree: z.string().regex(/^[0-9a-f]{40,64}$/iu).nullable().optional(),
  // 配置快照（捕获时插件有效配置的 JSON 对象）。
  config: z.record(z.string(), z.unknown()),
  // 备注（手动检查点可带；上限见 LIMITS.MAX_NOTE_LENGTH）。
  note: z.string().max(LIMITS.MAX_NOTE_LENGTH).optional(),
  // 捕获所在 step 的 step/end 事件 seq（补记；"/rewind step N" 映射用）。
  stepEndSeq: z.number().int().nonnegative().optional(),
  // 会话重放边界：游标之前最近一条 turn/end 的 seq（首轮检查点为 undefined，
  // 回退时以空种子创建全新子会话）。
  sessionBoundary: z.number().int().nonnegative().optional(),
})

/**
 * 'checkpoints' 领域 spec：一张 'checkpoints' 表，键为检查点 id。
 * version 变更即废弃整介质（预发布立场，无迁移）。
 */
export const checkpointsDomainSpec = defineDomain({
  name: DOMAIN_NAME,
  version: 2,
  tables: { checkpoints: domainTable(checkpointRecordSchema) },
})
