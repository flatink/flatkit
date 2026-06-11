// Anti-regression safeguard: the PLAYER (public runtime) must stay LIGHTWEIGHT. Its VALUE import
// graph must NEVER pull in a heavy dep (clipper2-wasm / polygon-clipping / skia-canvas) nor an
// EDITING module (booleanOps/geometry/regions) -- they stay confined to authoring, not playback.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packagesRoot = resolve(here, '..', '..') // .../packages
const HEAVY_DEPS = ['clipper2-wasm', 'polygon-clipping', 'skia-canvas']
const HEAVY_MODULES = ['engine/src/booleanOps', 'engine/src/geometry', 'engine/src/regions']

const fileFor = (base: string): string | null => {
  if (existsSync(base + '.ts')) return base + '.ts'
  if (existsSync(join(base, 'index.ts'))) return join(base, 'index.ts')
  return null
}

/** Resolve an import specifier (relative OR a `@flatkit/<pkg>[/<sub>]` workspace package) to a source file. */
const resolveTs = (fromFile: string, spec: string): string | null => {
  if (spec.startsWith('.')) return fileFor(resolve(dirname(fromFile), spec))
  const wsMatch = /^@flatkit\/([^/]+)(?:\/(.+))?$/.exec(spec)
  if (wsMatch) return fileFor(join(packagesRoot, wsMatch[1], 'src', wsMatch[2] ?? 'index'))
  return null
}

/** Follows the VALUE imports (ignores `import type ...` -- elided at build time, does not bloat the bundle).
 *  Resolves across workspace package boundaries so the player's full transitive runtime graph is walked. */
function scan(entry: string): { files: Set<string>; externalDeps: Set<string> } {
  const files = new Set<string>(), externalDeps = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop()!
    if (files.has(f)) continue
    files.add(f)
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (/^\s*import\s+type\b/.test(line) || /^\s*export\s+type\b/.test(line)) continue // type-only -> elided
      const m = /\bfrom\s+['"]([^'"]+)['"]/.exec(line)
      if (!m) continue
      const spec = m[1]
      const r = resolveTs(f, spec)
      if (r) stack.push(r)
      else if (!spec.startsWith('.')) externalDeps.add(spec) // a true third-party (npm) dep
    }
  }
  return { files, externalDeps }
}

describe('player -- lightness (the runtime pulls in no heavy dep)', () => {
  it('player import graph: no clipper/polygon/skia nor any editing module', () => {
    const { files, externalDeps } = scan(join(here, 'index.ts'))
    expect(files.size).toBeGreaterThan(12) // anti-false-negative: the scan did walk the graph
    expect(HEAVY_DEPS.filter((d) => externalDeps.has(d))).toEqual([])
    expect([...files].filter((f) => HEAVY_MODULES.some((m) => f.includes(m))).map((f) => f.split('/src/')[1])).toEqual([])
  })
})
