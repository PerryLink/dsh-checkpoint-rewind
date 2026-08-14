# Security policy for dsh-checkpoint-rewind

## Reporting a vulnerability

Report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/PerryLink/dsh-checkpoint-rewind/security/advisories/new),
or file a [GitHub issue](https://github.com/PerryLink/dsh-checkpoint-rewind/issues)
when the finding is not exploitable. Include the affected version, the
observed behavior, and steps to reproduce.

## Security surface

The plugin runs inside the DeepSeek Harness process and observes these
boundaries:

| Resource | Access |
|---|---|
| Workspace files | read for snapshot capture; written only on an approved `/rewind <id>` restore (overwrite of captured files — never deletion) |
| Snapshot storage | writes only under `snapshotDir` (default `$DSH_HOME/dsh-checkpoint-rewind/`) |
| Git repository | runs only whitelisted side-effect-free primitives (`stash create`, `commit-tree`, `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse`) — never `reset --hard`, never `clean`, never index/history mutation |
| Session log | read for step/turn boundaries; appends log-only `checkpoint/*` events when the host knows them (adaptive gate) and a plugin-source notice to fork children |
| Network | none |
| Credentials / secrets | none read, none stored |
| Subprocesses | spawns only the configured `gitBin` with a fixed argument whitelist |

## Safety invariants

- Restore overwrites user files only after an ask-semantics confirmation
  (userQuestions / approval); a missing or failing answerer **fails closed**.
- The two-phase rewind runs files first, fork second; a failed restore
  never forks and never prunes the checkpoint.
- Every model-visible fact is reconstructable from the session log
  (`command/run` + `command/done`, and `checkpoint/*` events once a host
  build knows them) plus the durable `checkpoints` storage domain.

## Supported versions

The latest release on `main` is supported. Pre-release commits carry no
compatibility promise.
