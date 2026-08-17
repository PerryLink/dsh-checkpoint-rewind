<div align="center">

# ⏪ dsh-checkpoint-rewind

**Unified DeepSeek Harness checkpoints — session + workspace + config three-state snapshots with one-shot rollback.**

*The Claude Code Checkpoints equivalent, built as a capability-seam plugin: capture before every mutation, restore any of the three states with one approved command.*

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

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers pinned to `0.1.0-rc.6`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Platforms | All (host commands + listeners; optional Settings page timeline via the settings capability) |
| Model | Any (no model calls — snapshots and restores are deterministic) |

## What you get

`dsh-checkpoint-rewind` captures a **three-state unified checkpoint** — workspace, session cursor, and plugin config — and restores one or all three with a single approved command:

1. **Three-state record** — every checkpoint stores the workspace state (git tree SHA, or a copy manifest), the session event cursor (`seq` + turn boundary), and a config snapshot, tagged by source (`manual` / `auto` / `guard` / `mutation`).
2. **Four capture triggers** — before every mutating tool (`fs/write-intent`, `fs/edit-intent`, `tools/pre-execute`), on automatic interval (`autoCheckpoint`, default every step), manually (`/checkpoint` and the `checkpoint` tool), and as a guard before every rewind.
3. **git-first provider** — `git stash create` / `commit-tree` produce unreferenced snapshot objects that never touch your worktree, index, or history; restore is worktree-only and path-explicit. Non-git directories (and unborn-HEAD repos) degrade to an incremental `copy` provider with hardlink reuse.
4. **One-shot rollback** — `/rewind workspace|session|config|all <target>` restores the selected states; `preview` is a read-only impact report, `diff <a> <b>` compares two checkpoints, `clear` deletes them.
5. **Seed-replay session rollback** — session rollback replays events up to the checkpoint boundary through the official `sessions.create` seed API into a new child session; the original session keeps its full history.
6. **Settings page timeline** — the `Plugins → Checkpoints` tab renders the session's checkpoints with pairwise line-level diffs.

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

The package is pure ESM with no build step — `index.mjs` and `lib/` are the shipped artifacts. Workspace mutations now create checkpoints automatically; run `/rewind` to list them.

## Install & uninstall

- **git channel** (latest `main`): `dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"` — pure ESM, no `prepare` or `allowBuilds` step.
- **npm channel** (published releases): `dsh plugin --profile web add dsh-checkpoint-rewind`.
- **tarball channel**: `npm pack` in this repo, then `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-checkpoint-rewind` — snapshot files stay until you delete `$DSH_HOME/dsh-checkpoint-rewind`; git objects are garbage-collected.

## Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). Nothing is hardcoded.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch; `false` removes the commands, listeners, and providers entirely |
| `provider` | `auto` | Snapshot provider: `auto` (git if available, else copy) · `git` · `copy` |
| `gitBin` | `git` | Git executable path |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` | Root for copy-provider snapshots |
| `maxSnapshots` | `50` | Checkpoints kept per session (oldest pruned first) |
| `maxSnapshotBytes` | `536870912` (512 MiB) | Global incremental-byte soft quota (newest per session always retained) |
| `pruneOnTurnEnd` | `true` | Run quota pruning when a turn ends |
| `mutationTools` | `['bash','write','edit','str_replace_editor','pwsh','terminal_send']` | Tools treated as mutating at `tools/pre-execute` |
| `excludeGlobs` | `['node_modules','.git','.dsh','dist','build']` | Glob patterns skipped by the copy provider |
| `confirmVia` | `auto` | Confirmation channel: `auto` (userQuestions first) · `userQuestions` · `approval` |
| `listLimit` | `10` | Checkpoints shown by bare `/rewind` |
| `preRewindCheckpoint` | `warn` | Guard checkpoint before restore: `warn` · `require` · `off` |
| `verifyByHash` | `false` | Copy-provider content-hash comparison and restore verification |
| `autoCheckpoint.enabled` | `true` | Automatic interval snapshots on `step/start` |
| `autoCheckpoint.intervalMinutes` | `0` | Interval; `0` = every step |
| `workspaceRestore` | `restore` | Workspace rollback: `restore` (safe overwrite) · `reset-hard` (CC-style, opt-in) |
| `promptSection` | `true` | Inject a short role-statement prompt section |
| `checkpointTool` | `true` | Register the `checkpoint` model tool |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `/rewind` | command | `[workspace\|session\|config\|all] <id-prefix\|step <N>\|latest>` · `diff <a> <b>` · `preview <target>` · `clear` |
| `/checkpoint` | command | `[note <text>\|list\|diff <a> <b>]` — capture a manual checkpoint |
| `checkpoint` | tool | Capture a manual checkpoint with an optional note |
| `fs/write-intent` · `fs/edit-intent` · `tools/pre-execute` | listeners | Pre-mutation capture (prepend pass-through; never steals the policy slot) |
| `session/event` | listener | Turn/step tracking, auto interval, boundary backfill, turn-end pruning |
| `checkpoints` projection | session projection | Timeline strip folded from the session log |
| Settings page timeline | client | `Plugins → Checkpoints` tab with pairwise diffs |

## Permissions & data

- **Permissions**: the workshop manifest declares `workspace:read`, `workspace:write`, `git:read`, `git:write`, `snapshot-storage:write`, `session-log:read`, `settings:write`, and `network:none`.
- **Data**: checkpoint records live in the `checkpoints` storage domain (SQLite rows or a JSON file); copy snapshots live under `snapshotDir`. Fully local — no network, no credentials.
- **Session log**: `checkpoint/*` events are appended through an adaptive gate (only when the host knows the types or supports the `ignorable` envelope); the authoritative audit chain is `command/run` + `command/done` plus the durable domain.

## Security boundaries

- **Git history is untouchable.** The git provider runs only whitelisted side-effect-free primitives (`stash create`, `commit-tree`, `restore --worktree`, …); `reset --hard` only exists behind the opt-in `workspaceRestore: 'reset-hard'` mode. No `git clean`, ever.
- **Overwrite rollback, never deletion.** Restore overwrites captured files only; files created after the checkpoint are reported and left in place.
- **No writes through links, no path traversal.** Copy `ref`s are validated as snapshot ids; restore refuses to follow symbolic links out of the workspace.
- **Restore requires approval.** Overwriting user files always goes through the confirmation seam; a missing or denying answerer fails closed.
- **Rewind is reversible.** A guard checkpoint of the pre-rewind state is captured first; `/rewind <guard-id>` undoes the rewind.
- **Model-visible ⟺ logged.** Everything a user or model sees reconstructs from `command/run` + `command/done` and the durable `checkpoints` domain.

## Known limitations

- On rc.6, `checkpoint/*` session events are suppressed by the adaptive gate (the host does not know the types); the audit chain rides `command/run` + `command/done` plus the storage domain until a host ships the vocabulary or the `ignorable` envelope.
- `confirmVia: approval` needs an open turn, and commands run between turns — mount userQuestions (or set `confirmVia: userQuestions`) on rc.6.
- Session rollback creates a **new child session** seeded from the checkpoint boundary; it never rewrites or truncates the original session.
- `workspaceRestore: 'reset-hard'` is CC-equivalent and moves the branch head to the snapshot commit; it is off by default.

## Development

```sh
npm install               # peer deps: @deepseek-ai/dsh-session@0.1.0-rc.6, schemastery, zod
npm test                  # node --test test/**/*.test.mjs (provider suites incl.)
npm run test:integration  # assembled-headless verification (test/integration/)
```

## Topics

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — creator and maintainer: the three-state checkpoint model, the git/copy provider seam, the three-phase rewind transaction, the Settings page timeline, docs, CI/CD and releases.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors
