# Changelog

All notable changes to dsh-checkpoint-rewind are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project versions with [SemVer](https://semver.org/).

## [0.6.1] - 2026-08-27

### Fixed

- Declare the web-client inject packages (`@deepseek-ai/dsh-client-connection`,
  `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-runtime`,
  `@deepseek-ai/dsh-client-ui-settings`) as optional peerDependencies so the
  bundle composition is explicit and standalone installs stay clean.

## [0.6.0] - 2026-08-26

### Added

- Per-file side-by-side diff renderer seam. The Settings-page pairwise diff is extracted into a pluggable renderer contract (`lib/render.mjs`: diff data → render input, zero-dependency pure functions) with two built-in renderers — `pairwise` (the existing line-level text view, default) and `side-by-side` (per-file two-column rows + config add/remove line pairing). The client resolves the renderer from the new `diffRenderer` config (`pairwise` default; `side-by-side` opt-in) and falls back to `pairwise` for unknown ids, so the existing view can never regress.
- Selective file restore. `/rewind workspace <id> --files <a,b,…>` (and the bare `<id> --files …` form) restores only the selected files through the existing approval-gated restore transaction — never a new approval-bypass path. Unknown paths fail closed; the filter is incompatible with `workspaceRestore: reset-hard` and is gated by the new `selectiveRestore` config (default on).
- Per-file preview with byte sizes. The git/copy providers' `preview` now returns `entries` (`{path, bytes}` per overwritten file) and their `diffFiles` returns `entries` (`{path, status}`); the panel gains a read-only `restorePreview(id)` remote that feeds the client's per-file checkbox + size total (select/deselect all, then copy `/rewind workspace <id> --files …`).

### Changed

- `lib/wire.mjs` gains the `restorePreview` descriptor and per-file `entries` on the diff result; `lib/panel.mjs` exposes `diffRenderer`/`selectiveRestore` on the timeline snapshot. `lib/providers/definition.mjs` documents the extended `restore(…, files?)` signature and the new `entries` fields.

## [0.5.5] — 2026-08-23

### Changed

- Align the `@deepseek-ai/schemastery` peer (and dev) range to `^3.18.0` from the overly broad `>=3.0.0`, matching the harness's shipped schemastery (3.18.x) and the rest of the `@deepseek-ai/dsh-*` peer surface. No functional change.

## [0.5.4] — 2026-08-22

### Changed

- Upgrade to DeepSeek Harness rc.2 (`0.1.1-rc.2`): every `@deepseek-ai/dsh-*` dev dependency is pinned to `0.1.1-rc.2` and the workshop compatibility declaration lists `0.1.1-rc.2`; peers stay `>=0.1.0-rc.8 <0.2.0` because the plugin's required service surface (`commands`, `session`, `llm`, `tools`, `storage-domain`, `typert-protocol`) is unchanged from rc.8. The compat workflow's pinned harness and base/headless rows move to `0.1.1-rc.2`.
- Adapt the `checkpoints` session-projection unit to the rc.2 `ProjectionDefinition` contract: the wire schema moves from the top-level `schema` into `wire.viewSchema` (alongside `view`), and the persisted fold state is now validated by the required `stateSchema` (`z.record(checkpointWireSchema)`); `stateVersion` stays `0` (non-negative integer, now enforced at registration). `index.mjs` registers the unit unchanged — the shape change is confined to `lib/projection.mjs`.
- The checkpoint dedup reply no longer leaves the user guessing. When a manual `checkpoint` call is deduplicated (workspace tree identical to the latest snapshot), the message still says nothing new was captured, but now appends an explanation when one is warranted: if the dedup baseline is an automatic snapshot, it notes that the latest checkpoint (auto, seq) already records the exact workspace state — an auto snapshot may have just captured the same tree moments earlier, which previously made a successful dedup look like a failed capture; if the git provider sees untracked files, it notes that git snapshots only cover tracked files and suggests staging them with `git add` so future checkpoints include them. The hints are best-effort: a provider-side failure degrades silently to the plain message, and the copy provider (whole-directory snapshots, no untracked concept) never sees the git-only hint.
- The git provider exposes a new optional read-only method `untrackedFiles(workspace)` (`git ls-files --others --exclude-standard`, the same whitelist verb restore/preview already use) so consumers can surface the tracked-only coverage gap; restore and preview reuse the extracted implementation.
- Regression coverage: `test/index.test.mjs` pins the auto-snapshot hint (copy provider) and the untracked-files hint (real git repository, skip-guarded); `test/providers/git.test.mjs` pins the `untrackedFiles` method with a scripted runner (list + empty output).

### Fixed

- The checkpoint registry is no longer permanently unavailable when the plugin's `apply` finishes before the `storage-domain` row registers its service. `storageDomain` is an optional service (missing = graceful degradation), so the plugin does not inject it and used to capture it once with `ctx.get()` at apply time; sibling rows mount in service-availability order and `dsh-storage-domain`'s apply is asynchronous, so an early apply captured `undefined` and never re-checked — every capture silently failed and `checkpoints.json` stopped being written while logs stayed clean. The registry now resolves the service lazily at first use via a memoized getter (same pattern as `dsh-checkpoint-diff`'s `sessionQuery` handling): by the time the first tool call or command runs the composition is complete, and a genuinely missing storage stack still rejects with the same structured error naming the storage rows to add.
- Regression coverage: `test/storage-lazy.test.mjs` mounts the plugin before the storage service exists and pins that a first-use capture lands after the service appears (snapshot record written, `/rewind` list succeeds instead of returning the structured unavailable error).
- Checkpoint capture no longer silently fails on media created by 0.4.x. The storage layer (`@deepseek-ai/dsh-storage-json`) rejects a version mismatch with `version-mismatch` and has no migration, so after the 0.5.0 domain bump (v1 → v2) the plugin could not open an existing v1 medium: the registry stayed unavailable and every checkpoint/rewrite path failed while logs kept growing. The plugin now opens the domain dual-version like its consumers (`dsh-checkpoint-diff`): it tries the v2 spec first (fresh media are still created as v2) and falls back to a v1-compatible spec on `version-mismatch`/`malformed-medium`. The v1 fallback uses a tolerant record schema (v2 fields optional plus `forkSeq`), so 0.4.x records stay readable, new captures are stored in the v2 shape in the same medium, and both shapes coexist. A warning is logged when compatibility mode is active; the medium keeps its v1 header until it is recreated (no automatic migration in the storage layer).
- Regression coverage: `test/medium-compat.test.mjs` pins the v1-medium fallback (old records readable, new captures v2-shaped), the v2-medium path, fresh-medium v2 creation, and the tolerant schema accepting both record shapes.
- The `checkpoint` tool's `presentCall` returns a `ToolCallView` object card (`{card: 'generic', title: …}`) instead of a plain string. The host wraps presenter returns verbatim and the client rejects non-object views, so the string made any session containing a checkpoint call fail to load its history page (`invalid_type` at `events[i].view.view`) — long sessions became unopenable.
- Regression coverage: `test/index.test.mjs` pins the `presentCall` object-card shape (with and without a note).

## [0.5.3] — 2026-08-21

### Changed

- Upgrade to DeepSeek Harness rc.8: every `@deepseek-ai/dsh-*` peer is now `>=0.1.0-rc.8 <0.2.0` and every dev dependency is pinned to `0.1.0-rc.8`. The workshop compatibility declaration now lists `0.1.0-rc.8`.
- Adapt to the rc.8 `commands` service: `execute(agent, line, images, signal)` now takes an image list before the cancellation signal — the test helpers, the loader composition runner, and the compat workflow's pinned harness are updated to the four-argument call shape. Plugin handlers keep consuming `invocation.agent` / `rawInput` / `signal` unchanged.
- README (five languages), AGENTS.md and ARCHITECTURE.md now describe the rc.8 adaptive-gate status: rc.8 still ships no plugin event-registration surface and `Session.append` still drops the `ignorable` option, so the gate stays closed and the audit chain remains `command/run` + `command/done` plus the durable `checkpoints` domain.

### Fixed

- `checkpointPanel/timeline` accepts calls without a `limit` (issue #5): the wire descriptor now declares `acceptsUndefined: true` on the `limit` parameter. The Typert gateway's exact-args check only authorizes an omitted JSON field via that flag (or the `src-json` codec mode); a zod `.optional()` schema validates a provided value but never authorized the field's absence, so the client's initial `timeline({})` call was rejected before the service ran.
- Regression coverage: `test/panel.test.mjs` pins the `acceptsUndefined` descriptor contract.
- `checkpointPanel/timeline` and `checkpointPanel/diff` no longer fail with `Cannot read private member #deps` (issue #6): `CheckpointPanelService` stores its dependencies in a plain `_deps` property. Remote invocations resolve the service through cordis's traceable proxy, where `this` is a Proxy of the instance and private-brand checks on `#private` fields throw; plain data properties pass through the proxy's get trap untouched. Internal helper classes never resolved through `ctx.get()` are unaffected and keep their `#private` fields.
- Regression coverage: `test/panel.test.mjs` drives both panel methods through a `Proxy` of the service instance, reproducing the cordis traceable-proxy invocation shape.

## [0.5.2] — 2026-08-17

### Fixed

- `resolveSnapshotDir` no longer throws when `$DSH_HOME` is not exported (issue #4): the default copy-provider snapshot root falls back to `~/.dsh/dsh-checkpoint-rewind` — the same location dsh uses by default — instead of crashing the first snapshot capture. "Running under dsh" does not guarantee `$DSH_HOME` is exported, and the safety net must not break the capture path.
- Regression coverage: `test/workspace.test.mjs` pins every `resolveSnapshotDir` resolution mode, including the unset-`$DSH_HOME` fallback.

## [0.5.1] — 2026-08-17

### Fixed

- Profiles without a storage stack now boot: `storageDomain` became an optional service (`ctx.get`, graceful degradation) instead of a hard `inject`, so the plugin no longer leaves the profile hanging at `pending (waiting for service: storageDomain)`. Checkpoint/rewind commands return a structured error naming the exact rows to add (`@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` with config `root` + `@deepseek-ai/dsh-storage-domain` with config `backend: json`), and the automatic snapshot/backfill/prune hooks degrade to log-only warnings.
- Regression coverage: `test/no-storage.test.mjs` mounts the plugin without `storageDomain` and asserts the graceful degradation (commands explain the fix, event hooks stay quiet).

### Changed

- Five-language READMEs and AGENTS.md document the optional storage stack and the composition snippet.

## [0.5.0] — 2026-08-16

### Added

- **Checkpoint settings-page timeline and pairwise diffs**: a settings
  panel (`client/` + `lib/panel.mjs` + `lib/wire.mjs` +
  `lib/settings-schema.mjs`) whose dual-source schema keys stay in sync
  (cordis.yml Schemastery ⇄ settings zod), with a timeline view of the
  session's checkpoints and pairwise diffs between snapshots.
- **Line-level LCS unified diff** (`lib/diff.mjs`): `@@` headers carry the
  1-based line number of each side's first changed line.
- **Seed-replay session rewind** (`lib/session.mjs`): session-boundary and
  replay-seed pure functions; rewinds restore through the official
  `sessions.create` seed replay.
- **Per-turn automatic snapshots** plus change-triggered snapshots.

### Changed

- Integration verification aligned with the 0.5.0 default behavior:
  `/rewind` lists four checkpoints, replay-ready target selection, and
  child-session notice wording.
- `package.json#test:integration` now points at the renamed
  `test/integration/rewind-headless.mjs`.

## [0.4.0] — 2026-08-15

### Added

- **`/rewind preview <target>`**: a read-only impact preview that lists the
  files a restore would overwrite and the files created after the checkpoint
  that would be left in place — no confirmation gate, no writes, no fork.
  The provider contract gains an optional `preview(workspace, ref)` method
  (git reuses the restore counting commands without executing `restore`;
  copy compares the manifest against the workspace, hashing content when
  `verifyByHash` is on). Addressing is shared with `/rewind`
  (`<id-prefix>`, `step <N>`, `latest`).
- **Glob semantics for `excludeGlobs`**: the copy provider now matches real
  glob patterns (`*` within a segment, `?` single char, `**` across
  segments) instead of exact segment names. Patterns without `/` still
  match a segment name at any depth (defaults unchanged); patterns with `/`
  match relative paths; a directory matching a pattern excludes its whole
  subtree (gitignore semantics). Implemented by the new dependency-free
  `lib/glob.mjs`.
- npm publish workflow (`.github/workflows/publish.yml`): pushes of `v*`
  tags run the test suite and `npm publish` with an `NPM_TOKEN` secret.
- `exports` now carries a `types` condition for Node16 module resolution.

### Fixed

- **copy provider ref traversal**: checkpoint `ref`s from the (human-
  editable) JSON storage backend are now validated as snapshot ids before
  being joined into snapshot-directory paths — a tampered `ref: ".."` can
  no longer read or write outside the snapshot root.
- **copy restore symbolic-link escape**: restoring through a destination
  path (or ancestor directory) that has become a symbolic link would have
  written workspace content outside the workspace; the snapshot source
  being swapped for a symbolic link would have read external content in.
  Both are now refused loudly, per-path, before any copy.
- **git provider ref injection**: snapshot `previousRef` and restore `ref`
  are validated as 40/64-hex object ids before being passed to git — a
  tampered record can no longer smuggle git options (`--output=…` and
  friends) into `diff`/`restore` invocations.
- **git subprocess hardening**: git commands now run with
  `GIT_TERMINAL_PROMPT=0` (credential/confirmation prompts can no longer
  hang the snapshot chain) and `GIT_OPTIONAL_LOCKS=0`.
- **copy snapshot TOCTOU tolerance**: a file that disappears (or becomes
  unreadable) between traversal and copy is now skipped with a warning
  instead of failing the whole snapshot, so one transient file no longer
  costs a step its checkpoint.
- `/rewind step 0` (and non-positive step numbers) now fail at parse time
  with a usage message instead of a misleading "step not ended" error.

## [0.3.0] — 2026-08-14

### Added

- **Pre-rewind guard checkpoint**: every approved rewind first captures the
  current workspace state (three-phase transaction: guard → restore → fork),
  making the rewind itself undoable (`rewind guard: <id>` in the result).
  Config `preRewindCheckpoint: warn | require | off` (default `warn`).
- **Command addressing**: `/rewind <id-prefix>` (case-insensitive unique
  prefix), `/rewind step <N>` (nearest checkpoint ≤ that step's end), and
  `/rewind latest`; the list renders 8-char short ids, relative ages, and an
  "N older checkpoints" footer. New `/rewind clear` command deletes the
  session's checkpoints after confirmation (files untouched).
- **Adaptive event gate v2**: a runtime probe on a detached, never-persisted
  session store detects hosts whose `append` stamps the `ignorable` envelope;
  on such hosts `checkpoint/*` events are appended with `ignorable: true`
  automatically (rc.6 keeps the gate closed and safe).
- **copy provider `verifyByHash`** option: content-hash comparison replaces
  the size+mtime quick check (closes the `touch -r`/`rsync -t` blind spot)
  and verifies restored content; manifests stay backward-compatible.
- Best-effort file-mode restore for the copy provider.
- `mutationTools` defaults now include `pwsh` and `terminal_send`.

### Changed

- **Incremental byte accounting**: `maxSnapshotBytes` now measures
  incremental storage cost (git: changed-blob bytes via explicit-parent
  `diff-tree`; copy: actually-copied bytes), and the byte quota is a soft
  quota — the newest checkpoint per session is always retained, so large
  workspaces no longer self-prune. The prune event's `reason` now reflects
  the rule that actually triggered the pruning.
- git restore is now **explicit-path and chunked** (never emits
  `git restore … -- .`), so files `git add`-ed after the checkpoint are
  reported and left in place instead of being deleted; `restored` counts
  only files actually restored; leftovers report staged-new files too.
- Config validation covers array elements (`mutationTools`/`excludeGlobs`)
  and the new `preRewindCheckpoint`/`verifyByHash` fields.
- The session-projection unit registers via `ctx.inject(['sessionProjections'])`.
- zod upgraded to v4 (deduplicated with the host's `dsh-storage-domain`).

### Fixed

- unborn-HEAD repositories now degrade to the copy provider instead of
  failing every snapshot (git availability probes are also cached per
  workspace).
- Single-arg `git diff-tree` on two-parent stash commits produced an empty
  combined diff (zero changed-file counts for unstaged-only changes); the
  change set now diffs against the snapshot's first parent explicitly.
- The approval confirmation channel now detects the no-open-turn situation
  up front and fails closed with an actionable message instead of surfacing
  the harness's raw exception.
- `npm test` now runs `test/**/*.test.mjs` — the provider suites were
  previously excluded by the `test/*.test.mjs` glob and never ran in CI.
- Approval-side open-turn detection, step-state cleanup after `step/end`,
  and a guard-capture fallback when the dedup baseline is unreadable.

## [0.2.0] — unreleased

### Added

- Fork children receive an injected rewind notice (`user/message`, plugin
  source) describing which checkpoint the files were restored to, so the
  resumed model does not continue from stale tool results.
- `repository` / `homepage` / `bugs` metadata and `SECURITY.md`.
- CI: unit tests + assembled-headless integration on Windows/Linux × Node 22/24.

## [0.1.0] — 2026-08-13

### Added

- Workspace checkpoints before every mutating tool execution
  (`fs/write-intent`, `fs/edit-intent`, `tools/pre-execute` pass-through).
- Provider seam: git (`stash create` / `commit-tree`, worktree-only restore)
  with copy fallback (incremental directory snapshots + hardlinks).
- `/rewind` command: list checkpoints; confirm, restore files, then fork the
  session at the checkpoint's turn boundary (two-phase transaction).
- Boundary backfill (`stepEndSeq` for ≤N step mapping, `forkSeq` for the
  fork), durable `checkpoints` storage domain, quota pruning
  (`maxSnapshots` / `maxSnapshotBytes` / `pruneOnTurnEnd`).
- Session-projection unit `checkpoints` (registered when
  `ctx.sessionProjections` exists) as the Web checkpoint-strip anchor.
- 60 unit tests + assembled-headless integration verification
  (copy and git flows, real Cordis services).
