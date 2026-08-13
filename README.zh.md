# dsh-checkpoint-rewind

[English](README.md) · **中文** · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

**为 DeepSeek Harness 做对的 Claude Code `/rewind`。**

一个能力接缝插件，为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 补上 **工作区文件快照 + 会话边界回退**：每次变更型工具执行前捕获工作区状态（git 优先、目录拷贝兜底），一条 `/rewind` 命令即可恢复文件**并**把会话 fork 回该检查点的轮次边界——模型上下文与磁盘文件永远一致。

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-green.svg)](#)
[![Harness](https://img.shields.io/badge/dsh-0.1.0--rc.6-8a2be2.svg)](#)

> **Topics**: `dsh` · `dsh-plugin` · `deepseek-harness` · `rewind` · `checkpoint` · `session-fork` · `workspace-safety` · `undo` · `cordis-plugin`

---

## 为什么还需要一个 rewind 插件？

| 插件 | 卖点 | 恢复文件？ | 回退会话？ |
|---|---|---|---|
| **dsh-checkpoint-rewind**（本插件） | git 对象级快照 + 轮次边界 fork + 一键恢复 | ✅ 完整工作区状态 | ✅ fork 种子会话 |
| [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) | 持久 Change Ledger 逐变更增量 | ✅ 重放逆向增量 | ✅ 自有 ledger 模型 |
| [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) | 纯上下文回退到上一个已完成步骤 | ❌ | ✅ 仅上下文 |
| [Mongfayi/dsh-recall](https://github.com/Mongfayi/dsh-recall) | 消息撤回（删除该轮及之后一切） | ❌（明确不还原代码） | ✅ 删除轮次 |

一句话定位差异：**dsh-checkpoint-rewind 在每次变更前用无副作用的 git 原语捕获*工作区状态*，把"回到第 N 步"做成一条经确认的命令——先恢复文件、再 fork 会话，每一步都有日志。** 没有会漂移的增量簿记，不做对话消息级编辑（那是另一个插件的范畴），不做跨设备同步。

## 特性

- **每次变更前快照** —— 在 `fs/write-intent` / `fs/edit-intent` 与 `tools/pre-execute`（非 fs 变更工具如 `bash`）上以 prepend 直通监听，覆盖所有变更路径，同时不抢占策略决策槽。
- **Provider seam** —— `git` 优先：`git stash create` / `git commit-tree` 产生未引用的快照对象，**绝不触碰工作树、索引与历史**；恢复只用 worktree-only 的 `git restore`。非 git 目录自动降级为 `copy`（增量目录快照 + hardlink 复用），并在列表中明确标注。
- **步骤级映射、轮次级 fork** —— 每个检查点记录其 turn/step；`step/end` 补记步骤映射（"回到第 N 步" = 最近的 ≤N 快照），`turn/end` 补记 fork 边界，使用 harness 真正的 `ctx.sessions.fork` 原语。
- **两段式回退事务** —— `/rewind <id>` 先经确认（userQuestions / approval seam，**无回答者失败关闭**），先恢复文件、再 fork；恢复失败绝不 fork，fork 失败报告"文件已恢复、会话未派生"且保留检查点。
- **持久注册表 + 配额** —— 检查点记录存 `ctx.storageDomain`（域 `checkpoints`；SQLite 后端 = 表行，JSON 后端 = 可读文件）；`maxSnapshots`（每会话，默认 50）、`maxSnapshotBytes`（全局，默认 512 MiB）、`pruneOnTurnEnd`，最旧优先清理。
- **天然可重建** —— `/rewind` 输出走 harness 自有的 `command/run` + `command/done` 事件；`checkpoint/snapshot|bound|prune|rewind` 会话事件已声明，宿主构建收录后自动追加（rc.6 自适应门）。

## 快速开始

`dsh-checkpoint-rewind` 以 **bundle 插件**形式发布（无构建步骤，纯 ESM）：

```sh
dsh plugin add dsh-checkpoint-rewind    # 进入 profile 的 bundle 栈
# 重启 dsh —— /rewind 即在 Web UI 生效
```

或直接挂载试验：

```sh
pnpm dsh web --patch ./cordis.patch.yml
```

工作区一旦发生变更，检查点自动生成。在 Web UI（或任何交互式适配器）中：

```text
/rewind
```

```text
rewind: 3 checkpoints (newest last):
#a1b2c3d4-e5f6-… · (git) · turn 2 step 1 · 2026-08-14 12:00:01 · trigger: bash · 4 files · 1.2 MiB · fork: ready
#b2c3d4e5-f6a7-… · (git) · turn 2 step 3 · 2026-08-14 12:00:41 · trigger: str_replace_editor · 2 files · 310 KiB · fork: ready
#c3d4e5f6-a7b8-… · (copy) · turn 3 step 1 · 2026-08-14 12:01:10 · trigger: write · 1 file · 90 KiB · fork: pending (turn not closed)
run "/rewind <id>" to restore files and fork the session from that checkpoint
```

```text
/rewind b2c3d4e5-f6a7-…
```

插件询问 **"Restore the workspace files to this checkpoint and fork the session?"** → 批准后恢复文件、在该检查点的轮次边界 fork 会话，并返回新会话 id：

```text
rewind: restored 2 file(s) from checkpoint b2c3d4e5-f6a7-… (provider git)
and forked a new session at seq 87 (end of turn 2).
session: session-123
Open the new session to continue from before that turn; this session keeps its later history.
```

headless 运行打印同样的结果并附带续接指引；Web shell 可用返回的 `session:` id 完成跳转（见 [Web UI 锚点](#web-ui-锚点)）。

## 配置

全部为 `Config` 字段（cordis.yml 可改；无硬编码）：

| 键 | 默认值 | 含义 |
|---|---:|---|
| `enabled` | `true` | 总开关；`false` 时命令、监听、provider 全部消失。 |
| `provider` | `auto` | 快照 provider：`auto`（git 可用则 git，否则 copy）· `git`（非 git 目录响亮失败）· `copy`。 |
| `gitBin` | `git` | git 可执行路径。 |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` | copy provider 快照根目录。 |
| `maxSnapshots` | `50` | **每会话**保留的检查点数（最旧优先清理）。 |
| `maxSnapshotBytes` | `536870912`（512 MiB） | 跨会话全局内容配额（最旧优先清理）。 |
| `pruneOnTurnEnd` | `true` | 轮次结束时执行配额清理。 |
| `mutationTools` | `['bash','write','edit','str_replace_editor']` | `tools/pre-execute` 上视为变更型的工具名（fs 工具已由 `fs/*-intent` 覆盖）。 |
| `excludeGlobs` | `['node_modules','.git','.dsh','dist','build']` | copy provider 跳过的目录/文件（`.git` 与快照目录恒被排除）。 |
| `confirmVia` | `auto` | 确认通道：`auto`（优先 userQuestions，其次 approval）· `userQuestions` · `approval`。 |
| `listLimit` | `10` | `/rewind` 无参列出的检查点数。 |

```yaml
- insert:
    - id: checkpoint-rewind
      name: dsh-checkpoint-rewind
      config:
        provider: auto
        maxSnapshots: 50
        maxSnapshotBytes: 536870912
        pruneOnTurnEnd: true
        confirmVia: auto
```

## 安全模型

- **git 历史不可触碰。** git provider 只运行白名单内的无副作用原语——`stash create`、`commit-tree`、`restore --worktree`、`ls-tree`、`diff-tree`、`ls-files`、`status`、`rev-parse`——由运行时断言强制。**绝不 `reset --hard`、绝不 `clean`、绝不改写索引或历史。**
- **恢复必须先确认。** 覆盖用户文件必经确认 seam（ask 语义）；回答者缺失、抛错或拒绝一律**失败关闭**。
- **覆盖式回滚，绝不删除。** 两个 provider 都只恢复捕获的文件，快照之后新建的文件只*报告*（git：未跟踪文件；copy：清单差异）而绝不删除。
- **两段式事务，顺序固定。** 先文件后 fork，每阶段落日志；恢复失败时文件、检查点与会话原样保留。
- **模型可见 ⟺ 已落盘。** 用户/模型看到的一切均可从会话日志（`command/run` + `command/done`，宿主收录后还有 `checkpoint/*` 事件）加持久 `checkpoints` 域重建。

## 工作原理

`checkpoint/snapshot`（创建）→ `checkpoint/bound`（step/end 与 turn/end 补记）→ `/rewind`（列出 / 确认 / 两段式恢复）。完整决策记录、事件词汇与 provider 契约见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 会话事件（rc.6 说明）

插件把 `checkpoint/snapshot`、`checkpoint/bound`、`checkpoint/prune`、`checkpoint/rewind` 声明为 log-only 的 `SessionEventMap` 成员。harness rc.6 **没有插件事件注册面**，`Session.append` 也无法给未知类型标记 `ignorable`，直接 append 会让会话重载时被持久化层拒绝。因此插件经**自适应门**（`KNOWN_SESSION_EVENT_TYPES`）append：今天跳过，宿主构建收录类型后自动开启。在此之前，权威审计链是宿主已知的 `command/run` + `command/done` 事件加持久 `checkpoints` 存储域。

## Web UI 锚点

插件已在命令结果中返回新会话 id（`session: <id>`），Web shell 可据此跳转。**会话投影单元 `checkpoints` 已随插件交付**：只要 `ctx.sessionProjections` 存在即注册（折叠 `checkpoint/snapshot|bound|prune|rewind` 为全量列表值，`stateVersion` 0）——rc.6 宿主上恒为空列表，宿主构建携带 `checkpoint/*` 词汇后无需改插件即自动填充。留给 shell 的跟进只剩**只读面板**的渲染（见 [ARCHITECTURE.md](ARCHITECTURE.md#todo-web-ui-checkpoint-strip)）。

## 测试

```sh
npm install
npm test                 # 58 个单测：快照创建/去重/并发、git 与非 git 路径、≤N 边界映射、
                         # 配额清理、两段式恢复失败矩阵、approval 拒绝路径、自适应事件门
                         # （真 Cordis + 真 SessionStore/CommandRuntime）
npm run test:integration # 组装式 headless 验证：agent 跨两轮改 2 个文件 → /rewind 列表 →
                         # 回退 → 断言文件内容与 fork 上下文
```

## 许可证

Apache License 2.0 —— 见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 相关插件

- [dsh-memento](https://github.com/…/dsh-memento) —— 有界、带审批门的跨会话记忆（同一插件族约定）。
- [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) · [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) —— 本插件差异化定位的对照物（见上表）。
