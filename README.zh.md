<div align="center">

# ⏪ dsh-checkpoint-rewind

**统一的 DeepSeek Harness 检查点 —— 会话 + 工作区 + 配置三态快照，一键回滚。**

*Claude Code Checkpoints 的等价物，作为能力接缝插件实现：每次变更前捕获，用一条经过批准的命令恢复三态中的任意一个。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-checkpoint-rewind/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-checkpoint-rewind/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-checkpoint-rewind?label=version)](https://github.com/PerryLink/dsh-checkpoint-rewind/releases)
[![npm version](https://img.shields.io/npm/v/dsh-checkpoint-rewind)](https://www.npmjs.com/package/dsh-checkpoint-rewind)
[![npm downloads](https://img.shields.io/npm/dm/dsh-checkpoint-rewind)](https://www.npmjs.com/package/dsh-checkpoint-rewind)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## 兼容性

| 方面 | 状态 |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6`（peer 依赖锁定在 `0.1.0-rc.6`） |
| Node | `^22.19.0 \|\| >=24.0.0` |
| 平台 | 全部（宿主命令 + 监听器；可选设置页时间线，依赖 settings 能力） |
| 模型 | 任意（不调用模型 —— 快照与恢复是确定性的） |

## 你能获得什么

`dsh-checkpoint-rewind` 捕获**三态统一检查点** —— 工作区、会话游标与插件配置 —— 并用一条经过批准的命令恢复其中一个或全部：

1. **三态记录** —— 每个检查点保存工作区状态（git tree SHA 或 copy 清单）、会话事件游标（`seq` + 轮次边界）与配置快照，并按来源标记（`manual` / `auto` / `guard` / `mutation`）。
2. **四种捕获触发** —— 每次变更工具执行前（`fs/write-intent`、`fs/edit-intent`、`tools/pre-execute`）、自动间隔（`autoCheckpoint`，默认每步）、手动（`/checkpoint` 与 `checkpoint` 工具）、以及每次回退前的保护。
3. **git 优先 provider** —— `git stash create` / `commit-tree` 生成未引用快照对象，绝不触碰工作树、索引或历史；恢复仅限工作树且显式路径。非 git 目录（及未提交 HEAD 的仓库）降级为带硬链接复用的增量 `copy` provider。
4. **一键回滚** —— `/rewind workspace|session|config|all <target>` 恢复选定状态；`preview` 是只读影响报告，`diff <a> <b>` 对比两个检查点，`clear` 删除它们。
5. **种子重放式会话回退** —— 会话回退通过官方 `sessions.create` 种子 API 把事件重放到检查点边界，生成新的子会话；原会话保留完整历史。
6. **设置页时间线** —— `Plugins → Checkpoints` 标签页渲染会话的检查点，并附带逐行的两两 diff。

## 快速开始

```sh
# 1. 将 bundle 安装到你的 profile
dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"

# 或从 npm 安装（已发布版本）
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. 重启并验证该行
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

该包是纯 ESM，无构建步骤 —— `index.mjs` 与 `lib/` 即发布产物。工作区变更现在会自动创建检查点；运行 `/rewind` 列出它们。

## 安装与卸载

- **git 渠道**（最新 `main`）：`dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"` —— 纯 ESM，无需 `prepare` 或 `allowBuilds`。
- **npm 渠道**（已发布版本）：`dsh plugin --profile web add dsh-checkpoint-rewind`。
- **tarball 渠道**：在本仓库执行 `npm pack`，然后 `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`。
- **卸载**：`dsh plugin --profile web remove dsh-checkpoint-rewind` —— 快照文件保留，直到你删除 `$DSH_HOME/dsh-checkpoint-rewind`；git 对象会被垃圾回收。

## 配置

所有可调项都是 Schemastery `Config` 字段（可在 cordis.yml 中修改）。没有任何硬编码。

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关；为 `false` 时完全移除命令、监听器与 provider |
| `provider` | `auto` | 快照 provider：`auto`（有 git 则 git，否则 copy）· `git` · `copy` |
| `gitBin` | `git` | Git 可执行文件路径 |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` | copy provider 快照根目录 |
| `maxSnapshots` | `50` | 每个会话保留的检查点数（最旧优先清理） |
| `maxSnapshotBytes` | `536870912`（512 MiB） | 全局增量字节软配额（每会话最新一条总是保留） |
| `pruneOnTurnEnd` | `true` | 轮次结束时执行配额清理 |
| `mutationTools` | `['bash','write','edit','str_replace_editor','pwsh','terminal_send']` | 在 `tools/pre-execute` 上视为变更型的工具 |
| `excludeGlobs` | `['node_modules','.git','.dsh','dist','build']` | copy provider 跳过的 glob 模式 |
| `confirmVia` | `auto` | 确认通道：`auto`（优先 userQuestions）· `userQuestions` · `approval` |
| `listLimit` | `10` | 无参 `/rewind` 显示的检查点数 |
| `preRewindCheckpoint` | `warn` | 恢复前的保护检查点：`warn` · `require` · `off` |
| `verifyByHash` | `false` | copy provider 的内容哈希比对与恢复校验 |
| `autoCheckpoint.enabled` | `true` | `step/start` 上的自动间隔快照 |
| `autoCheckpoint.intervalMinutes` | `0` | 间隔；`0` = 每步 |
| `workspaceRestore` | `restore` | 工作区回滚：`restore`（安全覆盖）· `reset-hard`（CC 风格，需显式开启） |
| `promptSection` | `true` | 注入一句角色陈述式提示词段落 |
| `checkpointTool` | `true` | 注册 `checkpoint` 模型工具 |

## 工具与界面

| 界面 | 类型 | 说明 |
|---|---|---|
| `/rewind` | 命令 | `[workspace\|session\|config\|all] <id-prefix\|step <N>\|latest>` · `diff <a> <b>` · `preview <target>` · `clear` |
| `/checkpoint` | 命令 | `[note <text>\|list\|diff <a> <b>]` —— 捕获手动检查点 |
| `checkpoint` | 工具 | 捕获带可选备注的手动检查点 |
| `fs/write-intent` · `fs/edit-intent` · `tools/pre-execute` | 监听器 | 变更前捕获（prepend 直通；绝不抢占策略槽） |
| `session/event` | 监听器 | 轮次/步骤跟踪、自动间隔、边界补记、轮次结束清理 |
| `checkpoints` 投影 | 会话投影 | 由会话日志折叠出的时间线条 |
| 设置页时间线 | 客户端 | `Plugins → Checkpoints` 标签页，附两两 diff |

## 权限与数据

- **权限**：workshop 清单声明 `workspace:read`、`workspace:write`、`git:read`、`git:write`、`snapshot-storage:write`、`session-log:read`、`settings:write` 与 `network:none`。
- **数据**：检查点记录位于 `checkpoints` 存储域（SQLite 行或 JSON 文件）；copy 快照位于 `snapshotDir`。完全本地 —— 无网络、无凭据。
- **会话日志**：`checkpoint/*` 事件经自适应门追加（仅当宿主认识这些类型或支持 `ignorable` 信封时）；权威审计链是 `command/run` + `command/done` 加持久化领域。

## 安全边界

- **Git 历史不可触碰。** git provider 只运行白名单内的无副作用原语（`stash create`、`commit-tree`、`restore --worktree` 等）；`reset --hard` 只存在于显式开启的 `workspaceRestore: 'reset-hard'` 模式之后。绝无 `git clean`。
- **覆盖式回滚，绝不删除。** 恢复只覆盖已捕获的文件；检查点之后新建的文件会被报告并原样保留。
- **不写穿链接、不路径穿越。** copy 的 `ref` 会作为快照 id 校验；恢复拒绝跟随符号链接写出工作区。
- **恢复必须先批准。** 覆盖用户文件始终经过确认接缝；缺失或拒绝的 answerer 失败关闭。
- **回滚可撤销。** 先捕获回滚前状态的保护检查点；`/rewind <guard-id>` 撤销本次回滚。
- **模型可见 ⟺ 落盘。** 用户或模型看到的一切都能从 `command/run` + `command/done` 与持久化 `checkpoints` 领域重建。

## 已知限制

- 在 rc.6 上，`checkpoint/*` 会话事件被自适应门抑制（宿主不认识这些类型）；在宿主发布该词汇或 `ignorable` 信封之前，审计链由 `command/run` + `command/done` 加存储领域承担。
- `confirmVia: approval` 需要开放轮次，而命令在轮次之间运行 —— 在 rc.6 上请挂载 userQuestions（或设 `confirmVia: userQuestions`）。
- 会话回退会从检查点边界创建一个**新的子会话**；它绝不改写或截断原会话。
- `workspaceRestore: 'reset-hard'` 是 CC 等价模式，会把分支头移动到快照提交；默认关闭。

## 开发

```sh
npm install               # peer 依赖：@deepseek-ai/dsh-session@0.1.0-rc.6、schemastery、zod
npm test                  # node --test test/**/*.test.mjs（含 provider 套件）
npm run test:integration  # 组装式 headless 验证（test/integration/）
```

## 主题

`deepseek-harness`、`dsh`、`dsh-plugin`、`rewind`、`checkpoint`、`snapshot`、`session-replay`、`session-fork`、`config-restore`、`workspace-safety`、`undo`、`cordis-plugin`

## 贡献者

- [@PerryLink](https://github.com/PerryLink) —— 创建者与维护者：三态检查点模型、git/copy provider 接缝、三段式回滚事务、设置页时间线、文档、CI/CD 与发布。

## 许可证

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors
