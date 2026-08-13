# ARCHITECTURE.md — dsh-checkpoint-rewind

Design record for the `/rewind` capability-seam plugin. Companion to [README.md](README.md); the external contract (Config, command output, failure semantics) lives there, the *why* lives here.

## Roles: one seam, three roles

```
                    ┌──────────────────────────────────────────────┐
                    │ Consumer (index.mjs)                          │
                    │  snapshotForMutation()  ← fs/write-intent      │
                    │                           fs/edit-intent       │
                    │                           tools/pre-execute    │
                    │  boundary backfill       ← session/event       │
                    │  /rewind command         → ctx.commands        │
                    │  two-phase transaction   → ctx.sessions.fork   │
                    └──────────────┬───────────────────┬────────────┘
                                   │ resolve(mode, ws) │ records via ctx.storageDomain
              ┌────────────────────▼─────┐    ┌────────▼────────────────────┐
              │ Registry (lib/providers/) │    │ Storage domain 'checkpoints' │
              │ register() → disposer     │    │  (SQLite = rows, JSON = file)│
              │ resolve(auto|git|copy)    │    └─────────────────────────────┘
              └────┬───────────────┬──────┘
        ┌──────────▼────┐   ┌──────▼──────────┐
        │ git provider  │   │ copy provider   │
        │ stash create /│   │ incremental dir │
        │ commit-tree   │   │ + hardlinks     │
        │ restore -W    │   │ overwrite copy  │
        └───────────────┘   └─────────────────┘
```

- **Definition**: the provider contract in `lib/providers/definition.mjs` (`available` / `snapshot` / `restore` / `discard`).
- **Providers**: `git` (whitelisted side-effect-free primitives) and `copy` (directory snapshots) — both registered through `SnapshotProviderRegistry.register()`, whose disposer rides `ctx.effect()` (hard contract: provider registration is an effect).
- **Consumer**: everything else in `index.mjs` — the mutation listeners, the boundary backfill, the `/rewind` command. Provider selection is `Config.provider` (`auto` → git-if-available, else copy); **no git path is hardcoded**.

## Decision record

**D1 — Pre-mutation capture, prepend pass-through.** Checkpoints are taken when `fs/write-intent`, `fs/edit-intent`, or `tools/pre-execute` (mutating tool names from `Config.mutationTools`) fires, *before* the write. All three are single-slot decision waterfalls, so the plugin listens with `{ prepend: true }`, captures, then **calls `next()` and returns its result** — the policy plugin keeps the decision slot. Capture failures are contained (logged) and never break the tool: a checkpoint is a safety net, not policy.

**D2 — One checkpoint per (session, turn, step).** A step's first mutation intent creates the checkpoint; later intents in the same step (including concurrent ones, which share the in-flight capture promise) are deduplicated. Content dedup is provider-owned: a capture identical to the previous checkpoint (`git diff --quiet <prev> <new>`; copy manifest quick-check) returns `null` and no record is written — "back to step N" then maps to the nearest earlier checkpoint whose content is byte-identical.

**D3 — Step mapping and fork boundary are separate seqs, both backfilled.** The checkpoint records `turn`/`step` at creation. `step/end` backfills `stepEndSeq` (the "回到第 N 步 → nearest snapshot with stepEndSeq ≤ N" mapping, exported as `nearestCheckpointAtOrBefore`); `turn/end` backfills `forkSeq`. `forkSeq` must be a **turn end** because `ctx.sessions.fork` rejects any prefix that ends inside an open turn — the harness's fork granularity is the turn, while file restoration granularity is the step. The fork therefore yields a child whose log ends exactly where the checkpoint's turn ended, and the restored files are the pre-mutation state; the child's `session/end-seed` marker makes the seed boundary durable.

**D4 — Two-phase transaction, files first.** `/rewind <id>`: (0) resolve + list-lookup against the current session's records (cwd is the identity witness); (1) confirmation through the ask seam — `ctx.userQuestions` or `ctx.approval`, `auto` prefers userQuestions, **any missing/throwing answerer fails closed**; (2) phase 1 restore via the provider that *captured* the record (looked up by `record.provider`, not the current config); (3) phase 2 `ctx.sessions.fork(session, record.forkSeq)`. Failure semantics: restore failure → no fork, checkpoint kept, workspace untouched-by-plugin; fork failure → files stay restored, result reports "files restored, session NOT forked". Every phase logs; `checkpoint/rewind` (adaptive) records the outcome and key fields.

**D5 — Overwrite rollback, never deletion.** Restore only overwrites captured files. Files created after the checkpoint are *reported* (git: `ls-files --others`; copy: manifest diff) and left in place — symmetric with the "no `git clean`" hard rule. The git provider additionally whitelists its verbs at runtime (`reset`/`clean`/`stash apply`… refuse loudly), so a future edit cannot silently turn the provider destructive.

**D6 — Durable registry in `ctx.storageDomain`, adaptive session events.** Records live in the `checkpoints` domain (version 1; zod-validated at open; SQLite backend = table rows, JSON backend = one human-readable file — both automatic from the domain facility). The `checkpoint/*` session events are declared via declaration merging but appended only when the host build's `KNOWN_SESSION_EVENT_TYPES` knows them: rc.6 has no plugin event-registration surface and `Session.append` cannot mark unknown types `ignorable`, so an unconditional append would make the session unloadable. The reconstructability contract is therefore carried by harness-known events (`command/run` + `command/done` for the command lifecycle) plus the durable domain; the gate flips on automatically when a future harness ships the vocabulary.

**D7 — Pruning is a pure plan, applied oldest-first.** `prunePlan(entries, {maxSnapshots, maxSnapshotBytes})` computes the delete list (per-session tail + global byte quota) without I/O; the consumer executes delete-then-discard per id, containing per-id failures. `pruneOnTurnEnd` runs the same policy at `turn/end`.

## TODO — Web UI checkpoint strip

Anchor for the optional follow-up (deliberately out of this package's current scope; the harness's `apps/web` shell owns panels):

1. **Projection unit** `checkpoints` on `ctx.sessionProjections` (inject `sessionProjections`, register when present): `init()` → empty list; `apply(state, event)` folds `checkpoint/snapshot` (append record), `checkpoint/bound` (fill `stepEndSeq`/`forkSeq`), `checkpoint/prune` (drop ids), `checkpoint/rewind` (mark outcome); `view(state)` → whole-list wire value; `stateVersion: 0`. Blocked on the same rc.6 event-registration surface as D6 — the unit only receives events once a host build knows them.
2. **Read-only panel** in the Web shell that renders the projection and calls the existing `/rewind` command; navigation to the returned `session: <id>` uses the shell's session list API (the command result already carries the id).

## Test matrix

| Area | Where | What it proves |
|---|---|---|
| Pure mapping/prune/list | `test/checkpoints.test.mjs` | ≤N nearest mapping (incl. unbound skip), per-session + global quota pruning, list rendering |
| Confirm gate + event gate | `test/gate.test.mjs` | fail-closed matrix (approve/cancel/custom/throw/no-provider/no-open-turn), adaptive append |
| git provider | `test/providers/git.test.mjs` | scripted command sequences, clean-tree `commit-tree` fallback, content dedup, restore+leftovers, **verb whitelist**, real-git round trip (capability-gated) |
| copy provider | `test/providers/copy.test.mjs` | capture/manifest, excludes, hardlink reuse, dedup, overwrite restore + leftover report, corrupt/traversing manifest rejection, orphan cleanup, concurrency |
| Plugin assembly | `test/index.test.mjs` | real Cordis + real SessionStore/CommandRuntime: snapshot triggers, step-window + concurrent dedup, boundary backfill, quota pruning, `/rewind` list, denial path, restore-failure (no fork, checkpoint kept), fork-failure (files restored, reported), full restore+fork with seed equality, command lifecycle reconstruction, rc.6 adaptive gate |
| Assembled headless | `dev/integration/rewind-headless.mjs` | real storage hub (JSON backend) + real storage-domain + real user-questions: agent mutates 2 files across 2 turns → list → restore → file contents + fork context asserted; git flow asserts HEAD/reflog untouched |
