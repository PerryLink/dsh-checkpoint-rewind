// lib/domain.mjs — 'checkpoints' 存储领域声明（唯一允许 zod 的 lib 模块之一：
// 领域记录 schema 是持久边界校验器，zod 是 harness 自身的校验词汇）。
// 其余允许 zod 的模块：lib/projection.mjs（会话投影 wire 校验器）与
// lib/wire.mjs（设置页面板 Typert wire 校验器）。
//
// 域双版本：0.4.x 用域 v1（记录带可选 forkSeq，无 kind/config）；0.5.x 用域
// v2（kind/config 必填，移除 forkSeq）。存储后端（@deepseek-ai/dsh-storage-json）
// 对版本不匹配抛 version-mismatch，且无自动迁移——0.5.x 升级后旧 v1 介质会
// 打不开。生产侧与消费侧（dsh-checkpoint-diff）一致采用双版本策略：
// - checkpointsDomainSpec（v2）：主 spec，介质不存在时创建 v2；
// - checkpointsDomainSpecV1（v1 容错 spec）：介质仍为 v1（0.4.x 时代）时回退
//   打开；schema 是容错超集，旧记录（无 kind/config）与新记录（v2 形状）同
//   介质共存，新捕获照常按 v2 形状写入。

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
  // doctor pass 标记：底层快照对象（如 gc 后的提交/树对象）已消亡、无法恢复。
  unrestorable: z.boolean().optional(),
  unrestorableReason: z.string().optional(),
})

/**
 * 容错超集 schema（v1 介质回退打开用）：核心字段必填；v1 的 stepEndSeq/forkSeq
 * 与 v2 的 kind/config/tree/note/sessionBoundary 全部可选——0.4.x 旧记录与
 * 0.5.x 新记录都能通过校验，同一介质内新旧共存。
 */
export const checkpointRecordSchemaCompat = z.object({
  ...checkpointRecordSchema.shape,
  kind: z.enum(['manual', 'auto', 'guard', 'mutation']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  forkSeq: z.number().int().nonnegative().optional(),
})

/**
 * 'checkpoints' 领域 spec：一张 'checkpoints' 表，键为检查点 id。
 * version 变更即废弃整介质（预发布立场，无迁移）——因此 0.5.x 打不开 v1 介质
 * 时由 index.mjs 按错误码回退到 checkpointsDomainSpecV1，而不是迁移介质。
 */
export const checkpointsDomainSpec = defineDomain({
  name: DOMAIN_NAME,
  version: 2,
  tables: { checkpoints: domainTable(checkpointRecordSchema) },
})

/** 'checkpoints' 领域 spec（v1，0.4.x 介质的回退打开；schema 为容错超集）。 */
export const checkpointsDomainSpecV1 = defineDomain({
  name: DOMAIN_NAME,
  version: 1,
  tables: { checkpoints: domainTable(checkpointRecordSchemaCompat) },
})
