// lib/domain.mjs — 'checkpoints' 存储领域声明（唯一允许 zod 的 lib 模块：
// 领域记录 schema 是持久边界校验器，zod 是 harness 自身的校验词汇）。

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { DOMAIN_NAME } from './constants.mjs'

/**
 * 一条检查点记录的持久 schema。介质上每条记录在 open 时按此校验
 * （invalid-record 响亮拒绝，绝不静默跳过）。
 */
export const checkpointRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  seq: z.number().int().nonnegative(),
  time: z.number().int().nonnegative(),
  provider: z.enum(['git', 'copy']),
  triggerTool: z.string().min(1),
  turn: z.number().int().positive(),
  step: z.number().int().positive(),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  ref: z.string().min(1),
  stepEndSeq: z.number().int().nonnegative().optional(),
  forkSeq: z.number().int().nonnegative().optional(),
})

/**
 * 'checkpoints' 领域 spec：一张 'checkpoints' 表，键为检查点 id。
 * version 变更即废弃整介质（预发布立场，无迁移）。
 */
export const checkpointsDomainSpec = defineDomain({
  name: DOMAIN_NAME,
  version: 1,
  tables: { checkpoints: domainTable(checkpointRecordSchema) },
})
