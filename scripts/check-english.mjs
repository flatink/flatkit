#!/usr/bin/env node
// English-only guard for the public repo (RFC open-core, decision 8): the flatkit codebase must be
// English — no French, no franglais. This is a heuristic, not a linguist: it flags accented characters
// (a strong French signal) and a short list of accent-free French function words. False positives can be
// silenced with a `// english-check-ignore-file` marker at the top of a file (use sparingly, e.g. for an
// intentional non-English test fixture).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, relative } from 'node:path'

const SELF = fileURLToPath(import.meta.url)
const ROOT = dirname(dirname(SELF))
const SCAN_DIRS = ['packages', 'scripts']
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.js', '.md'])
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git'])

// Accented letters used in French (strong signal). ASCII-only English never contains these.
const ACCENTS = /[àâäçéèêëîïôöùûüÿœæ]/i
// A few accent-free French words that are very unlikely in English comments/identifiers.
// Curated accent-free French words unlikely in English code/comments. We deliberately leave out tokens
// that double as English/CSS (e.g. "sans" → sans-serif, "des", "est") to avoid false positives.
const FRENCH_WORDS = /\b(?:les|une|avec|pour|dans|mais|donc|puis|ainsi|chaque|aucun|selon|qui|sont|cette|ceci|cela|nous|vous|leur|alors|être|aussi)\b/i

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (EXTS.has(extname(p))) files.push(p)
  }
}
for (const d of SCAN_DIRS) { try { walk(join(ROOT, d)) } catch { /* dir may not exist yet */ } }

const hits = []
for (const file of files) {
  if (file === SELF) continue // this guard intentionally contains the French detection patterns
  const text = readFileSync(file, 'utf8')
  if (text.startsWith('// english-check-ignore-file') || text.startsWith('<!-- english-check-ignore-file')) continue
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (ACCENTS.test(line) || FRENCH_WORDS.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
  }
}

if (hits.length) {
  process.stderr.write(`check-english: ${hits.length} line(s) look French — the public repo must be English only.\n`)
  for (const h of hits.slice(0, 50)) process.stderr.write(`  ${h}\n`)
  if (hits.length > 50) process.stderr.write(`  … and ${hits.length - 50} more\n`)
  process.exit(1)
}
process.stdout.write(`check-english: OK (${files.length} files scanned, English only)\n`)
