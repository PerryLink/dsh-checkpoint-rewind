# Third-party notices

dsh-checkpoint-rewind reuses no third-party source code.

Runtime dependencies: Node.js built-in modules (`node:fs`, `node:path`,
`node:os`, `node:crypto`, `node:child_process`) plus `zod` (MIT,
https://github.com/colinhacks/zod) for the durable checkpoint-record schema.
The DeepSeek Harness packages listed in `peerDependencies`
(`@deepseek-ai/cordis`, `@deepseek-ai/dsh-session`,
`@deepseek-ai/dsh-storage-domain`, `@deepseek-ai/schemastery`) are provided
by the harness installation itself and are not bundled or redistributed here.

The plugin's repository layout, bundle manifest pattern, and session-event
adaptive gate follow the editorial structure of the
`dsh-memento` plugin (Apache-2.0, same plugin family; used as a behavioral
reference only — no code was copied).
