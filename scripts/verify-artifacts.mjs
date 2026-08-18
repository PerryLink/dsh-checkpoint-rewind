// Verify the shipped artifacts of this pure-JS package: every published file
// the plugin needs is present, the host face and every lib module parse under
// plain Node, and the host face imports with the expected plugin contract
// (name === 'checkpoint-rewind', apply is a function). Guards against a
// tarball missing modules or carrying unparseable output.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const required = [
  'index.mjs',
  'types.d.ts',
  'typert.host.mjs',
  'cordis.patch.yml',
]
for (const rel of required) {
  if (!existsSync(path.join(root, rel))) throw new Error(`missing artifact: ${rel}`)
}

const libFiles = []
const walk = (dir, prefix) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`)
    else if (entry.endsWith('.mjs')) libFiles.push(`${prefix}${entry}`)
  }
}
walk(path.join(root, 'lib'), 'lib/')
if (libFiles.length === 0) throw new Error('lib/ contains no .mjs modules')

for (const rel of ['index.mjs', 'typert.host.mjs', ...libFiles]) {
  execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'inherit' })
}

const index = await import(pathToFileURL(path.join(root, 'index.mjs')).href)
if (index.name !== 'checkpoint-rewind' || typeof index.apply !== 'function') {
  throw new Error('index.mjs exports an unexpected plugin face')
}

console.log(`artifacts OK: ${libFiles.length} lib modules + host faces syntax-checked and importable`)
