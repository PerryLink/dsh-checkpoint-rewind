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

**D5 — Overwrite rollback, never deletion.** Restore only overwrites captured files. Files created after the checkpoint are *reported* (git: untracked + staged-new union; copy: manifest diff) and left in place — symmetric with the "no `git clean`" hard rule. The git provider restores **explicit paths only**: `git restore --source=<ref> --worktree -- .` deletes worktree files that are tracked in the index but absent from the ref tree (files `git add`-ed after the checkpoint), which violates this boundary — so the provider enumerates the ref tree and restores it in path batches. The git provider additionally whitelists its verbs at runtime (`reset`/`clean`/`stash apply`… refuse loudly), so a future edit cannot silently turn the provider destructive.

**D6 — Durable registry in `ctx.storageDomain`, adaptive session events.** Records live in the `checkpoints` domain (version 1; zod-validated at open; SQLite backend = table rows, JSON backend = one human-readable file — both automatic from the domain facility). The `checkpoint/*` session events are declared via declaration merging but appended only when the host build knows them **or** supports the `ignorable` envelope (see D12): rc.6 has no plugin event-registration surface and `Session.append` silently drops unknown option keys, so an unconditional append would make the session unloadable. The reconstructability contract is therefore carried by harness-known events (`command/run` + `command/done` for the command lifecycle) plus the durable domain; the gate flips on automatically when a future harness ships the vocabulary or the envelope.

**D7 — Pruning is a pure plan, applied oldest-first.** `prunePlan(entries, {maxSnapshots, maxSnapshotBytes})` computes the delete list (per-session tail + global byte quota) without I/O; the consumer executes delete-then-discard per id, containing per-id failures. `pruneOnTurnEnd` runs the same policy at `turn/end`. The plan reports which rule triggered each id (`byRule.maxSnapshots` / `byRule.maxSnapshotBytes`) so the prune event's `reason` is honest.

**D8 — Projection unit shipped, panel deferred.** `lib/projection.mjs` contributes the session-projection unit `checkpoints` (`init` empty map → `apply` folds `checkpoint/snapshot|bound|prune|rewind` → `view` sorted whole list; zod-validated wire payload; `stateVersion: 0`). `index.mjs` registers it via `ctx.inject(['sessionProjections'], …)` whenever the registry exists (optional capability; registration rides the plugin fiber). On rc.6 hosts the unit serves an empty list because D6's adaptive gate suppresses the events it folds; once a host build ships the vocabulary or the `ignorable` envelope the strip populates with zero plugin changes. The shell-side read-only panel remains a follow-up (see below).

**D9 — Incremental byte accounting with a newest-retained floor.** `maxSnapshotBytes` measures *incremental* storage cost, not whole-snapshot content: git records the bytes of the blobs changed relative to the snapshot's first parent (`diff-tree` change set filtered against `ls-tree -r -l`; the clean-tree `commit-tree` fallback carries `-p HEAD` so its change set — and bytes — are empty), and copy records only the bytes it actually copies (hardlink-reused files cost 0). The byte quota is a **soft quota**: `prunePlan` never deletes the newest checkpoint per session, so a workspace larger than the quota cannot self-prune into "no checkpoints yet". A capture whose own bytes exceed the quota logs a loud warning. This replaces the original full-content accounting, under which any workspace above the quota silently lost every checkpoint.

**D10 — Rewind is itself reversible: the pre-rewind guard checkpoint.** `/rewind` runs between turns and its restore overwrites the current state irrecoverably, so the transaction gained a phase 0.5: after confirmation and before restore, the plugin captures the current workspace as a guard checkpoint (`triggerTool: 'rewind'`, positioned at the most recent turn/step via `latestStepOf`, which needs no open step). Provider content-dedup applies (unchanged state → no record, because the latest checkpoint already covers it), and the guard never depends on a previous checkpoint's storage integrity (an unreadable dedup baseline retries without it). `preRewindCheckpoint: 'warn' | 'require' | 'off'` (default `warn`) decides the failure semantics; the guard id is printed in the result, appended to `checkpoint/rewind` events, and injected into the fork child's notice, so `/rewind <guard-id>` undoes the rewind.

**D11 — Command addressing beyond full ids.** `parseRewindInput` accepts `''` (list), `<id-prefix>` (case-insensitive unique-prefix match with ambiguity reporting), `step <N>` (session-log fold for the latest `step/end` numbered N, then `nearestCheckpointAtOrBefore`), `latest`, and `clear` (confirmed deletion of the session's checkpoints via the same gate with custom labels; files untouched). The list renders 8-char short ids (directly usable as prefixes), a relative-age suffix for entries under an hour old, and an "N older checkpoints" footer when `listLimit` hides entries.

**D12 — Adaptive event gate v2: runtime `ignorable`-envelope probe.** Besides `KNOWN_SESSION_EVENT_TYPES` membership, the gate now detects whether the host's `Session.append` stamps the `ignorable` envelope (present in newer harness builds; the persistence read path accepts unknown types carrying it). The probe constructs a **detached** `SessionStore` on a fresh `Context` — never wired to the app's persistence, so the probe session cannot be flushed to disk — appends a probe event with `{ ignorable: true }` and reads the marker back. rc.6's append silently drops unknown option keys (marker absent → gate closed, status quo); envelope-capable hosts get `checkpoint/*` appended with `ignorable: true`, lighting up the projection unit and the full event audit chain automatically.

**D13 — git provider hardening.** (a) `available()` now rejects unborn-HEAD repos (`rev-parse --verify HEAD`) so `auto` degrades to `copy` instead of failing every snapshot; (b) availability probes (including negative results) are cached per workspace key for the process lifetime — git-ness is treated as stable; (c) the snapshot change set is computed with an explicit two-arg `diff-tree <parent> <sha>` — single-arg `diff-tree` on a stash commit (HEAD + index-tree parents) produces an empty *combined* diff when the index tree already matches the worktree, which silently zeroed the changed-file count for unstaged-only changes; (d) leftovers report the union of untracked and staged-new files (`ls-files --others` ∪ `diff --diff-filter=A <ref>`); (e) `restored` counts only files present in the ref tree that differ in the worktree.

## TODO — Web UI checkpoint strip (shell-side)

The only remaining piece is owned by the harness's `apps/web` shell, out of this package's scope:

1. **Read-only panel** that renders the `checkpoints` projection (populated on hosts that ship the `checkpoint/*` vocabulary or the `ignorable` envelope, see D6/D12) and calls the existing `/rewind` command; navigation to the returned `session: <id>` uses the shell's session list API (the command result already carries the id).

## Test matrix

| Area | Where | What it proves |
|---|---|---|
| Pure mapping/prune/list/addressing | `test/checkpoints.test.mjs` | ≤N nearest mapping (incl. unbound skip), per-session + soft-byte-quota pruning with newest-retained floor, rule attribution, input parsing (step/prefix/latest/clear), step-number → seq fold, prefix resolution, short-id/relative-age/more-footer rendering |
| Confirm gate + event gate | `test/gate.test.mjs` | fail-closed matrix (approve/cancel/custom/throw/no-provider/no-open-turn with actionable reason), open-turn detection, ignorable-envelope decision + append shape |
| git provider | `test/providers/git.test.mjs` | scripted command sequences, unborn-HEAD rejection, probe caching, clean-tree `commit-tree -p HEAD` fallback, explicit-parent diff-tree change set, incremental bytes, content dedup, explicit-path chunked restore + staged/untracked leftover union, **verb whitelist**, real-git round trip incl. staged-new-file survival (capability-gated) |
| copy provider | `test/providers/copy.test.mjs` | capture/manifest, excludes, hardlink reuse, incremental bytes, hash-verified dedup + quick-check blind-spot boundary, hash-mismatch restore rejection, mode restore (platform-gated), overwrite restore + leftover report, corrupt/traversing manifest rejection, orphan cleanup, concurrency |
| Plugin assembly | `test/index.test.mjs` | real Cordis + real SessionStore/CommandRuntime: snapshot triggers, step-window + concurrent dedup, boundary backfill, quota pruning incl. oversized-single-record floor, `/rewind` list/addressing/clear, denial path, guard checkpoint modes (warn/require/off), restore-failure (no fork, checkpoint kept), fork-failure (files restored, reported), full restore+fork with seed equality, command lifecycle reconstruction, rc.6 adaptive gate + ignorable probe |
| Projection unit | `test/projection.test.mjs` | pure folds (snapshot/bound/prune/rewind incl. preCheckpointId, unknown-id no-ops keep the state reference, wire schema), live-registry wiring (real SessionProjectionRegistry: synthetic events → `snapshot().values.checkpoints`), headless mount without the registry |
| Assembled headless | `test/integration/rewind-headless.mjs` | real storage hub (JSON backend) + real storage-domain + real user-questions: agent mutates 2 files across 2 turns → list (short ids) → restore → file contents + fork context + guard asserted; git flow asserts HEAD/reflog untouched |
