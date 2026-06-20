#!/usr/bin/env node
// Bundle-size guard for the self-contained player runtime (packages/player/dist/browser.js — player +
// engine + types, minified by tsup). Prints minified / gzip / brotli and FAILS if gzip or brotli exceed
// the budget in `scripts/size-budget.json`. Run AFTER `pnpm build` (the `check:size` script assumes the
// dist exists; `pnpm size` builds first; CI runs it after the build step).
//
// Tracking over time: when an intentional size change lands, bump the budget IN THE SAME change with
//   `node scripts/check-size.mjs --update`
// then commit `scripts/size-budget.json` — its git history is the size-change log.
import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'

const root = new URL('..', import.meta.url).pathname
const budgetPath = root + 'scripts/size-budget.json'
const budget = JSON.parse(readFileSync(budgetPath, 'utf8'))
const update = process.argv.includes('--update')
const kb = (n) => (n / 1024).toFixed(1) + ' KB'
const ceil = (n) => Math.ceil((n * 1.08) / 256) * 256 // ~8% headroom, rounded to 256 B
let failed = false

for (const [file, lim] of Object.entries(budget)) {
  let buf
  try { buf = readFileSync(root + 'packages/player/dist/' + file) }
  catch { console.error(`✗ ${file} not found — run \`pnpm build\` first`); process.exit(1) }
  const min = buf.length
  const gz = gzipSync(buf, { level: 9 }).length
  const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
  if (update) { budget[file] = { gzip: ceil(gz), brotli: ceil(br) }; continue }
  const pct = (v, l) => ((100 * v) / l).toFixed(0) + '%'
  console.log(`\n${file}  (self-contained player runtime: player + engine + types)`)
  console.log(`  minified : ${min} B  (${kb(min)})`)
  console.log(`  gzip     : ${gz} B  (${kb(gz)})   ${pct(gz, lim.gzip)} of ${kb(lim.gzip)} budget`)
  console.log(`  brotli   : ${br} B  (${kb(br)})   ${pct(br, lim.brotli)} of ${kb(lim.brotli)} budget`)
  if (gz > lim.gzip) { console.error(`  ✗ gzip over budget by ${gz - lim.gzip} B`); failed = true }
  if (br > lim.brotli) { console.error(`  ✗ brotli over budget by ${br - lim.brotli} B`); failed = true }
}

if (update) {
  writeFileSync(budgetPath, JSON.stringify(budget, null, 2) + '\n')
  console.log('✓ budget updated → scripts/size-budget.json (commit it)')
  process.exit(0)
}
if (failed) { console.error('\n✗ over budget — shrink it, or `node scripts/check-size.mjs --update` if the growth is intentional'); process.exit(1) }
console.log('\n✓ within budget')
