// scripts/loader-runner.mjs — real Loader composition runner (community
// five-layer model, layer 4). An independent process boots a real Context,
// mounts the vendored Loader with the Include builtin, reads the given
// cordis.yml (service rows + plugin row + config), then asserts the plugin's
// contributions through the authoritative registries and executes one real
// behavior. Config is applied by the Loader, so the expected outcome proves
// the config in the file was honored.
//
// Usage: node scripts/loader-runner.mjs <cordis.yml> tool|no-tool
// Exit 0 prints DSH_LOADER_RESULT <json>; any assertion or load failure exits
// non-zero with the reason on stderr (used by the invalid-config and
// default-export regression cases).

import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const configArgument = process.argv[2]
const expected = process.argv[3]
if (configArgument === undefined || (expected !== 'tool' && expected !== 'no-tool')) {
  console.error('usage: loader-runner.mjs <cordis.yml> tool|no-tool')
  process.exit(2)
}

const configPath = resolve(configArgument)
// Resolve bare package rows from this repository's dependency tree so the
// composition works with config files written anywhere (e.g. a temp dir).
const configRequire = createRequire(resolve(import.meta.dirname, '../package.json'))

const ctx = new Context()
try {
  ctx.baseUrl = `${pathToFileURL(dirname(configPath)).href}/`
  await ctx.plugin(Loader)
  ctx.loader.internal = /** @type {any} */ ({
    version: 'v2',
    async import(specifier) {
      if (specifier.startsWith('file:')) return import(specifier)
      if (specifier.startsWith('node:')) return import(specifier)
      const absolute = /^([a-zA-Z]:)?[\\/]/u.test(specifier)
      return import(pathToFileURL(absolute ? specifier : configRequire.resolve(specifier)).href)
    },
  })
  ctx.loader.builtins.include = Include
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()

  // Authoritative registries carry the plugin's contributions.
  const session = ctx.sessions.create(SessionId('dsh-checkpoint-rewind-loader-runner'), { meta: { cwd: resolve('work/proj') } })
  const agent = /** @type {any} */ ({
    id: session.id,
    options: { provider: 'deepseek', model: 'demo-model' },
    session,
    inbox: {},
    status: 'idle',
    ctx,
    cancel: () => undefined,
    whenIdle: async () => undefined,
    runMaintenance: async (task) => task(new AbortController().signal),
    send: () => undefined,
    followup: () => undefined,
    steer: () => undefined,
    inject: () => undefined,
  })
  const commands = ctx.commands.list(agent).map((entry) => entry.name)
  if (!commands.includes('rewind')) {
    throw new Error('Loader composition: /rewind command is missing from the commands registry')
  }
  if (!commands.includes('checkpoint')) {
    throw new Error('Loader composition: /checkpoint command is missing from the commands registry')
  }

  // The checkpoint tool presence proves the `checkpointTool` config was applied.
  const toolPresent = ctx.tools.get('checkpoint') !== undefined
  if (expected === 'tool' && !toolPresent) {
    throw new Error('Loader composition: checkpoint tool is missing (expected registered)')
  }
  if (expected === 'no-tool' && toolPresent) {
    throw new Error('Loader composition: checkpoint tool is registered (checkpointTool: false was not applied)')
  }

  // Real behavior: the /rewind command through the real commands service. With
  // no storage stack composed it must return the structured "storageDomain not
  // composed" error, proving the handler is actually wired.
  const execution = await ctx.commands.execute(agent, '/rewind', [], new AbortController().signal)
  const text = execution?.result?.text ?? ''
  if (!text.includes('storageDomain')) {
    throw new Error(`Loader composition: /rewind returned ${JSON.stringify(execution?.result)}`)
  }

  const summary = {
    commands,
    checkpointTool: toolPresent,
    rewindKind: execution.result.kind,
  }
  process.stdout.write(`DSH_LOADER_RESULT ${JSON.stringify(summary)}\n`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
} finally {
  await ctx.fiber.dispose()
}
