# AGENTS.md

`dsh-checkpoint-rewind` 是 DeepSeek Harness 的能力接缝插件：为 DSH 补上 Claude Code `/rewind` 等价能力 —— **git 优先的工作区文件快照 + 会话边界回退（fork 种子会话）+ 一键恢复**。别的回退插件卖 Change Ledger（`Anionex/dsh-turn-rewind`）或纯上下文回退（`LingLambda/dsh-undo`），本插件卖 **git 对象级快照 + fork 种子会话 + 三段式恢复事务（保护检查点 → 恢复 → fork）**。DSH 哲学是 **everything is a plugin**——本仓库只做插件，不碰引擎。改代码前先读 `README.md`（对外契约）、`ARCHITECTURE.md`（设计决策）与 `test/`（现有行为）。

## 仓库布局：发布面 / 本地工程面

根目录只放发布到 GitHub / npm 的文件；本地工程文件一律收进 `dev/`（gitignore，永不提交）。

```
index.mjs            插件入口（唯一 host 面文件）：provider 注册/事件监听//rewind 命令
types.d.ts           类型契约：checkpoint/* SessionEventMap 声明合并 + 配置类型
lib/constants.mjs    词汇表与协议常量（provider/事件名/错误码/默认值，零依赖）
lib/errors.mjs       结构化领域错误（code + details，零依赖）
lib/workspace.mjs    工作区键规范化 + 快照目录解析（零依赖）
lib/checkpoints.mjs  检查点纯函数：≤N 映射、清理计划、列表/预览渲染（零依赖）
lib/glob.mjs         轻量 glob → 相对路径匹配器（copy provider 排除项用，零依赖）
lib/gate.mjs         回退确认门 + 会话事件自适应门（零依赖）
lib/lock.mjs         按键串行化互斥（零依赖）
lib/domain.mjs       'checkpoints' 存储领域 spec（唯一允许 zod/DSH 包的 lib 模块）
lib/projection.mjs   会话投影单元 checkpoints（持久边界校验器，允许 zod）
lib/providers/       provider seam：definition（契约）/ registry / git / copy
cordis.patch.yml     bundle 声明（insert checkpoint-rewind）
package.json         npm 元数据；files 白名单 = 发布内容
README.md            英文主介绍（GitHub 默认页；五语源文）
README.{zh,es,pt,hi}.md   中/西/葡/印地语介绍（顶部互链，与英文同 commit 更新）
ARCHITECTURE.md      三角色 seam 架构图与全部设计决策
CHANGELOG.md / SECURITY.md   变更记录 + 安全政策（含安全面矩阵）
.github/workflows/ci.yml     单元测试 + 组装式集成验证（Windows/Linux × Node 22/24）
.github/workflows/publish.yml   tag v* → 测试 + npm publish（NPM_TOKEN secret）
LICENSE / THIRD_PARTY_NOTICES.md   Apache-2.0 + 复用出处标注
test/                单测 + test/integration/ 组装式集成验证（进 GitHub，不进 npm 包）
dev/                 ❌ 本地工程面：冒烟脚本、夹具、演示——永不提交
```

- 新增被 `index.mjs` import 的模块必须同步加进 `package.json` 的 `files`。
- **行为变更需同步五语 README**：以 README.md（英文）为源，中/西/葡/印地四语同 commit 更新；顶部互链行与 Topics 行保持五语一致。
- **永不提交**：`dev/`、`node_modules/`、真实用户工作区快照（含敏感内容）、任何凭据/密钥。

## 命令

```sh
npm install          # 安装 peer 依赖（@deepseek-ai/dsh-session@0.1.0-rc.6、schemastery、zod 等）
npm test             # node --test 跑 test/**/*.test.mjs（含 test/providers/ 单测套件；集成验证单独跑）
npm run test:integration   # 组装式 headless 集成验证（test/integration/，不进发布包）
```

无构建步骤：纯 ESM，`index.mjs`/`lib/` 即发布产物。

## 提交纪律

- conventional commit 前缀：`feat:` / `fix:` / `refactor:` / `chore:` / `docs:` / `test:`，中文描述。
- 一个逻辑变更一个 commit；每完成一个功能模块跑 `npm test` 后提交。
- 提交前必过：`npm test` 全绿；`git status` 无杂物；`git diff --cached --check` 无空白错误。
- 行为变更同 commit 更新测试与五语 README。

## DSH 插件约束（红线）

- **只消费公开服务**：`sessions` / `storageDomain` / `commands`（`inject` 声明）；`userQuestions` / `approval` 按需可选查找（缺失 = 失败关闭）。不修改 DSH 引擎 / agent-loop / apiproxy / 官方 UI 包。
- **注册即 effect**：一切贡献走 `ctx.effect()` / `ctx.on()` / 服务 `register()`（返回 disposer）；provider 注册的 disposer 交给 `ctx.effect()`；绝不手动收尾。
- **waterfall 直通**：`fs/write-intent` / `fs/edit-intent` / `tools/pre-execute` 的监听必须调用 `next()` 并原样返回（快照是旁路观察，决策槽仍归策略插件）。
- **模型可见 ⟺ 落盘**：回退结果与检查点列表由 `command/run` + `command/done`（宿主已知事件，命令运行时自动落盘）+ 领域记录重建；`checkpoint/*` 事件经自适应门追加（宿主收录该类型或支持 `ignorable` 信封时自动开启）。
- **恢复必须先确认**：`/rewind <id>`（及 `/rewind clear`）在覆盖用户文件/删除检查点前必须经确认门（`userQuestions` / `approval`，ask 语义）；任何回答者缺失/抛错 → 拒绝，绝不静默放行。
- **git 安全边界**：只允许 `stash create` / `commit-tree` / `restore --worktree` 一类无副作用原语（白名单 + 运行时断言）；恢复必须是**显式路径**分块（`git restore … -- .` 会删除检查点之后 `git add` 的新文件，禁止发出）；绝不 `reset --hard` / `clean` / 改写索引或历史。
- **失败要大声**：非法配置加载期抛错；领域打开失败/恢复失败/fork 失败返回结构化错误文本；绝不静默吞、绝不静默截断。
- **本地优先**：零网络、零凭据；文件快照只写 `snapshotDir`（默认 `$DSH_HOME/dsh-checkpoint-rewind/`）。

## 会话事件的 rc.6 约束（必读）

本插件在 `types.d.ts` 声明了 `checkpoint/snapshot|bound|prune|rewind` 的 SessionEventMap 合并，但**运行时经自适应门决定是否 append**：rc.6 无插件事件注册面（`KNOWN_SESSION_EVENT_TYPES` 不含 checkpoint/*，`Session.append` 静默丢弃未知选项键、无法盖章 `ignorable`），append 未注册类型会让该会话下次加载被持久化层拒绝。门 = 类型被宿主收录 **或** 运行时探测证明宿主 append 盖章 `ignorable` 信封（探测在独立 detached store 上做，绝不接入宿主持久化）。审计链由宿主已知事件（`command/run` + `command/done`、`approval/*`）+ `checkpoints` 存储领域承担。**不要"顺手"取消这个自适应门，也不要让探测会话进宿主持久化。**

## 质量约定

- 文件以恰好一个换行结尾；空 `catch` 说明吞掉什么且 `try` 只包一条语句；不注释显而易见的事实。
- `lib/` 不依赖 DSH 包；**例外** `lib/domain.mjs`（领域 spec 必须用宿主 `defineDomain`/`domainTable` 保持同一实例），`zod` 仅允许出现在 `lib/domain.mjs` 与 `lib/projection.mjs`（持久边界校验器）。
- 测试描述行为而非背书正确性；fixtures 用合成数据，永不掺真实用户工作区；git provider 用 scripted runner 测试命令序列，真实 git 测试检测环境能力后运行/跳过（跳过要说明原因）。
- 复用他人代码处标注 license 与出处（THIRD_PARTY_NOTICES.md + 文件头注释）。

## 编辑本文件

规则保持自包含；改完须与仓库现状一致。
