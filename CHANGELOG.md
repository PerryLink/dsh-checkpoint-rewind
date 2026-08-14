# Changelog

All notable changes to dsh-checkpoint-rewind are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project versions with [SemVer](https://semver.org/).

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
