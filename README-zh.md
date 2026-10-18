<div align="center">

# ⏪ dsh-checkpoint-rewind
- **1024 商店渠道**：先 `npm i -g dsh1024`，再 `dsh1024 plugin --profile web add dsh-checkpoint-rewind`（计入 [deepseek1024.com](https://deepseek1024.com) 安装排行）。

**统一的 DeepSeek Harness 检查点 —— 会话 + 工作区 + 配置三态快照，一键回滚。**

*Claude Code Checkpoints 的等价物，作为能力接缝（capability-seam）插件实现：每次变更前捕获，用一条经批准的命令恢复三种状态中的任意一个。*

> **官方仓库。** 本仓库是 dsh-checkpoint-rewind 的唯一官方仓库，由 PerryLink 维护。其他账号下的同名仓库与本项目无关。

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-checkpoint-rewind)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![dsh-doctor](https://raw.githubusercontent.com/PerryLink/dsh-plugin-doctor/main/badges/PerryLink__dsh-checkpoint-rewind.svg)](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)
[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-listed-zh.svg)](https://dsh.market/)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-checkpoint-rewind/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-checkpoint-rewind/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-checkpoint-rewind?label=version)](https://github.com/PerryLink/dsh-checkpoint-rewind/releases)
[![npm version](https://img.shields.io/npm/v/dsh-checkpoint-rewind)](https://www.npmjs.com/package/dsh-checkpoint-rewind)
[![npm downloads](https://img.shields.io/npm/dm/dsh-checkpoint-rewind)](https://www.npmjs.com/package/dsh-checkpoint-rewind)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-checkpoint-rewind?metric=downloads&lang=zh)](https://dshfind.com/zh/plugins/PerryLink/dsh-checkpoint-rewind?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-checkpoint-rewind
```


</div>

---

**📖 生态实测知识库**（实测数据，不是营销）：[插件开发指南 · 选型实测数据 · 维护取舍判据](https://perrylink.github.io/dsh-plugin-guide/)。

<!-- star-cta -->
## ⭐ 如果它帮到了你

这个插件是 [DSH 插件家族](https://github.com/PerryLink)的一员（95 个，全部 Apache-2.0）。如果你在用，**给个 star** —— 它不会解锁任何功能，但会让下一个人在搜索里更容易找到它。

*English:* part of a 95 plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.

## What is dsh-checkpoint-rewind?

统一的 DeepSeek Harness 检查点 —— 会话 + 工作区 + 配置三态快照，一键回滚。

Claude Code Checkpoints 的等价物，作为能力接缝（capability-seam）插件实现：每次变更前捕获，用一条经批准的命令恢复三种状态中的任意一个。

![dsh-checkpoint-rewind 终端演示：dsh-checkpoint-rewind — /rewind lists checkpoints, then a read-only preview](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-hero.png)

![Animated terminal demo of dsh-checkpoint-rewind](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-demo.gif)

*同一次运行，动图版。*

## Comparison

![dsh-checkpoint-rewind 的实测对比柱状图](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-evidence.png)

Capabilities out of 2 (restores files? / rewinds the session?) · counted from the README comparison table

## 兼容性

| 方面 | 状态 |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1`（GitHub tag，2026-09-24 已核验；npm 钉号 `0.1.7-rc.2`，peer 依赖范围 `>=0.1.6-0 <0.2.0 || >=0.1.7-0 <0.2.0`）（2026-09-22 已适配）：宿主删除了 `@deepseek-ai/dsh-settings-file`，并把 `ctx.settings` 的命名空间注册面换成 `SettingsForms` —— 它把每个 Loader 条目的 `Config` 投影成设置页表单、编辑落到 profile patch；插件配置字段因此标为 `volatile()` 并按当前值读取，typert strict codec 只保留 `create()` 工厂，回退通知改用自己的消息来源 `kind`。`0.1.5-rc.2`/`0.1.6-alpha.2` 宿主仍走旧的 `settings.register` 路径。2026-09-22 已针对 `dsh-v0.1.7-alpha.1` 检出版核验（alpha.1 类型面 typecheck + 全量单测 + 组装式 headless 集成）。 |
| Node | `^22.19.0 \|\| >=24.0.0` |
| 平台 | 全部（宿主命令 + 监听器；通过 settings 能力提供可选设置页时间线） |
| 模型 | 任意（不调用模型 —— 快照与恢复是确定性的） |

## 你能获得什么

`dsh-checkpoint-rewind` 捕获一个**三态统一检查点**——工作区、会话游标与插件配置——并用一条经批准的命令恢复其中一个或全部：

1. **三态记录** —— 每个检查点保存工作区状态（git 树 SHA，或副本清单）、会话事件游标（`seq` + 轮次边界）与配置快照，并按来源标记（`manual` / `auto` / `guard` / `mutation`）。
2. **四种捕获触发** —— 在每次变更工具执行前（`fs/write-intent`、`fs/edit-intent`、`tools/pre-execute`）、自动间隔（`autoCheckpoint`，默认每步）、手动（`/checkpoint` 与 `checkpoint` 工具）、以及每次回退前的守护检查点。
3. **git 优先的 provider** —— `git stash create` / `commit-tree` 生成未引用快照对象，绝不触碰工作树、索引或历史；恢复仅限工作树且路径显式。非 git 目录（以及尚无 HEAD 的仓库）降级为带硬链接复用的增量 `copy` provider。
4. **一键回滚** —— `/rewind workspace|session|config|all <target>` 恢复所选状态；`preview` 是只读影响报告，`diff <a> <b>` 比较两个检查点，`clear` 删除它们（本会话；`clear --all` 覆盖所有会话与工作区）。
5. **fork 化会话回退** —— 会话回退通过官方 `SessionStore.fork` 原语把事件重放到检查点边界，生成新的子会话（宿主无 fork 或检查点无边界时回落到 `sessions.create` 种子路径）；原会话保留其完整历史。
6. **设置页时间线** —— `Plugins → Checkpoints` 标签页渲染会话的检查点，并附带两两之间的逐行 diff。

## 为什么还需要另一个 rewind 插件？

| 插件 | 卖点 | 恢复文件？ | 回退会话？ |
|---|---|---|---|
| **dsh-checkpoint-rewind**（本插件） | git 对象快照 + 三态回滚 + 一键恢复 | ✅ 完整工作区状态 | ✅ 种子重放子会话 |
| [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) | 每变更增量的持久 Change Ledger | ✅ 通过重放逆增量 | ✅ 自有 ledger 模型 |
| [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) | 纯上下文回退到上一步完成 | ❌ | ✅ 仅上下文 |
| [Mongfayi/dsh-recall](https://github.com/Mongfayi/dsh-recall) | 消息撤回（移除某轮及其后所有内容） | ❌（明确） | ✅ 轮次移除 |

一句话区别：**dsh-checkpoint-rewind 在每次变更前用无副作用的 git 原语捕获*工作区状态*，并把“回到第 N 步”变成一条经批准的命令——先守护检查点，再恢复文件，再恢复配置，再重放会话，每一阶段都有日志。**没有会漂移的增量记账，没有消息级编辑（那属于另一个插件），没有跨设备同步。

## 快速开始

```sh
dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind
```

```sh
# 1. 将 bundle 安装到你的 profile
dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind

# 或从 npm 安装（已发布版本）
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. 重启并验证该行
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

检查点通过 `storageDomain` 服务持久化。未组合它时插件照常挂载、绝不阻塞 profile 启动——checkpoint/rewind 命令会返回结构化错误并指明要添加的行。一次性组合存储栈即可启用检查点：

```yaml
- insert:
    - id: checkpoint-rewind-storage
      name: '@deepseek-ai/dsh-storage'
    - id: checkpoint-rewind-storage-json
      name: '@deepseek-ai/dsh-storage-json'
      config:
        root: !!js dshHomePath('checkpoint-rewind/storage')
    - id: checkpoint-rewind-storage-domain
      name: '@deepseek-ai/dsh-storage-domain'
      config:
        backend: json
```

该包是纯 ESM，无构建步骤——`index.mjs` 与 `lib/` 即发布产物。工作区变更现在会自动创建检查点；运行 `/rewind` 列出它们（或 `/rewind list brief` 获取逐行带会话短号的单行列表）：

```text
rewind: 3 checkpoints (newest last):
#a1b2c3d4 · (git) · turn 2 step 1 · 2026-08-14 12:00:01 (3 min ago) · trigger: bash · 4 files · 1.2 MiB
#b2c3d4e5 · (git) · turn 2 step 3 · 2026-08-14 12:00:41 · trigger: str_replace_editor · 2 files · 310 KiB
#c3d4e5f6 · (copy) · turn 3 step 1 · 2026-08-14 12:01:10 · trigger: write · 1 file · 90 KiB
run "/rewind <id>" to restore files and fork the session from that checkpoint
```

通过**会话短号**（`/rewind list brief` 显示的有界短号）、唯一 id 前缀、步骤号或 `latest` 来定位检查点：

```text
/rewind list brief        # 每个检查点一行、带短号、最新在前
/rewind 3                 # 本会话中短号为 3 的检查点（精确命中，绝不做模糊匹配）
/rewind preview 3         # 只读：显示哪些文件会变化，不触碰任何内容
/rewind b2c3d4e5          # 唯一 id 前缀（列表里的 8 位 id）与以前完全一样可用
/rewind step 2
/rewind latest
/rewind workspace 3 --files src/a.ts,src/b.ts   # 选择性恢复：只恢复这些文件（经批准门）
/rewind clear              # 确认删除本会话的检查点（文件不受影响）
/rewind clear --all        # 确认删除所有会话与工作区的检查点（文件不受影响）
```

### 会话短号（有界短号）

- **每个检查点在创建时就分到一个短号**，从 `1` 开始。`/rewind 3` **精确**解析该短号——数字永远不会被当作 id 前缀，因此 `/rewind 3` 不可能落到某个恰好以 `3` 开头的 UUID 上。
- **作用域：每会话**（`sessionId`）。每个会话各自编号，短号在其会话内唯一；`/rewind <短号>` 只在当前会话（与工作区）的检查点里解析。
- **单调且永不复用。** 配额修剪（`maxSnapshots`）与 `/rewind clear` / `/rewind clear --all` 只删除记录、绝不释放短号：clear 之后的下一个检查点接着此前的水位继续（`#1 #2 #3` 之后 clear，下一个是 `#4` 而不是 `#1`）。短号写在记录本身，计数器存在存储域的 global 槽里，所以删记录不可能把它清零。
- **旧检查点在首次触达时补号。** 本功能之前写入的记录（没有短号字段）会在该会话第一次被列出或回退时按创建序补号，并持久化；新检查点接在其后。既不跳号也不改号，id 前缀寻址照旧可用。
- `/rewind list`（详细列表）保持不变：每行仍打印 8 位 id，并在最后一行指向 `/rewind list brief` 以查看短号。

`preview` 使用相同的定位方式解析并打印影响，不请求确认，也不写入任何内容。

## 安装与卸载

- **git 渠道**（最新 `main`）：`dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind` —— 纯 ESM，无需 `prepare` 或 `allowBuilds` 步骤。
- **npm 渠道**（已发布版本）：`dsh plugin --profile web add dsh-checkpoint-rewind`。
- **tarball 渠道**：在本仓库执行 `npm pack`，然后 `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`。
- **存储栈**（检查点必需，挂载不必需）：`@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json`（配置 `root`）+ `@deepseek-ai/dsh-storage-domain`（配置 `backend: json`）——见快速开始；未组合时插件仍可挂载，每条命令都会说明修复方法。
- **卸载**：`dsh plugin --profile web remove dsh-checkpoint-rewind` —— 快照文件保留，直到你删除 `$DSH_HOME/dsh-checkpoint-rewind`；git 对象会被垃圾回收。

## 配置

所有可调项都是 Schemastery `Config` 字段（可在 cordis.yml 中修改）。没有任何硬编码。provider 选项（`gitBin`、`snapshotDir`、`excludeGlobs`、`verifyByHash`）在使用时从实时配置读取，cordis.yml 的改动无需重启即生效。

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关；为 `false` 时完全移除命令、监听器与 provider |
| `provider` | `auto` | 快照 provider：`auto`（有 git 则 git，否则 copy）· `git` · `copy` |
| `gitBin` | `git` | Git 可执行文件路径 |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind`（`$DSH_HOME` 未设置时回退 `~/.dsh/dsh-checkpoint-rewind`） | copy provider 快照根目录 |
| `maxSnapshots` | `50` | 每个会话保留的检查点数（最旧优先清理） |
| `maxSnapshotBytes` | `536870912`（512 MiB） | 全局增量字节软配额（每个存活会话的最新一条总是保留） |
| `pruneOnTurnEnd` | `true` | 轮次结束时执行配额清理 |
| `mutationTools` | `['bash','write','edit','str_replace_editor','pwsh','terminal_send']` | 在 `tools/pre-execute` 上视为变更型的工具 |
| `excludeGlobs` | `['node_modules','.git','.dsh','dist','build']` | copy provider 跳过的 glob 模式 |
| `confirmVia` | `auto` | 确认通道：`auto`（优先 userQuestions）· `userQuestions` · `approval` |
| `listLimit` | `10` | 无参 `/rewind` 显示的检查点数 |
| `preRewindCheckpoint` | `warn` | 恢复前的守护检查点：`warn` · `require` · `off` |
| `verifyByHash` | `false` | copy provider 的内容哈希比对与恢复校验 |
| `autoCheckpoint.enabled` | `true` | `step/start` 上的自动间隔快照 |
| `autoCheckpoint.intervalMinutes` | `0` | 间隔；`0` = 每步 |
| `workspaceRestore` | `restore` | 工作区回滚：`restore`（安全覆盖）· `reset-hard`（CC 风格，需显式开启） |
| `diffRenderer` | `pairwise` | 设置页差异渲染器：`pairwise`（行级文本）· `side-by-side`（逐文件双栏） |
| `selectiveRestore` | `true` | 逐文件选择性恢复（`/rewind … --files`）以及面板的逐文件复选框 + 大小合计 |
| `promptSection` | `true` | 注入一句角色陈述式提示词段落 |
| `checkpointTool` | `true` | 注册 `checkpoint` 模型工具 |

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
        preRewindCheckpoint: warn
```

## 工具与界面

| 界面 | 类型 | 说明 |
|---|---|---|
| `/rewind` | 命令 | `[workspace\|session\|config\|all] <number\|id-prefix\|step <N>\|latest>` · `list [brief]` · `diff <a> <b>` · `preview <target>` · `clear [--all]` |
| `/checkpoint` | 命令 | `[note <text>\|list\|diff <a> <b>]` —— 捕获手动检查点 |
| `checkpoint` | 工具 | 捕获带可选备注的手动检查点 |
| `fs/write-intent` · `fs/edit-intent` · `tools/pre-execute` | 监听器 | 变更前捕获（prepend 直通；绝不抢占策略槽） |
| `session/event` | 监听器 | 轮次/步骤跟踪、自动间隔、边界补记、轮次结束清理 |
| `checkpoints` 投影 | 会话投影 | 由会话日志折叠出的时间线条 |
| 设置页时间线 | 客户端 | `Plugins → Checkpoints` 标签页，附两两 diff |

## 安全模型

- **Git 历史不可触碰。** git provider 只运行白名单内的无副作用原语——`stash create`、`commit-tree`、`restore --worktree`、`ls-tree`、`diff-tree`、`ls-files`、`status`、`rev-parse`、`cat-file -e`——由运行时断言强制，且对象引用在传给 git 前被校验为十六进制 id（被篡改的记录无法注入 git 选项）。**默认绝不 `reset --hard`、绝不 `clean`、绝不改写索引或历史**（见下文 `workspaceRestore`）。
- **覆盖式回滚，绝不删除。** 恢复只覆盖已捕获的文件，且 git provider 恢复**显式路径**（`git restore … -- .` 会删除检查点之后 `git add` 过的文件）。检查点之后新建的文件（未跟踪**或**已暂存）会被*报告*并原样保留。
- **不写穿链接、不路径穿越。** copy provider 在将检查点引用拼入快照目录路径前会校验它们，并拒绝通过已变为符号链接的目标（或其祖先）恢复——因此恢复永远不会跟随链接跑出工作区。
- **恢复必须经批准。** 覆盖用户文件始终经过带 `ask` 语义的确认接缝；缺失、抛错或回答“否”的 answerer **失败关闭**。`/rewind preview` 是先行查看影响的只读方式。
- **回滚可逆。** 恢复前会先捕获当前状态的守护检查点；恢复该守护检查点即可撤销本次回滚。当无法捕获守护检查点时，`preRewindCheckpoint: require` 会中止回滚。
- **固定顺序事务。** 先守护、再工作区、再配置、再会话重放；每一阶段都有日志；恢复失败时文件、检查点与会话均保持原样。
- **`workspaceRestore: 'reset-hard'` 等价于 CC，且需显式开启。** 它运行 `git reset --hard <snapshot commit>`（分支头移动到快照提交；快照前的历史仍可通过 reflog 恢复；未跟踪文件不受影响）。默认关闭。
- **模型可见 ⟺ 落盘。** 用户或模型看到的一切都能从 `command/run` + `command/done`（以及宿主认识它们之后的 `checkpoint/*` 事件）加上持久化的 `checkpoints` 领域重建。

## 工作原理

```text
capture ── fs/write-intent · fs/edit-intent · tools/pre-execute (prepend, pass-through)
        ── step/start auto interval ── /checkpoint · checkpoint tool ── pre-rewind guard
             │
             ▼  ProviderRegistry.resolve(auto)  →  git: stash create / commit-tree
             │                                     copy: incremental dir + hardlinks
             ▼
        checkpoints storage domain (SQLite rows / JSON file)  +  checkpoint/* event (adaptive gate)

/rewind <target> ── confirm (userQuestions / approval, fail-closed) ──▶ guard checkpoint
             ├─ workspace: provider.restore(ref)  (restore | reset-hard)
             ├─ config:   settings write-back (persisted on the profile patch)
             └─ session:  SessionStore.fork(source, boundary) → new child session (original untouched)
```

完整决策记录、事件词汇表与 provider 接缝契约：[ARCHITECTURE.md](ARCHITECTURE.md)。

## 会话事件（rc.2 说明）

该插件将 `checkpoint/snapshot`、`checkpoint/bound`、`checkpoint/prune` 与 `checkpoint/rewind` 声明为仅日志的 `SessionEventMap` 成员。Harness rc.2 **没有插件事件注册面**，且 `Session.append` 不会盖章 `ignorable` 信封（其第三个参数是 surface intent 而非选项），因此追加未知类型会让会话在重新加载时无法读取。该插件因此通过**自适应门**追加：运行时探测（在一个分离的、永不持久化的会话存储上）检测宿主的 `append` 是否会盖章 `ignorable` 信封——在 rc.2 上门保持关闭；在支持它的宿主上，`checkpoint/*` 事件会自动以 `ignorable: true` 追加。在那之前，权威审计链是 `command/run` + `command/done`（宿主已知）加上持久化的 `checkpoints` 存储领域。

## Web UI 锚点

插件在命令结果中返回新会话 id（`session: <id>`），Web shell 可以跳转过去。**会话投影单元 `checkpoints` 已随附**：每当 `ctx.sessionProjections` 存在时，插件通过 `ctx.inject` 注册该单元（把 `checkpoint/snapshot|bound|prune|rewind` 折叠成整值列表）——在 rc.2 宿主上它保持空列表，直到某个 harness 版本随附 `checkpoint/*` 词汇表或 `ignorable` 信封，届时零插件改动即可填充。

## FAQ

**这会不会取代 git？** 不会——在可用时会*使用* git。在 git 仓库中，你得到字节级精确、去重、不触碰历史的快照对象；在任何其他目录中，copy provider 用普通文件实现同样的效果。常规提交仍是你长期的历史。

**为什么默认不使用 `git reset --hard`？** 因为破坏状态不是安全网的工作。默认情况下，插件仅创建无引用的对象并执行仅针对工作区、明确指定路径的恢复，因此错误的后退永远不会丢失提交历史、暂存区或在检查点之后创建的文件。对于明确希望与 CC 保持一致的用户，可以在 `workspaceRestore: 'reset-hard'` 选项后使用 `reset-hard`。

**快照的可恢复窗口是多久？** git-provider 快照不持有任何 ref。它们在设计上是未引用的 `stash create`/`commit-tree` 对象，`discard` 仅删除元数据记录，将底层对象留给 `git gc`。两个独立的机制决定快照实际可恢复的时长：插件自身的配额修剪（`maxSnapshots` 默认每会话保留 50 个；`maxSnapshotBytes` 默认 512 MiB 全局软配额，每次捕获时通过 `pruneAll()` 执行并在轮次结束时扫描清理），以及宿主仓库的 git gc。使用 git 默认配置时，未引用对象会存活至 auto-gc 触发，且仅删除早于 `gc.pruneExpire`（默认 2 周）的对象。手动的 `git gc --prune=now`、激进的 repack、`filter-repo` 或重新克隆会立即删除它们。现在会预先检测已修剪的对象：git provider 在恢复前先用 `git cat-file -e` 探测快照对象，对象缺失时显式失败而不是静默恢复为空；doctor pass 会遍历每条检查点记录探测对象存在性，并把不可恢复的条目标记出来（列表中显示 `[UNRESTORABLE: object missing]`）。doctor pass 已实现并有测试，但尚未接线到恢复路径（restore 尚不读取 `unrestorable` 标记；仍在 discussion #13 跟进）。

**我可以回滚到回合中间的某一步吗？** 文件恢复是精确到单步的（`/rewind step <N>` = ≤ N 的最近快照）。但是，会话重放遵循 Harness 的重放粒度：子会话将从检查点所在的回合边界开始重放。

**如果没人能回答确认会怎样？** 不触碰任何内容——插件失败关闭（`unavailable`/`rejected`），保留检查点，并返回解释性错误。在 rc.2 上使用 `confirmVia: approval` 时，消息会提示挂载 userQuestions，因为 approval 需要开放的轮次，而命令在轮次之间运行。

**能撤销一次回滚吗？** 能——每次经批准的回滚都会先捕获回滚前状态的守护检查点；结果会打印 `rewind guard: <id>`，`/rewind <guard-id>` 会恢复该状态。

**如何定位检查点？** 用**会话短号**（`/rewind 3`，见 `/rewind list brief`；每会话独立、单调、永不复用）、唯一 id 前缀（列表里的 8 位 id 仍然可用）、`/rewind step <N>`、`/rewind latest`。`/rewind clear` 删除本会话的检查点，`/rewind clear --all` 删除所有会话与工作区的检查点（文件不受影响）——两者都不会让编号复位。`/rewind preview <target>` 使用相同的定位方式来查看影响。

**为什么 clear 之后编号还继续往上走？** 因为短号是地址而不是位置：clear 之后把 `#1` 重新分配给另一个检查点，会让任何提到过 `#1` 的地方被静默改指。计数器持久在 `checkpoints` 存储域的 global 槽里，每条记录也各自记住自己的短号，因此修剪与清空只删快照、不回收 id。


**`preview` 做什么——又不做什么？** 它解析检查点，然后运行只读比较：哪些文件会被覆盖（或重建）、哪些已经一致、以及检查点之后创建的哪些文件会原样保留。它从不提示、从不写入、从不 fork，也不记录 `checkpoint/rewind` 事件——批准门只在真正的 `/rewind <id>` 上运行。

## 演示

一次真实的组装式 headless 集成运行（`npm run test:integration`）驱动完整流程：代理在两个轮次中修改文件，然后 `/rewind preview` 以只读方式查看影响（无确认门、无写入），`/rewind <id>` 恢复文件并把会话重放进新的子会话。该运行断言文件内容、重放后的子上下文、保护检查点，以及检查点之后创建的文件得以保留 —— 覆盖 copy 与 git 两种 provider 流程（git 流程还断言 `HEAD` 与 reflog 未被触碰）。驱动脚本位于 `test/integration/rewind-headless.mjs`。

## 权限与数据

- **权限**：workshop 清单声明 `workspace:read`、`workspace:write`、`git:read`、`git:write`、`snapshot-storage:write`、`session-log:read`、`settings:write` 与 `network:none`。
- **数据**：检查点记录位于 `checkpoints` 存储域（SQLite 行或 JSON 文件）；copy 快照位于 `snapshotDir`。存储域的 **global 槽**保存每会话短号计数器，所以删除记录（`prune`、`clear`、`clear --all`）绝不会回收短号。完全本地——无网络、无凭据。存储域按双版本打开：0.4.x 时代的介质（域 v1）以兼容模式打开，旧记录保持可读、新捕获按 v2 形状落盘——升级插件永远不会遗弃既有介质。
- **会话日志**：`checkpoint/*` 事件经自适应门追加；权威审计链是 `command/run` + `command/done` 加上持久化领域。

## 安全边界

- **Git 历史不可触碰。** 白名单内的无副作用原语；`reset --hard` 仅在显式开启的 `workspaceRestore: 'reset-hard'` 模式之后。绝无 `git clean`。
- **覆盖式回滚，绝不删除。** 恢复只覆盖已捕获的文件；检查点之后创建的文件会被报告并原样保留。
- **不写穿链接、不路径穿越。** copy 的 `ref` 会作为快照 id 校验；恢复拒绝跟随符号链接跑出工作区。
- **恢复必须经批准。** 缺失或拒绝的 answerer 失败关闭。
- **回滚可逆。** 先捕获回滚前状态的守护检查点。

## 已知限制

- 在 rc.2 上，`checkpoint/*` 会话事件被自适应门抑制；在宿主随附该词汇表或 `ignorable` 信封之前，审计链由 `command/run` + `command/done` 加存储领域承担。
- `confirmVia: approval` 需要开放的轮次，而命令在轮次之间运行——在 rc.2 上请挂载 userQuestions（或设 `confirmVia: userQuestions`）。
- 会话回退会在检查点边界 **fork 出一个新的子会话**；它绝不改写或截断原会话。
- `workspaceRestore: 'reset-hard'` 会把分支头移动到快照提交；默认关闭。
- 在任何已关闭轮次之前捕获的检查点没有重放边界——此时会话回退会创建一个上下文为空的崭新子会话。

## 故障排查

| 症状 | 原因 / 修复 |
|---|---|
| `/rewind <id>` 提示 `rewind cancelled: no confirmation answerer` | 没有挂载 userQuestions/approval 通道——插件失败关闭。请在 Web UI 中运行（或挂载一个提问 provider）；`confirmVia` 选择通道。 |
| `/rewind <id>` 提示 `approval requires an open turn …` | 命令在轮次之间运行，而 approval 需要轮次——挂载 userQuestions 或设 `confirmVia: userQuestions`。 |
| `rewind: checkpoint registry unavailable` | `checkpoints` 存储域无法打开。要么 `storageDomain` 服务未组合（按「快速开始」添加存储栈三行：`@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json`（配置 `root`）+ `@deepseek-ai/dsh-storage-domain`（配置 `backend: json`）），要么后端本身出错；检查 harness 日志。 |
| 某检查点显示为 `fork: pending (turn not closed)` | 它的轮次还没有 `turn/end`；文件仍可恢复，但会话重放要等轮次关闭。 |
| `files restored … but the session was NOT replayed` | 事务的会话阶段失败（没有已关闭边界，或重放被拒）。文件保持已恢复；用打印出的 `rewind guard: <id>` 撤销。 |
| `rewind: aborted — the pre-rewind guard checkpoint could not be captured` | `preRewindCheckpoint: require` 因守护捕获失败而拒绝回滚；修复存储（或设 `warn`/`off`）。 |
| 某检查点显示为 `(copy)`，尽管目录是仓库 | 尚无 HEAD（没有初始提交）：git 快照原语需要 HEAD，因此插件在首次提交前降级为 `copy`。 |
| headless 运行中 `MISSING_CREDENTIAL` | 与本插件无关：模型 provider 未配置 `DEEPSEEK_API_KEY`。 |
| 快照存储增长 | 每次快照后及 `turn/end`（`pruneOnTurnEnd`）都会清理；调低 `maxSnapshots` / `maxSnapshotBytes`、运行 `/rewind clear`，或卸载后删除 `$DSH_HOME/dsh-checkpoint-rewind`。 |

## 开发

```sh
npm install               # peer 依赖：@deepseek-ai/dsh-session@0.1.2-rc.1、schemastery、zod
npm test                  # node --test test/**/*.test.mjs（含 provider 套件）
npm run test:integration  # 组装式 headless 验证（test/integration/）
```

无构建步骤：纯 ESM——`index.mjs`/`lib/` 即发布产物。

## 主题

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## 贡献者

- [@PerryLink](https://github.com/PerryLink) —— 创建者与维护者：三态检查点模型、git/copy provider 接缝、三阶段回滚事务、设置页时间线、文档、CI/CD 与发布。
- [@tmpdot](https://github.com/tmpdot)（rmUnlucky）—— v1 介质双版本兼容（#8）、惰性 `storageDomain` 解析（#9）、checkpoint 去重回复提示（#10），以及 `$DSH_HOME` 未设置时快照目录回退的 bug 报告（#4）。
- [@shipinliang](https://github.com/shipinliang) —— checkpoint 面板 wire 契约报告：`limit` 参数缺失 `acceptsUndefined`（#5）与 `#deps` 私有字段代理失败（#6）。
- [@hwz1456](https://github.com/hwz1456) —— web profile 检查点捕获报告（#3）。
- [@Andiii208](https://github.com/Andiii208) —— `plugin_check` 发布规范报告（#2）。
- [@alexchenzl](https://github.com/alexchenzl)（Ashu）—— DSH Directory 收录邀请（#7）。

## 与其他 DSH 插件的互操作

已对照 **DSH `0.2.0-rc.2`**（本 README 面向的运行时）与 2026-10-05 实测的高星插件集验证。

本插件**不干扰**其他插件，包括广泛安装的高星插件：

- **无工具名冲突。** 所有工具都带命名空间，不占用任何已被内置工具或其他插件持有的裸名。
- **无服务键冲突。** 不提供任何服务键，因此不存在服务键冲突。
- **无 slot 冲突。** 不注册客户端 slot key，因此不参与 `shadows-shipped-ui` 座位争抢。
- **无 HTTP 路由冲突。** 不注册任何 `webServer` 前缀。
- **无 patch 层冲突。** 组合包 patch 只 `insert` 自己那一行，从不覆写内置行的 `config`。
- **无全局改写。** 不改原型、不改写 `process.env`、不替换全局 fetch dispatcher。

**共享事件监听器在构造上就不互相干扰。** 它用 `ctx.on()` 监听顺序敏感事件 `fs/edit-intent`, `fs/write-intent`, `tools/pre-execute` —— Cordis 的**广播**语义：每个监听器都会运行，任何一个都无法饿死其他监听器。**此处每个监听器都通过 `next()` 委托**，因此链条绝不会被短路；改写作用在 `next()` 产出的值上，而不是用它顶替返回：
  - `tools/pre-execute` — also used by `cc-safety-net` (1576★).

静态证据：`dsh-plugin-doctor` 的 K10–K13 在本仓全部为 `pass`。

## PerryLink DSH Plugin Family

本项目是 [PerryLink](https://github.com/PerryLink) 维护的 DeepSeek Harness 插件家族成员：**87 个活跃维护**，名册共 **95** 个，其中 **5 个已冻结**、**3 个已退役**。完整名单默认折叠，避免每个 README 的首屏被长表淹没；点击展开可查看每一行，原因见「状态」列。

<details>
<summary>展开全部 95 个插件</summary>

| 插件 | 一句话 | 状态 |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 已退役 — 见仓库 README |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 已冻结 — 见仓库 README |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 已冻结 — 见仓库 README |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 已冻结 — 见仓库 README |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 已冻结 — 见仓库 README |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** | 应急演练脚本核对（按阶段、响应分级、指挥与资源要素核对脚本齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** | 环评导则适用性核对（按要素、导则名称与执行标准核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** | 应急预案要素齐备性与条款级页码定位（依据 GB/T 29639-2020 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** | 作文量表评分核对（按评分项、原文定位与分值算术核对评分自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** | 证据清单齐备性核对（按待证事实与证据要素核对清单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** | 出口管制物项核对（按管制清单、最终用途与许可证核对台账齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** | FMEA 分析表要素齐备性与风险顺序数一致性核对（按公开的 FMEA 方法标准核对表内自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** | 预测准确率考核核对（按准确率、门槛与考核单价核对考核费用的算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** | 公文流转与办理时限核对（按公开的公文处理规范核对环节完整性与时限，仅提示差异，不作出定性结论） |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** | 公文格式要素核对（按公开的党政机关公文格式标准核对版头与主体要素，仅提示差异，不作出定性结论） |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** | 劳动保护与安全防护用品配置表核对（按公开的配备标准核对品名规格与配置数量，仅提示差异，不作出定性结论） |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** | 危险化学品临界量与重大危险源辨识核对（按储存量与临界量核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** | HAZOP 分析表要素齐备性与偏差推导一致性核对（依据公开的危险与可操作性分析标准，仅提示差异，不作出定性结论） |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** | 安全隐患台账→《工贸企业重大事故隐患判定标准》（应急管理部令第10号）条款映射提示（仅提示差异，不作出定性结论） |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** | 商品归类层级一致性核对（按章、品目、子目与商品编号的层级关系核对自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** | ICD 合并编码与星剑号配对提示（依据 GB/T 14396-2016 与公开的 ICD 使用说明，仅提示差异，不作出定性结论） |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** | 法条引用与文书要素核对（按名称、条号、原文与效力状态核对引用可核验性，仅提示差异，不作出定性结论） |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** | 信用证单据条款核对（按单据种类、份数、期限与不符点核对交单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** | 能力差距与培养计划核对（按能力等级差、培养措施与完成期限核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** | 病案首页形式质控与逻辑矛盾提示（依据国卫办医发〔2016〕24号等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** | 国家自然科学基金申请书形式审查与匿名化提示（依据《国家自然科学基金条例》与申请人导入的当年指南，仅提示差异，不作出定性结论） |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** | 护理记录时限、签名与评估表完整性校验（依据《病历书写基本规范》等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** | 原产地区域价值成分核对（按 RVC 定义式与门槛核对原产地判定自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** | 在线点评回复台账核对（按回复时限、问题分类与整改状态核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** | 试卷解析结构核对（按题型、答案、分值与 yotta 标识核对试卷结构自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** | 行政许可办理核对（按申请材料、法定时限与决定记录核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** | 项目全流程文件链条核对（按环节先后与金额口径核对链条自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** | 起诉状要素齐备性核对（按诉请、事实、证据、法条四要素核对文书齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** | 政策专报要素核对（按观点、依据、出处与建议核对专报齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** | 线损电量拆分与考核表核对（依据公开的线损计算口径，仅提示差异，不作出定性结论） |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** | 电力工作票要素齐备性与签发许可顺序核对（依据现行电力安全工作规程，仅提示差异，不作出定性结论） |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** | PPAP 提交要素齐备性核对（按公开的 PPAP 手册与提交等级核对要素齐备与版本填写，仅提示差异，不作出定性结论） |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** | 质疑与投诉期限核对（按公开的政府采购质疑投诉规定核对期限与台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** | 铁路施工天窗台账核对（按时间窗、时长算术与命令号核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 已冻结 — 见仓库 README |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 已退役 — 见仓库 README |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 已退役 — 见仓库 README |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>

</details>

### 从 DSH Desktop 市场安装

所有 PerryLink 插件均可在 DSH Desktop 内置市场中浏览：**市场 → 来源 → 添加来源 → 粘贴** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ 选中**。安装仍需通过市场的 npm 身份校验与你的确认。

## 许可证

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors
