// test/composition.test.mjs — 真实 Loader composition 套件（社区五层模型 4–5 层）：
// 独立进程挂载 Loader + Include builtin，读 cordis.yml（真实 service 行 + 插件行 +
// config），证明模块解包、inject 解析、config 应用与注册表贡献——手搭 ctx.plugin
// 走不到这些路径。同时携带两类负例：非法 config 必须按预期原因响亮失败（U4），
// default 导出必须以 missing-inject 原因失败（C2 Loader 回归）。
// @module dsh-checkpoint-rewind/test/composition.test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runner = join(repositoryRoot, 'scripts', 'loader-runner.mjs')
const entry = join(repositoryRoot, 'index.mjs')

/** One cordis.yml: real service rows, then the plugin row with config. */
function configFor(pluginRow, configLines = []) {
  return [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-commands'",
    `- name: ${JSON.stringify(pluginRow)}`,
    ...(configLines.length > 0 ? ['  config: ', ...configLines.map(line => `    ${line}`)] : []),
    '',
  ].join('\n')
}

function runRunner(configPath, expected) {
  const result = spawnSync(process.execPath, [runner, configPath, expected], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 120_000,
  })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-checkpoint-rewind-loader-'))

test('Loader composition mounts the plugin and applies its default config', () => {
  const configPath = join(temporaryRoot, 'valid.yml')
  writeFileSync(configPath, configFor(pathToFileURL(entry).href))
  const evidence = runRunner(configPath, 'tool')
  assert.equal(evidence.status, 0, `stdout:\n${evidence.stdout}\nstderr:\n${evidence.stderr}`)
  const marker = evidence.stdout.match(/DSH_LOADER_RESULT (.+)$/mu)
  const summary = JSON.parse(marker[1])
  assert.ok(summary.commands.includes('rewind'))
  assert.ok(summary.commands.includes('checkpoint'))
  assert.equal(summary.checkpointTool, true)
  assert.equal(summary.rewindKind, 'error')
})

test('Loader composition applies the special config value (checkpointTool: false)', () => {
  const configPath = join(temporaryRoot, 'no-tool.yml')
  writeFileSync(configPath, configFor(pathToFileURL(entry).href, [
    'checkpointTool: false',
  ]))
  const evidence = runRunner(configPath, 'no-tool')
  assert.equal(evidence.status, 0, `stdout:\n${evidence.stdout}\nstderr:\n${evidence.stderr}`)
  const marker = evidence.stdout.match(/DSH_LOADER_RESULT (.+)$/mu)
  const summary = JSON.parse(marker[1])
  assert.equal(summary.checkpointTool, false)
  assert.ok(summary.commands.includes('rewind'), '/rewind stays registered when only the tool is disabled')
})

test('invalid config fails loud through the Loader for the expected reason', () => {
  const cases = [
    { lines: ["enabled: 'yes'"], reason: /expected boolean/u },
    { lines: ["provider: 'rsync'"], reason: /provider/u },
    { lines: ["confirmVia: 'x'"], reason: /confirmVia/u },
  ]
  const entryUrl = pathToFileURL(entry).href
  for (const entryCase of cases) {
    const configPath = join(temporaryRoot, 'invalid.yml')
    writeFileSync(configPath, configFor(entryUrl, entryCase.lines))
    const evidence = runRunner(configPath, 'tool')
    assert.notEqual(evidence.status, 0, `invalid config unexpectedly mounted:\n${entryCase.lines.join('\n')}`)
    assert.match(evidence.stderr, entryCase.reason, `failed for the wrong reason:\n${evidence.stderr}`)
  }
})

test('a default export fails through the Loader with the missing-inject reason', () => {
  const wrapper = join(temporaryRoot, 'default-export.mjs')
  const builtUrl = pathToFileURL(entry).href
  writeFileSync(wrapper, [
    `export { name, inject, Config, apply } from ${JSON.stringify(builtUrl)}`,
    `export { apply as default } from ${JSON.stringify(builtUrl)}`,
    '',
  ].join('\n'))
  const configPath = join(temporaryRoot, 'invalid-default.yml')
  writeFileSync(configPath, configFor(pathToFileURL(wrapper).href))
  const evidence = runRunner(configPath, 'tool')
  assert.notEqual(evidence.status, 0, 'default-export wrapper unexpectedly mounted')
  assert.match(evidence.stderr, /without inject/u, `failed for the wrong reason:\n${evidence.stderr}`)
})

test.after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})
