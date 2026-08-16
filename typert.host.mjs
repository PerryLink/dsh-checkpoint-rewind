// typert.host.mjs — 手写 Typert HOST 清单（exports './typert'，typert-loader
// 自动注册；对齐 dsh-mcp-panel 的 typert.host.ts 形态）。
// 只读面板调用：checkpointPanel/timeline（时间线）与 checkpointPanel/diff
// （两两对比）。实现见 lib/panel.mjs 的 CheckpointPanelService（TypertRemoteService，
// 服务名 = Remote 命名空间 'checkpointPanel'）。

import { PANEL_INVOCATIONS } from './lib/wire.mjs'

/** Host Typert manifest（typert-loader 校验）。 */
export const TYPERT = Object.freeze({
  package: 'dsh-checkpoint-rewind',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: PANEL_INVOCATIONS,
  model: Object.freeze({
    services: Object.freeze([]),
    events: Object.freeze([]),
    objects: Object.freeze([]),
  }),
})
