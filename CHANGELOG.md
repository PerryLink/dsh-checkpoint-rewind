# Changelog

All notable changes to dsh-checkpoint-rewind are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project versions with [SemVer](https://semver.org/).

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
