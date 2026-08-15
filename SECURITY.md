# Security policy for dsh-checkpoint-rewind

## Reporting a vulnerability

Report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/PerryLink/dsh-checkpoint-rewind/security/advisories/new)
(private vulnerability reporting — only the maintainer sees the report).
Use a [GitHub issue](https://github.com/PerryLink/dsh-checkpoint-rewind/issues)
only when the finding is not exploitable. Include the affected version, the
observed behavior, and steps to reproduce.

**Redact before reporting**: reports and any attached logs must not contain
tokens, API keys, credentials, authorization headers, or real user workspace
content. Replace sensitive values with `<redacted>` before submitting.

## Response expectations

- The maintainer is a solo maintainer; expect an initial acknowledgement
  within **7 days** and a status update on every change.
- Findings that break a documented safety invariant (for example: restore
  through a symbolic link, a path traversal out of the snapshot root, or a
  git primitive outside the whitelist) are treated as high priority.
- Fixes land in a patch release with a `SECURITY.md`/CHANGELOG entry.

## Credit and disclosure

- Reporters are credited in the release notes and in the advisory, unless
  they ask to stay anonymous.
- Public disclosure follows the advisory, coordinated with the reporter.

## Security surface

The plugin runs inside the DeepSeek Harness process and observes these
boundaries:

| Resource | Access |
|---|---|
| Workspace files | read for snapshot capture; written only on an approved `/rewind <id>` restore (overwrite of captured files — never deletion, never through a symbolic link out of the workspace) |
| Snapshot storage | writes only under `snapshotDir` (default `$DSH_HOME/dsh-checkpoint-rewind/`); checkpoint refs are validated as snapshot ids before being joined into storage paths (no `..` traversal) |
| Git repository | runs only whitelisted side-effect-free primitives (`stash create`, `commit-tree`, path-explicit `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse`) with object refs validated as 40/64-hex ids before being passed as arguments — never `reset --hard`, never `clean`, never index/history mutation, never `git restore … -- .` (it would delete files `git add`-ed after a checkpoint) |
| Session log | read for step/turn boundaries; appends log-only `checkpoint/*` events when the host knows them or supports the `ignorable` envelope (adaptive gate; the runtime probe runs on a detached, never-persisted session store) and a plugin-source notice to fork children |
| Network | none |
| Credentials / secrets | none read, none stored |
| Subprocesses | spawns only the configured `gitBin` with a fixed argument whitelist, `GIT_TERMINAL_PROMPT=0` (no interactive prompts can hang the snapshot chain) and `GIT_OPTIONAL_LOCKS=0` |

## Safety invariants

- Restore overwrites user files only after an ask-semantics confirmation
  (userQuestions / approval); a missing or failing answerer **fails closed**.
  `/rewind preview <target>` is the read-only impact view: it never prompts,
  never writes, and never forks.
- The three-phase rewind runs guard checkpoint first, file restore second,
  fork third; a failed restore never forks and never prunes the checkpoint,
  and the guard checkpoint makes every approved rewind undoable
  (`preRewindCheckpoint: require` aborts when the guard cannot be captured).
- Restore never deletes: files created after a checkpoint — untracked **or**
  staged — are reported and left in place.
- Restore never follows links and never traverses paths: copy-provider
  checkpoint refs are format-validated before path joining, destination
  paths (and their ancestor directories) that are symbolic links are
  refused before writing, and snapshot-storage files that became symbolic
  links are refused before reading; git-provider object refs are
  format-validated before being passed to git.
- Every model-visible fact is reconstructable from the session log
  (`command/run` + `command/done`, and `checkpoint/*` events once a host
  build knows them or the `ignorable` envelope) plus the durable
  `checkpoints` storage domain.

## Supported versions

The latest release on `main` is supported. Pre-release commits carry no
compatibility promise.
