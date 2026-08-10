#!/usr/bin/env node
// Copy the language reference docs into @flatkit/compiler so they SHIP.
//
// They were repo-only, so a consumer who wanted the gotchas beside their generator copied the file —
// and a copied reference diverges. Measured: a neighbouring repo carries a 423-line copy of
// `dsl-gotchas.md` that has already drifted from ours. Same disease as the prompts, same cure.
//
// Generated, gitignored, rebuilt by `pnpm build`: docs/ stays the single source.
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FROM = join(ROOT, 'docs')
const TO = join(ROOT, 'packages/compiler/docs')

// The GUIDES only — the ones docs/README.md indexes. Design notes, spikes and RFCs are working
// material: they age, they argue with themselves, and they are not a reference anyone should copy.
const SHIPPED = [
  'README.md',
  'getting-started.md',
  'scene-and-drawing.md',
  'animating-symbols.md',
  'behavior-and-interactions.md',
  'expressions-and-stdlib.md',
  'tooling.md',
  'host-integration.md',
  'embedding-fonts.md',
  'dsl-gotchas.md',
]

mkdirSync(TO, { recursive: true })
const shipped = SHIPPED
for (const f of shipped) copyFileSync(join(FROM, f), join(TO, f))
process.stdout.write(`sync-docs: ${shipped.length} file(s) -> packages/compiler/docs/\n`)
