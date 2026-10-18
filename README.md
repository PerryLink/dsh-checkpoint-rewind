<div align="center">

# ⏪ dsh-checkpoint-rewind
- **1024 store channel**: `npm i -g dsh1024` once, then `dsh1024 plugin --profile web add dsh-checkpoint-rewind` (counts toward the [deepseek1024.com](https://deepseek1024.com) install ranking).
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-checkpoint-rewind)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-checkpoint-rewind?metric=downloads)](https://dshfind.com/plugins/PerryLink/dsh-checkpoint-rewind?ref=badge)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/PerryLink/dsh-checkpoint-rewind/badge)](https://api.securityscorecards.dev/projects/github.com/PerryLink/dsh-checkpoint-rewind)

**Unified DeepSeek Harness checkpoints — session + workspace + config three-state snapshots with one-shot rollback.**

*The Claude Code Checkpoints equivalent, built as a capability-seam plugin: capture before every mutation, restore any of the three states with one approved command.*

> **Official repository.** This is the only official repository of dsh-checkpoint-rewind, maintained by PerryLink. Same-name repositories under other accounts are not affiliated.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![dsh-doctor](https://raw.githubusercontent.com/PerryLink/dsh-plugin-doctor/main/badges/PerryLink__dsh-checkpoint-rewind.svg)](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)
[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-listed-en.svg)](https://dsh.market/)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-checkpoint-rewind/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-checkpoint-rewind/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-checkpoint-rewind?label=version)](https://github.com/PerryLink/dsh-checkpoint-rewind/releases)
[![npm version](https://img.shields.io/npm/v/dsh-checkpoint-rewind)](https://www.npmjs.com/package/dsh-checkpoint-rewind)
[![npm downloads](https://img.shields.io/npm/dm/dsh-checkpoint-rewind)](https://www.npmjs.com/package/dsh-checkpoint-rewind)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-checkpoint-rewind
```


</div>

---

**📖 Ecosystem knowledge base** — measured data, not marketing: [plugin development guide · plugin-selection data · maintenance criteria](https://perrylink.github.io/dsh-plugin-guide/).

<!-- star-cta -->
## Install & uninstall

- **git channel** (latest `main`): `dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind` — pure ESM, no `prepare` or `allowBuilds` step.
- **npm channel** (published releases): `dsh plugin --profile web add dsh-checkpoint-rewind`.
- **tarball channel**: `npm pack` in this repo, then `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`.
- **storage stack** (required for checkpoints, optional for mounting): `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` (config `root`) + `@deepseek-ai/dsh-storage-domain` (config `backend: json`) — see Quick start; the plugin still mounts without them and every command explains the fix.
- **uninstall**: `dsh plugin --profile web remove dsh-checkpoint-rewind` — snapshot files stay until you delete `$DSH_HOME/dsh-checkpoint-rewind`; git objects are garbage-collected.

## ⭐ 如果它帮到了你

这个插件是 [DSH 插件家族](https://github.com/PerryLink)的一员（40+ 个，全部 Apache-2.0）。如果你在用，**给个 star** —— 它不会解锁任何功能，但会让下一个人在搜索里更容易找到它。

*English:* part of a 40+ plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.


## What is dsh-checkpoint-rewind?

Unified DeepSeek Harness checkpoints — session + workspace + config three-state snapshots with one-shot rollback.

The Claude Code Checkpoints equivalent, built as a capability-seam plugin: capture before every mutation, restore any of the three states with one approved command.

![Terminal demo of dsh-checkpoint-rewind: dsh-checkpoint-rewind — /rewind lists checkpoints, then a read-only preview](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-hero.png)

![Animated terminal demo of dsh-checkpoint-rewind](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-demo.gif)

*The same run, animated.*

## Comparison

![Measured comparison chart for dsh-checkpoint-rewind](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-evidence.png)

Capabilities out of 2 (restores files? / rewinds the session?) · counted from the README comparison table

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (GitHub tag, verified 2026-09-25; npm pin `0.1.7-rc.2`, peers `>=0.1.6-0 <0.2.0 || >=0.1.7-0 <0.2.0`) (adapted 2026-10-04): the host removed `@deepseek-ai/dsh-settings-file` and replaced the `ctx.settings` namespace-registration surface with `SettingsForms`, which projects each Loader entry's `Config` into the Settings form and persists edits on the profile patch — plugin config fields are now declared `volatile()` and read live, strict typert codecs carry only their `create()` factory, and the rewind notice declares its own message-source `kind`. The legacy `settings.register` path is kept for `0.1.5-rc.2`/`0.1.6-alpha.2` hosts. Verified 2026-09-22 against the `dsh-v0.1.7-alpha.1` checkout (typecheck against the alpha.1 type surface + full unit suite + assembled-headless integration). |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Platforms | All (host commands + listeners; optional Settings page timeline via the settings capability) |
| Model | Any (no model calls — snapshots and restores are deterministic) |

## What you get

`dsh-checkpoint-rewind` captures a **three-state unified checkpoint** — workspace, session cursor, and plugin config — and restores one or all three with a single approved command:

1. **Three-state record** — every checkpoint stores the workspace state (git tree SHA, or a copy manifest), the session event cursor (`seq` + turn boundary), and a config snapshot, tagged by source (`manual` / `auto` / `guard` / `mutation`).
2. **Four capture triggers** — before every mutating tool (`fs/write-intent`, `fs/edit-intent`, `tools/pre-execute`), on automatic interval (`autoCheckpoint`, default every step), manually (`/checkpoint` and the `checkpoint` tool), and as a guard before every rewind.
3. **git-first provider** — `git stash create` / `commit-tree` produce unreferenced snapshot objects that never touch your worktree, index, or history; restore is worktree-only and path-explicit. Non-git directories (and unborn-HEAD repos) degrade to an incremental `copy` provider with hardlink reuse.
4. **One-shot rollback** — `/rewind workspace|session|config|all <target>` restores the selected states; `preview` is a read-only impact report, `diff <a> <b>` compares two checkpoints, `clear` deletes them (this session; `clear --all` spans all sessions and workspaces).
5. **Fork-based session rollback** — session rollback replays events up to the checkpoint boundary through the official `SessionStore.fork` primitive into a new child session (falling back to the seeded `sessions.create` path when the host has no fork or the checkpoint has no boundary); the original session keeps its full history.
6. **Settings page timeline** — the `Plugins → Checkpoints` tab renders the session's checkpoints with pairwise line-level diffs.

## Why another rewind plugin?

| Plugin | What it sells | Restores files? | Rewinds the session? |
|---|---|---|---|
| **dsh-checkpoint-rewind** (this) | git-object snapshots + three-state rollback + one-shot restore | ✅ full workspace state | ✅ seed-replay child session |
| [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) | persistent Change Ledger of per-mutation deltas | ✅ by replaying inverse deltas | ✅ its own ledger model |
| [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) | pure context rollback to the last completed step | ❌ | ✅ context only |
| [Mongfayi/dsh-recall](https://github.com/Mongfayi/dsh-recall) | message recall (remove a turn and everything after) | ❌ (explicitly) | ✅ turn removal |

The difference in one sentence: **dsh-checkpoint-rewind captures the *workspace state* with side-effect-free git primitives before each mutation, and makes "back to step N" one approved command — guard checkpoint first, files restored second, config restored third, session replayed fourth, each phase logged.** No delta bookkeeping to drift, no message-level editing (that belongs to a different plugin), no cross-device sync.

## Quick start

```sh
dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind
```

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind

# or from npm (published releases)
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

Checkpoints persist through the `storageDomain` service. The plugin mounts without it and never blocks profile startup — checkpoint/rewind commands then return a structured error naming the exact rows to add. Compose the storage stack once to enable checkpoints:

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

The package is pure ESM with no build step — `index.mjs` and `lib/` are the shipped artifacts. Workspace mutations now create checkpoints automatically; run `/rewind` to list them (or `/rewind list brief` for one-line entries carrying each checkpoint's session number):

```text
rewind: 3 checkpoints (newest last):
#a1b2c3d4 · (git) · turn 2 step 1 · 2026-08-14 12:00:01 (3 min ago) · trigger: bash · 4 files · 1.2 MiB
#b2c3d4e5 · (git) · turn 2 step 3 · 2026-08-14 12:00:41 · trigger: str_replace_editor · 2 files · 310 KiB
#c3d4e5f6 · (copy) · turn 3 step 1 · 2026-08-14 12:01:10 · trigger: write · 1 file · 90 KiB
run "/rewind <id>" to restore files and fork the session from that checkpoint
```

Address a checkpoint by its **session number** (the bounded short number shown by `/rewind list brief`), by unique id prefix, by step number, or by `latest`:

```text
/rewind list brief        # one line per checkpoint, numbered, newest first
/rewind 3                 # the checkpoint numbered 3 in THIS session (exact hit, never a fuzzy match)
/rewind preview 3         # read-only: show which files would change, touch nothing
/rewind b2c3d4e5          # unique id prefix (the 8-char id in the list) works exactly as before
/rewind step 2
/rewind latest
/rewind workspace 3 --files src/a.ts,src/b.ts   # selective restore: only these files (approval-gated)
/rewind clear              # confirmed deletion of this session's checkpoints (files untouched)
/rewind clear --all        # confirmed deletion across ALL sessions and workspaces (files untouched)
```

### Session numbers (bounded short ids)

- **Every checkpoint gets a number when it is created**, starting at `1`. `/rewind 3` resolves that number **exactly** — digits are never treated as an id prefix, so `/rewind 3` can never land on the checkpoint whose UUID happens to start with `3`.
- **Scope: per session** (`sessionId`). Each session numbers its own checkpoints; a number is unique inside its session, and `/rewind <number>` resolves against the checkpoints of the current session (and workspace) only.
- **Monotonic and never reused.** Quota pruning (`maxSnapshots`) and `/rewind clear` / `/rewind clear --all` delete records but never free a number: after a clear the next checkpoint continues from the previous high-water mark (so after `#1 #2 #3` and a `clear`, the next one is `#4`, not `#1`). The number is stored on the record itself and the counter lives in the domain's global slot, so deleting records cannot reset it.
- **Older checkpoints are numbered on first sight.** Records written before this feature (no number field) are numbered in creation order the first time the session is listed or rewound, and that numbering is persisted; brand-new checkpoints continue after it. Nothing is skipped or reassigned, and id-prefix addressing keeps working for them.
- `/rewind list` (the detailed list) is unchanged: it still prints the 8-char id per line and its last line points at `/rewind list brief` for the numbers.

`preview` resolves through the same addressing and prints the impact without asking for confirmation or writing anything. `--files` restores only the named files through the same approval-gated transaction (unknown paths fail closed; it is incompatible with `workspaceRestore: reset-hard` and disabled when `selectiveRestore: false`).

## Configuration

All tunables are Schemastery `Config` fields (changeable from cordis.yml). Nothing is hardcoded. Provider options (`gitBin`, `snapshotDir`, `excludeGlobs`, `verifyByHash`) are read from the live config at use time, so cordis.yml changes apply without a restart.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch; `false` removes the commands, listeners, and providers entirely |
| `provider` | `auto` | Snapshot provider: `auto` (git if available, else copy) · `git` · `copy` |
| `gitBin` | `git` | Git executable path |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` (fallback `~/.dsh/dsh-checkpoint-rewind` when `$DSH_HOME` is unset) | Root for copy-provider snapshots |
| `maxSnapshots` | `50` | Checkpoints kept per session (oldest pruned first) |
| `maxSnapshotBytes` | `536870912` (512 MiB) | Global incremental-byte soft quota (newest per live session always retained) |
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
| `diffRenderer` | `pairwise` | Settings-page diff renderer: `pairwise` (line-level text) · `side-by-side` (per-file two-column) |
| `selectiveRestore` | `true` | Per-file selective restore (`/rewind … --files`) and the panel's per-file checkbox + size total |
| `promptSection` | `true` | Inject a short role-statement prompt section |
| `checkpointTool` | `true` | Register the `checkpoint` model tool |

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

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `/rewind` | command | `[workspace\|session\|config\|all] <number\|id-prefix\|step <N>\|latest>` · `list [brief]` · `diff <a> <b>` · `preview <target>` · `clear [--all]` |
| `/checkpoint` | command | `[note <text>\|list\|diff <a> <b>]` — capture a manual checkpoint |
| `checkpoint` | tool | Capture a manual checkpoint with an optional note |
| `fs/write-intent` · `fs/edit-intent` · `tools/pre-execute` | listeners | Pre-mutation capture (prepend pass-through; never steals the policy slot) |
| `session/event` | listener | Turn/step tracking, auto interval, boundary backfill, turn-end pruning |
| `checkpoints` projection | session projection | Timeline strip folded from the session log |
| Settings page timeline | client | `Plugins → Checkpoints` tab with pairwise (`diffRenderer`) diffs and per-file selective restore (`selectiveRestore`) |

## Safety model

- **Git history is untouchable.** The git provider runs only whitelisted side-effect-free primitives — `stash create`, `commit-tree`, `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse`, `cat-file -e` — enforced by a runtime assertion, and object refs are validated as hex ids before being passed to git (a tampered record cannot inject git options). **No `reset --hard` by default, no `clean`, no index/history mutation, ever** (see `workspaceRestore` below).
- **Overwrite rollback, never deletion.** Restore only overwrites captured files, and the git provider restores **explicit paths** (`git restore … -- .` would delete files `git add`-ed after the checkpoint). Files created after the checkpoint (untracked **or** staged) are *reported* and left in place.
- **No writes through links, no path traversal.** The copy provider validates checkpoint refs before joining them into snapshot-directory paths, and refuses to restore through a destination (or ancestor) that has become a symbolic link — so a restore can never follow a link out of the workspace.
- **Restore requires approval.** Overwriting user files always goes through the confirmation seam with `ask` semantics; a missing, throwing, or answering-no answerer **fails closed**. `/rewind preview` is the read-only way to inspect the impact first.
- **Rewind is reversible.** Before restoring, a guard checkpoint captures the current state; restoring the guard undoes the rewind. `preRewindCheckpoint: require` aborts the rewind when the guard cannot be captured.
- **Fixed-order transaction.** Guard first, workspace second, config third, session replay fourth; every phase is logged; a failed restore leaves files, checkpoints, and session untouched.
- **`workspaceRestore: 'reset-hard'` is CC-equivalent and opt-in.** It runs `git reset --hard <snapshot commit>` (branch head moves to the snapshot commit; pre-snapshot history stays recoverable via reflog; untracked files untouched). It is off by default.
- **Model-visible ⟺ logged.** Everything a user or model sees reconstructs from `command/run` + `command/done` (and, once the host knows them, `checkpoint/*` events) plus the durable `checkpoints` domain.

## How it works

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

Full decision record, event vocabulary, and the provider seam contract: [ARCHITECTURE.md](ARCHITECTURE.md).

## Session events (rc.2 note)

The plugin declares `checkpoint/snapshot`, `checkpoint/bound`, `checkpoint/prune`, and `checkpoint/rewind` as log-only `SessionEventMap` members. Harness rc.2 has **no plugin event-registration surface** and `Session.append` does not stamp the `ignorable` envelope (its third argument is surface intent, not options), so appending unknown types would make the session unreadable on reload. The plugin therefore appends through an **adaptive gate**: a runtime probe (on a detached, never-persisted session store) detects whether the host's `append` stamps the `ignorable` envelope — on rc.2 the gate stays closed; on hosts that support it, `checkpoint/*` events are appended with `ignorable: true` automatically. Until then the authoritative audit chain is `command/run` + `command/done` (harness-known) plus the durable `checkpoints` storage domain.

## Web UI anchor

The plugin returns the new session id in the command result (`session: <id>`) and the Web shell can navigate there. The **session-projection unit `checkpoints` is shipped**: whenever `ctx.sessionProjections` exists, the plugin registers the unit via `ctx.inject` (folds `checkpoint/snapshot|bound|prune|rewind` into a whole-value list) — it stays an empty list on rc.2 hosts until a harness build ships the `checkpoint/*` vocabulary or the `ignorable` envelope, then fills in with zero plugin changes.

## FAQ

**Does this replace git?** No — it *uses* git where available. In a git repo you get byte-perfect, deduplicated snapshot objects without touching history; in any other directory the copy provider does the same with plain files. Regular commits remain your long-term history.

**Why not `git reset --hard` by default?** Because destroying state is not the job of a safety net. The plugin only creates unreferenced objects and performs worktree-only, path-explicit restores by default, so a bad rewind can never lose history, the index, or files created after the checkpoint. `reset-hard` is available behind `workspaceRestore: 'reset-hard'` for users who explicitly want CC parity.

**How long is a checkpoint restorable?** No ref is held on git-provider snapshots. They're unreferenced `stash create`/`commit-tree` objects by design, and `discard` deletes only the record, leaving the object itself for `git gc`. Two independent things bound how long a checkpoint actually stays restorable: the plugin's own quota pruning (`maxSnapshots`, default 50 kept per session; `maxSnapshotBytes`, a default 512 MiB global soft quota enforced via `pruneAll()` on capture and swept on turn ends), and the host repo's git gc. With git's defaults, unreferenced objects survive until an auto-gc runs, and even then only objects older than `gc.pruneExpire` (2 weeks by default) get pruned. A manual `git gc --prune=now`, an aggressive repack, `filter-repo`, or a fresh clone can drop them immediately. Pruned objects are now detected up front: the git provider probes the snapshot object before restore (`git cat-file -e`) and fails loudly when it is missing instead of silently restoring nothing, and a doctor pass walks every checkpoint record to probe object existence and badge unrestorable ones (`[UNRESTORABLE: object missing]` in the list). The doctor pass is implemented and tested but not yet wired into the restore path (restore does not yet consult the `unrestorable` marking; tracked in discussion #13).

**Can I rewind to a step in the middle of a turn?** File restoration is step-precise (`/rewind step <N>` = nearest snapshot ≤ N). The session replay, however, respects the harness's replay granularity: the child session is seeded up to the checkpoint's turn boundary.

**What happens if nobody can answer the confirmation?** Nothing is touched — the plugin fails closed (`unavailable`/`rejected`), keeps the checkpoint, and returns an explanatory error. With `confirmVia: approval` on rc.2 the message says to mount userQuestions, because approval requires an open turn and commands run between turns.

**Can I undo a rewind?** Yes — every approved rewind captures a guard checkpoint of the pre-rewind state first; the result prints `rewind guard: <id>`, and `/rewind <guard-id>` restores that state.

**How do I address checkpoints?** The **session number** (`/rewind 3` — see `/rewind list brief`; per session, monotonic, never reused), the unique id prefix (the 8-char short id in the list still works), `/rewind step <N>`, and `/rewind latest`. `/rewind clear` deletes this session's checkpoints, and `/rewind clear --all` deletes checkpoints across all sessions and workspaces (files untouched) — neither one resets the numbering. `/rewind preview <target>` uses the same addressing to show the impact without changing anything.

**Why does the number keep counting up after a clear?** Because a number is an address, not a position: reusing `#1` for a different checkpoint after a clear would silently repoint anything that mentioned `#1`. The counter is persisted in the `checkpoints` domain (global slot) and each record stores its own number, so pruning and clearing delete snapshots without recycling ids.

**What does `preview` do — and not do?** It resolves the checkpoint, then runs a read-only comparison: which files would be overwritten (or recreated), which already match, and which files created after the checkpoint would be left in place. It never prompts, never writes, never forks, and records no `checkpoint/rewind` event — the approval gate only runs on a real `/rewind <id>`.

## Demo

A real assembled-headless integration run (`npm run test:integration`) drives the full flow: the agent modifies files across two turns, then `/rewind preview` inspects the impact read-only (no confirmation gate, no writes) and `/rewind <id>` restores the files and replays the session into a new child session. The run asserts the file contents, the replayed child context, the guard checkpoint, and that files created after the checkpoint survive — for both the copy and git provider flows (the git flow also asserts `HEAD` and the reflog are untouched). The driver lives in `test/integration/rewind-headless.mjs`.

## Permissions & data

- **Permissions**: the workshop manifest declares `workspace:read`, `workspace:write`, `git:read`, `git:write`, `snapshot-storage:write`, `session-log:read`, `settings:write`, and `network:none`.
- **Data**: checkpoint records live in the `checkpoints` storage domain (SQLite rows or a JSON file); copy snapshots live under `snapshotDir`. The domain's **global slot** holds the per-session short-number counters, which is why deleting records (`prune`, `clear`, `clear --all`) can never recycle a number. Fully local — no network, no credentials. The domain is opened dual-version: 0.4.x-era media (domain v1) are opened in a compatibility mode that keeps old records readable and stores new captures in the v2 shape, so upgrading the plugin never orphans an existing medium.
- **Session log**: `checkpoint/*` events are appended through the adaptive gate; the authoritative audit chain is `command/run` + `command/done` plus the durable domain.

## Security boundaries

- **Git history is untouchable.** Whitelisted side-effect-free primitives; `reset --hard` only behind the opt-in `workspaceRestore: 'reset-hard'` mode. No `git clean`, ever.
- **Overwrite rollback, never deletion.** Restore overwrites captured files only; files created after the checkpoint are reported and left in place.
- **No writes through links, no path traversal.** Copy `ref`s are validated as snapshot ids; restore refuses to follow symbolic links out of the workspace.
- **Restore requires approval.** A missing or denying answerer fails closed.
- **Rewind is reversible.** A guard checkpoint of the pre-rewind state is captured first.

## Known limitations

- On rc.2, `checkpoint/*` session events are suppressed by the adaptive gate; the audit chain rides `command/run` + `command/done` plus the storage domain until a host ships the vocabulary or the `ignorable` envelope.
- `confirmVia: approval` needs an open turn, and commands run between turns — mount userQuestions (or set `confirmVia: userQuestions`) on rc.2.
- Session rollback **forks a new child session** at the checkpoint boundary; it never rewrites or truncates the original session.
- `workspaceRestore: 'reset-hard'` moves the branch head to the snapshot commit; it is off by default.
- A checkpoint captured before any closed turn has no replay boundary — session rollback then creates a fresh child session with empty context.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/rewind <id>` says `rewind cancelled: no confirmation answerer` | No userQuestions/approval channel is mounted — the plugin fails closed. Run in the Web UI (or mount a question provider); `confirmVia` selects the channel. |
| `/rewind <id>` says `approval requires an open turn …` | Commands run between turns and approval needs a turn — mount userQuestions or set `confirmVia: userQuestions`. |
| `rewind: checkpoint registry unavailable` | The `checkpoints` storage domain could not open. Either the `storageDomain` service is not composed (add the storage stack rows from Quick start: `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` with config `root` + `@deepseek-ai/dsh-storage-domain` with config `backend: json`) or the backend is erroring; check the harness logs. |
| A checkpoint lists as `fork: pending (turn not closed)` | Its turn has no `turn/end` yet; files can still be restored, but the session replay waits for the turn to close. |
| `files restored … but the session was NOT replayed` | The transaction's session phase failed (no closed boundary, or replay rejected). Files stay restored; use the printed `rewind guard: <id>` to undo. |
| `rewind: aborted — the pre-rewind guard checkpoint could not be captured` | `preRewindCheckpoint: require` refused the rewind because the guard capture failed; fix the storage (or set `warn`/`off`). |
| A checkpoint lists as `(copy)` even though the directory is a repo | Unborn HEAD (no initial commit): git snapshot primitives require HEAD, so the plugin degrades to `copy` until the first commit. |
| `MISSING_CREDENTIAL` in headless runs | Unrelated to this plugin: no `DEEPSEEK_API_KEY` is configured for the model provider. |
| Snapshot storage grows | Pruning runs after every snapshot and at `turn/end` (`pruneOnTurnEnd`); lower `maxSnapshots` / `maxSnapshotBytes`, run `/rewind clear`, or delete `$DSH_HOME/dsh-checkpoint-rewind` after uninstalling. |

## Development

```sh
npm install               # peer deps: @deepseek-ai/dsh-session@0.1.2-rc.1, schemastery, zod
npm test                  # node --test test/**/*.test.mjs (provider suites incl.)
npm run test:integration  # assembled-headless verification (test/integration/)
```

No build step: pure ESM — `index.mjs`/`lib/` are the published artifacts.

## Interoperability with other DSH plugins

Verified against **DSH `0.2.0-rc.2`** (the runtime this README ships for) and the high-star plugin set surveyed on 2026-10-05.

This plugin **does not interfere** with other plugins, including the widely installed high-star ones:

- **No tool-name collision.** Every tool is namespaced; no bare name owned by a shipped tool or another plugin is registered.
- **No service-key collision.** It provides no service key at all, so it cannot collide on one.
- **No slot collision.** It registers no client slot key, so it cannot contend for a `shadows-shipped-ui` seat.
- **No HTTP route collision.** It registers no `webServer` prefix.
- **No patch-layer collision.** The bundle patch only `insert`s its own row; it never overrides a built-in row's `config`.
- **No global mutation.** It does not patch prototypes, rewrite `process.env`, or replace the global fetch dispatcher.

**Shared event listeners are non-interfering by construction.** It observes the ordering-sensitive events `fs/edit-intent`, `fs/write-intent`, `tools/pre-execute` with `ctx.on()` — Cordis's broadcast registration, where every listener runs and none can starve another. **Every listener here delegates through `next()`**, so the chain is never short-circuited, and a mutation is applied to the value `next()` produced rather than returned in its place:
  - `tools/pre-execute` — also used by `cc-safety-net` (1576★).

Static evidence: `dsh-plugin-doctor` K10–K13 report `pass` for every check on this repository.

## Topics

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — creator and maintainer: the three-state checkpoint model, the git/copy provider seam, the three-phase rewind transaction, the Settings page timeline, docs, CI/CD and releases.
- [@tmpdot](https://github.com/tmpdot) (rmUnlucky) — v1-medium dual-version compatibility (#8), lazy `storageDomain` resolution (#9), checkpoint dedup reply hints (#10), and the `$DSH_HOME`-unset snapshot-dir bug report (#4).
- [@shipinliang](https://github.com/shipinliang) — checkpoint panel wire-contract reports: the missing `acceptsUndefined` on the `limit` parameter (#5) and the `#deps` private-field proxy failure (#6).
- [@hwz1456](https://github.com/hwz1456) — web-profile checkpoint-capture report (#3).
- [@Andiii208](https://github.com/Andiii208) — `plugin_check` publishing-spec report (#2).
- [@alexchenzl](https://github.com/alexchenzl) (Ashu) — DSH Directory listing invitation (#7).

## PerryLink DSH Plugin Family

This project is one of the **87 actively maintained** DeepSeek Harness plugins from [PerryLink](https://github.com/PerryLink). The family roster is **95** plugins in total — **5 frozen**, **3 retired** — and stays collapsed below so every README keeps a short first screen. Expand it to see every row, with the reason in the Status column.

<details>
<summary>Expand all 95 plugins</summary>

| Plugin | One-liner | Status |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 RETIRED — see the repo README |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 FROZEN — see the repo README |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 FROZEN — see the repo README |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 FROZEN — see the repo README |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 FROZEN — see the repo README |
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
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 FROZEN — see the repo README |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 RETIRED — see the repo README |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 RETIRED — see the repo README |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>

</details>

### Install from the DSH Desktop Market

All PerryLink plugins are browsable in the built-in DSH Desktop Market: **Market → Sources → add source → paste** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ select it**. Installation still goes through the Market's npm-identity verification and your confirmation.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors
