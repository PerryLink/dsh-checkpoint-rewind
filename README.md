# dsh-checkpoint-rewind

**English** · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

**Claude Code `/rewind`, done right for DeepSeek Harness.**

A capability-seam plugin that adds **workspace file snapshots + session-boundary rollback** to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): before every mutating tool execution the plugin captures your workspace (git-first, copy fallback), and one `/rewind` command restores the files **and** forks the session back to the checkpoint's turn boundary — so the model context and the files on disk always agree.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-green.svg)](#)
[![Harness](https://img.shields.io/badge/dsh-0.1.0--rc.6-8a2be2.svg)](#)

> **Topics**: `dsh` · `dsh-plugin` · `deepseek-harness` · `rewind` · `checkpoint` · `session-fork` · `workspace-safety` · `undo` · `cordis-plugin`

---

## Why another rewind plugin?

| Plugin | What it sells | Restores files? | Rewinds the session? |
|---|---|---|---|
| **dsh-checkpoint-rewind** (this) | git-object snapshots + turn-boundary fork + one-shot restore | ✅ full workspace state | ✅ fork-seeded child session |
| [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) | persistent Change Ledger of per-mutation deltas | ✅ by replaying inverse deltas | ✅ its own ledger model |
| [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) | pure context rollback to the last completed step | ❌ | ✅ context only |
| [Mongfayi/dsh-recall](https://github.com/Mongfayi/dsh-recall) | message recall (remove a turn and everything after) | ❌ (explicitly) | ✅ turn removal |

The difference in one sentence: **dsh-checkpoint-rewind captures the *workspace state* with side-effect-free git primitives before each mutation and makes "back to step N" one approved command — files restored first, session forked second, each phase logged.** No delta bookkeeping to drift, no message-level editing (that belongs to a different plugin), no cross-device sync.

## Features

- **Snapshots before every mutation** — a prepend pass-through listener on `fs/write-intent` / `fs/edit-intent` plus `tools/pre-execute` for non-fs mutators (`bash`, `subprocess`, …), so *every* change path is covered without stealing the policy decision slot.
- **Provider seam** — `git` first: `git stash create` / `git commit-tree` produce unreferenced snapshot objects that **never touch your worktree, index, or history**; restore is worktree-only `git restore`. Non-git directories degrade to `copy` (incremental directory snapshots with hardlink reuse), clearly labeled in the list.
- **Step-level mapping, turn-level forks** — every checkpoint records its turn/step; `step/end` backfills the step mapping ("back to step N" = nearest snapshot ≤ N) and `turn/end` backfills the fork boundary, using the harness's real `ctx.sessions.fork` primitive.
- **Two-phase rewind transaction** — `/rewind <id>` asks for confirmation (userQuestions / approval seam, **fail-closed when no answerer**), restores files first, then forks; a restore failure never forks, a fork failure reports "files restored, session not forked" and leaves the checkpoint intact.
- **Durable registry + quotas** — checkpoint records live in `ctx.storageDomain` (domain `checkpoints`; SQLite backend = rows, JSON backend = a human-readable file); `maxSnapshots` (per session, default 50), `maxSnapshotBytes` (global, default 512 MiB), `pruneOnTurnEnd`, oldest-first.
- **Reconstructable by design** — `/rewind` output rides the harness's own `command/run` + `command/done` events; `checkpoint/snapshot|bound|prune|rewind` session events are declared and appended automatically once a host build knows them (rc.6 adaptive gate).

## Quick start

`dsh-checkpoint-rewind` ships as a **bundle plugin** (no build step, pure ESM):

```sh
dsh plugin add dsh-checkpoint-rewind    # enters your profile's bundle stack
# restart dsh — done. /rewind is live in the Web UI.
```

Or mount it directly for experiments:

```sh
pnpm dsh web --patch ./cordis.patch.yml
```

Workspace mutations now create checkpoints automatically. In the Web UI (or any interactive adapter):

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

The plugin asks **"Restore the workspace files to this checkpoint and fork the session?"** → on approval it restores the files, forks the session at the checkpoint's turn boundary, and returns the new session id:

```text
rewind: restored 2 file(s) from checkpoint b2c3d4e5-f6a7-… (provider git)
and forked a new session at seq 87 (end of turn 2).
session: session-123
Open the new session to continue from before that turn; this session keeps its later history.
```

Headless runs print the same result with resume guidance; the Web shell can use the returned `session:` id to navigate (see [Web UI](#web-ui-anchor)).

## Configuration

Everything is a `Config` field (cordis.yml can change it; nothing is hardcoded):

| Key | Default | Meaning |
|---|---:|---|
| `enabled` | `true` | Master switch; `false` removes the command, listeners, and providers entirely. |
| `provider` | `auto` | Snapshot provider: `auto` (git if available, else copy) · `git` (fail loud on non-git dirs) · `copy`. |
| `gitBin` | `git` | Git executable path. |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` | Root for copy-provider snapshots. |
| `maxSnapshots` | `50` | Checkpoints kept **per session** (oldest pruned first). |
| `maxSnapshotBytes` | `536870912` (512 MiB) | Global content quota across all sessions (oldest pruned first). |
| `pruneOnTurnEnd` | `true` | Run quota pruning when a turn ends. |
| `mutationTools` | `['bash','write','edit','str_replace_editor']` | Tools treated as mutating at `tools/pre-execute` (fs tools are covered by `fs/*-intent` regardless). |
| `excludeGlobs` | `['node_modules','.git','.dsh','dist','build']` | Directories/files skipped by the copy provider (`.git` and the snapshot dir are always excluded). |
| `confirmVia` | `auto` | Confirmation channel: `auto` (userQuestions first, then approval) · `userQuestions` · `approval`. |
| `listLimit` | `10` | Checkpoints shown by bare `/rewind`. |

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

## Safety model

- **Git history is untouchable.** The git provider runs only whitelisted side-effect-free primitives — `stash create`, `commit-tree`, `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse` — enforced by a runtime assertion. **No `reset --hard`, no `clean`, no index/history mutation, ever.**
- **Restore requires approval.** Overwriting user files always goes through the confirmation seam with `ask` semantics; a missing, throwing, or answering-no answerer **fails closed**.
- **Overwrite rollback, never deletion.** Both providers restore captured files and *report* files created after the checkpoint (git: untracked files; copy: manifest extras) instead of deleting them.
- **Two-phase transaction, fixed order.** Files first, fork second; every phase is logged; a failed restore leaves files, checkpoints, and session untouched.
- **Model-visible ⟺ logged.** Everything a user or model sees is reconstructable from the session log (`command/run` + `command/done` and, once the host knows them, `checkpoint/*` events) plus the durable `checkpoints` domain.

## How it works

`checkpoint/snapshot` (creation) → `checkpoint/bound` (step/end and turn/end backfill) → `/rewind` (list / confirm / two-phase restore). Full decision record, event vocabulary, and the provider seam contract: [ARCHITECTURE.md](ARCHITECTURE.md).

## Session events (rc.6 note)

The plugin declares `checkpoint/snapshot`, `checkpoint/bound`, `checkpoint/prune`, and `checkpoint/rewind` as log-only `SessionEventMap` members. Harness rc.6 has **no plugin event-registration surface** and `Session.append` cannot mark unknown types `ignorable`, so appending them would make the session unreadable on reload. The plugin therefore appends through an **adaptive gate** (`KNOWN_SESSION_EVENT_TYPES`): skipped today, enabled automatically once a host build includes the types. Until then the authoritative audit chain is `command/run` + `command/done` (harness-known) plus the durable `checkpoints` storage domain.

## Web UI anchor

The plugin already returns the new session id in the command result (`session: <id>`) and the Web shell can navigate there. The checkpoint strip is planned as a session-projection unit keyed `checkpoints` (fold `checkpoint/snapshot|bound|prune|rewind` into a whole-value list, `stateVersion` 0) plus a read-only panel in the shell — a follow-up once a harness build ships the `checkpoint/*` vocabulary; see [ARCHITECTURE.md](ARCHITECTURE.md#todo-web-ui-checkpoint-strip).

## Tests

```sh
npm install
npm test                 # 53 unit tests: snapshot creation/dedup/concurrency, git & non-git paths,
                         # ≤N boundary mapping, prune quotas, two-phase failure matrix, approval
                         # rejection, adaptive event gate (real Cordis + real SessionStore/CommandRuntime)
npm run test:integration # assembled-headless verification: agent modifies 2 files across 2 turns,
                         # /rewind list → restore → file contents + fork context asserted
```

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Related plugins

- [dsh-memento](https://github.com/…/dsh-memento) — bounded, approval-gated cross-session memory (same plugin conventions).
- [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) · [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) — the alternatives this plugin differentiates from (table above).
