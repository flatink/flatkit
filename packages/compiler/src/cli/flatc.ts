// ─────────────────────────────────────────────────────────────────────────────
//  flatc — the "modern SWF" command-line compiler.
//
//  The VSCode-first flow: you write a `.flatink` program (composition + logic, DSL)
//  + `.flat` asset libs (visuals, exported by the editor) + media, then:
//
//      flatc game.flatink hero.flat decor.flat -o game.flatpack
//
//  → a single `.flatpack` (the baked Doc as JSON) that the player runs. Media referenced
//  by `asset "id" "path" kind` are EMBEDDED (paths relative to the program).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, readdirSync, watch, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, dirname, basename, extname, join, relative, isAbsolute } from 'node:path'
import { compileFlatpack, packToJSON, type MediaMap } from '../compile'
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import { hasPackage } from '@flatkit/engine/stdlib'
import { parseUnits } from '@flatkit/engine/dsl'
import { sanitizeDoc } from '@flatkit/engine/validateDoc'
import { unitsToFunctions } from '@flatkit/engine/scriptDoc'
import { lintDocReport, docHasErrors } from '../programDoc'
import { playHeadless, type Gesture } from '@flatkit/player'
import type { FuncDef } from '@flatkit/engine/actions'
import type { Doc } from '@flatkit/types'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  // Fonts (RFC 8081 media types) — matches the editor's import (`font/woff2` default, FontFace API).
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  // NB: video (.mp4/.webm/…) intentionally omitted — no video runtime in the editor or player yet.
}
const mimeFor = (path: string): string => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'

/**
 * True if `target` resolves to a file inside `baseDir` (or baseDir itself). Guards against a hostile
 * program escaping its folder via `../` in a media path or a `use` package name — compiling an untrusted
 * `.flatink` must never read (and embed) arbitrary host files.
 */
function isWithin(baseDir: string, target: string): boolean {
  const rel = relative(baseDir, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function printHelp(): void {
  process.stdout.write(`flatc — compile a FlatInk program into a .flatpack

Usage:
  flatc <program.flatink> [assets.flat …] [-o output.flatpack]
  flatc <program.flatink> --watch
  flatc --play <program.flatink | scene.flatpack> --script <gestures.json>
  flatc --render <program.flatink | scene.flatpack> -o out.png [--frame N] [--at k=v[,k2=v2]] [--scale S]

  program.flatink   the program (composition + logic, text DSL)
  assets.flat       visual asset libs (default: every .flat in the program's folder)
  -o, --out         output file (default: <program>.flatpack — the CANONICAL name, JSON inside)
  --assets MODE     media baking: 'inline' (default, base64 in the .flatpack) or 'external'
                    (sidecar <out>.assets/ folder; asset.data = relative key — serve the folder and
                    play with sameOriginAssetResolver(<flatpackUrl>))
  --check           semantic lint only (no .flatpack); exits ≠0 on ERROR (warnings do not stop)
  --watch           recompile on every change in the folder (agent → player loop)
  --play            run the file WITHOUT a canvas, replay --script and print { sends, vars } (JSON)
  --trace           (with --play) HUMAN-READABLE log per gesture: emitted sends + variable diff (debug)
  --script <f>      JSON gesture script: [{ "type": "down|move|up|cancel", "x", "y" }, { "type": "set", "name", "value" }, { "type": "wait", "frames": N }]
                    semantic (by NAME, the engine resolves coords): { "type": "drag", "source", "target" } · { "type": "tap", "target" }
                    · { "type": "scratch", "target" } (sweeps a reveal zone) · { "type": "connect", "source", "target" } (pulls a link wire)
                    "wait" lets the simulation run N fixed steps (60 Hz): "every frame" + playhead advance like in real playback
                    "expect" self-verifies: { "type": "expect", "sends": ["done"], "vars": { "score": 3 } } → exits ≠0 on mismatch
                    (sends = sequence of names emitted SINCE the last expect; vars = current state). Great in CI.
  --render          render a PNG IMAGE (headless skia): see what we draw (positioning)
  --frame N         (with --render) target frame (default 0)
  --at k=v[,k2=v2]  (with --render) force variables → capture a given state (e.g. a step of an escape)
  --steps N         (with --render) run N fixed sim steps (60 Hz, every-frame) BEFORE capture → see a
                    stateful act unfold without forcing every derived variable by hand in --at
  --scale S         (with --render) resolution factor (default 2)
  -h, --help        this help

Media referenced by 'asset "id" "path" kind' are embedded (paths relative to the program).
`)
}

/** How media is baked: `inline` = base64 data-URI in the .flatpack; `external` = relative key + sidecar files. */
type AssetMode = 'inline' | 'external'
type MediaCopy = { src: string; key: string } // external mode: source file → relative key (forward slashes)
type BuildResult = { doc: Doc; flatLibs: number; packages: number; media: number; mediaCopies: MediaCopy[] }

/**
 * Reads a `.flatink`, resolves libs/packages/media, compiles → standalone Doc. Throws on compile error.
 * `assetMode`: `inline` embeds each media as a base64 data-URI (default); `external` keeps `asset.data` as a
 * relative key (`<assetsDir>/<path>`) and returns the files to copy beside the .flatpack (no base64 bloat).
 */
function buildDocFromProgram(programPath: string, explicitFlats: string[] = [], assetMode: AssetMode = 'inline', assetsDir = ''): BuildResult {
  const baseDir = dirname(programPath)
  const programSrc = readFileSync(programPath, 'utf8')
  const prog = parseProgramFull(programSrc)

  // .flat libs: explicit if provided, otherwise auto-discover the .flat files in the program's folder.
  const flatPaths = new Set<string>(explicitFlats.map((p) => resolve(p)))
  if (!flatPaths.size) for (const f of readdirSync(baseDir).filter((f) => f.endsWith('.flat'))) flatPaths.add(join(baseDir, f))

  // PACKAGES: non-stdlib `use "x"` → local files inlined (x.flatink = functions, x.flat = symbols).
  const pkgFunctions: FuncDef[] = []
  const localResolved = new Set<string>()
  for (const name of prog.imports ?? []) {
    if (hasPackage(name)) continue // stdlib → left as a reference
    const fink = join(baseDir, name + '.flatink')
    const fflat = join(baseDir, name + '.flat')
    if (!isWithin(baseDir, fink) || !isWithin(baseDir, fflat)) { process.stderr.write(`flatc: package outside the program folder (ignored): "${name}"\n`); continue }
    let found = false
    if (existsSync(fink)) { for (const f of unitsToFunctions(parseUnits(readFileSync(fink, 'utf8')).units)) pkgFunctions.push(f, { ...f, name: `${name}.${f.name}` }); found = true }
    if (existsSync(fflat)) { flatPaths.add(fflat); found = true }
    if (found) localResolved.add(name)
    else process.stderr.write(`flatc: package not found: "${name}" (neither stdlib, nor ${name}.flatink / ${name}.flat)\n`)
  }
  const assetSrcs = [...flatPaths].map((p) => readFileSync(p, 'utf8'))

  // Media: each `asset … "path" …` resolved relative to the program. `inline` → base64 data-URI baked in;
  // `external` → `asset.data` becomes a relative key and the file is copied next to the .flatpack.
  const media: MediaMap = {}
  const mediaCopies: MediaCopy[] = []
  for (const a of prog.assets ?? []) {
    const mp = resolve(baseDir, a.data)
    if (!isWithin(baseDir, mp)) { process.stderr.write(`flatc: media outside the program folder (ignored): ${a.data}\n`); continue }
    if (!existsSync(mp)) { process.stderr.write(`flatc: missing media (ignored): ${a.data}\n`); continue }
    const mime = mimeFor(mp)
    if (assetMode === 'external') {
      const key = `${assetsDir}/${a.data.replace(/\\/g, '/')}` // URL-form relative key (resolved by the host)
      media[a.data] = { mime, data: key }
      mediaCopies.push({ src: mp, key })
    } else {
      media[a.data] = { mime, data: `data:${mime};base64,${readFileSync(mp).toString('base64')}` }
    }
  }

  let doc = compileFlatpack(programSrc, assetSrcs, media)
  if (pkgFunctions.length) doc = { ...doc, functions: [...(doc.functions ?? []), ...pkgFunctions] }
  const stdImports = (doc.imports ?? []).filter(hasPackage)
  doc = { ...doc, imports: stdImports.length ? stdImports : undefined }
  return { doc, flatLibs: flatPaths.size, packages: localResolved.size, media: Object.keys(media).length, mediaCopies }
}

/** Compile once (write or --check). Returns the exit code. */
function compileOnce(programPath: string, explicitFlats: string[], out: string, checkOnly: boolean, assetMode: AssetMode = 'inline'): number {
  const outPath = out ? resolve(out) : join(dirname(programPath), basename(programPath, extname(programPath)) + '.flatpack')
  // External mode: sidecar folder next to the .flatpack, e.g. `game.flatpack` → `game.assets/`.
  const assetsDir = assetMode === 'external' ? basename(outPath, extname(outPath)) + '.assets' : ''
  let built: BuildResult
  try { built = buildDocFromProgram(programPath, explicitFlats, assetMode, assetsDir) }
  catch (e) { process.stderr.write(`flatc: compile error: ${(e as Error).message}\n`); return 1 }
  const { doc } = built
  const report = lintDocReport(doc)
  if (checkOnly) {
    if (report) process.stderr.write(report + '\n')
    if (docHasErrors(doc)) return 1
    process.stdout.write('flatc: no errors ✓\n')
    return 0
  }
  if (report) process.stderr.write(report + '\n') // compile anyway: diagnostics as warnings
  writeFileSync(outPath, packToJSON(doc))
  const outDir = dirname(outPath)
  for (const c of built.mediaCopies) {
    const dest = join(outDir, ...c.key.split('/'))
    if (!isWithin(outDir, dest)) continue // defensive: never write outside the output folder
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(c.src, dest)
  }
  const where = assetMode === 'external' ? ` (external → ${assetsDir}/)` : ''
  process.stdout.write(`flatc: ${basename(outPath)} ✓  ${doc.symbols.length} symbol(s) · ${built.flatLibs} lib(s) · ${built.packages} package(s) · ${built.media} media${where}\n`)
  return 0
}

/** Loads a Doc from a `.flatink` (compiled) or a `.flatpack`/`.flatpack.json` (already-baked JSON). */
function loadDoc(filePath: string): Doc {
  if (filePath.endsWith('.flatink')) return buildDocFromProgram(filePath).doc
  // .flatpack (canonical) or .flatpack.json (alias): untrusted JSON → normalize before use.
  return sanitizeDoc(JSON.parse(readFileSync(filePath, 'utf8')))
}

/** --play: runs the file headless, replays --script, prints { sends, vars }. */
function playOnce(filePath: string, scriptPath: string, trace: boolean): number {
  if (!scriptPath) { process.stderr.write('flatc: --play requires --script <gestures.json>\n'); return 1 }
  if (!existsSync(scriptPath)) { process.stderr.write(`flatc: script not found: ${scriptPath}\n`); return 1 }
  let doc: Doc, gestures: Gesture[]
  try { doc = loadDoc(filePath) } catch (e) { process.stderr.write(`flatc: cannot read: ${(e as Error).message}\n`); return 1 }
  try { gestures = JSON.parse(readFileSync(scriptPath, 'utf8')) as Gesture[] } catch (e) { process.stderr.write(`flatc: invalid JSON script: ${(e as Error).message}\n`); return 1 }
  if (!Array.isArray(gestures)) { process.stderr.write('flatc: the script must be an array of gestures\n'); return 1 }
  const res = playHeadless(doc, gestures, { trace })
  if (!trace) process.stdout.write(JSON.stringify(res, null, 2) + '\n')
  else // --trace: readable log (one gesture per line) → inspection / debug-player.
    for (const s of res.steps ?? []) {
      const sends = s.sends.length ? '  sends:[' + s.sends.map((e) => (e.value !== undefined ? `${e.name}=${e.value}` : e.name)).join(', ') + ']' : ''
      const vars = Object.entries(s.changed).map(([k, [a, b]]) => `${k}:${JSON.stringify(a)}→${JSON.stringify(b)}`)
      process.stdout.write(`${s.gesture.padEnd(28)}${sends}${vars.length ? '  vars{' + vars.join(' ') + '}' : ''}\n`)
    }
  // `expect`: any detected mismatch → stderr log + exit code ≠0 (CI self-verification).
  if (res.expectFailures?.length) {
    for (const f of res.expectFailures) process.stderr.write(`flatc: ✗ ${f}\n`)
    return 1
  }
  return 0
}

/** Parses `--at`: "k=v[,k2=v2]" → variable table (state override for rendering). */
function parseVars(spec: string, into: Record<string, number>): void {
  for (const pair of spec.split(',')) {
    const i = pair.indexOf('=')
    if (i < 0) continue
    const k = pair.slice(0, i).trim(); const v = Number(pair.slice(i + 1).trim())
    if (k && Number.isFinite(v)) into[k] = v
  }
}

/** --render: renders the file to PNG (headless skia). Async (SVG decode + raster). */
async function renderOnce(filePath: string, out: string, frame: number, vars: Record<string, number>, scale: number, steps: number): Promise<number> {
  let doc: Doc
  try { doc = loadDoc(filePath) } catch (e) { process.stderr.write(`flatc: cannot read: ${(e as Error).message}\n`); return 1 }
  const outPath = out ? resolve(out) : join(dirname(filePath), basename(filePath, extname(filePath)) + '.png')
  try {
    const { renderDocToPng } = await import('./render')
    const png = await renderDocToPng(doc, { frame, vars: Object.keys(vars).length ? vars : undefined, scale, steps: steps || undefined })
    writeFileSync(outPath, png)
  } catch (e) { process.stderr.write(`flatc: render failed: ${(e as Error).message}\n`); return 1 }
  process.stdout.write(`flatc: ${basename(outPath)} ✓  ${doc.width}×${doc.height} ×${scale}${frame ? ` · frame ${frame}` : ''}${steps ? ` · ${steps} step(s)` : ''}${Object.keys(vars).length ? ` · ${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}\n`)
  return 0
}

export function run(argv: string[]): number | Promise<number> {
  const args = argv.slice(2)
  let out = '', scriptPath = ''
  let checkOnly = false, doWatch = false, doPlay = false, doRender = false, doTrace = false
  let frame = 0, scale = 2, steps = 0
  let assetMode: AssetMode = 'inline'
  const vars: Record<string, number> = {}
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-o' || a === '--out') out = args[++i] ?? ''
    else if (a === '--script') scriptPath = resolve(args[++i] ?? '')
    else if (a === '--assets') assetMode = args[++i] === 'external' ? 'external' : 'inline'
    else if (a === '--check') checkOnly = true
    else if (a === '--watch') doWatch = true
    else if (a === '--play') doPlay = true
    else if (a === '--trace') doTrace = true
    else if (a === '--render') doRender = true
    else if (a === '--frame') frame = Number(args[++i] ?? '0') || 0
    else if (a === '--steps') steps = Math.max(0, Number(args[++i] ?? '0') || 0)
    else if (a === '--scale') scale = Number(args[++i] ?? '2') || 2
    else if (a === '--at') parseVars(args[++i] ?? '', vars)
    else if (a === '-h' || a === '--help') { printHelp(); return 0 }
    else positional.push(a)
  }
  if (!positional.length) { printHelp(); return 1 }

  const filePath = resolve(positional[0])
  if (!existsSync(filePath)) { process.stderr.write(`flatc: not found: ${filePath}\n`); return 1 }

  const explicitFlats = positional.slice(1)
  if (doRender) return renderOnce(filePath, out, frame, vars, scale, steps)
  if (doPlay) return playOnce(filePath, scriptPath, doTrace)
  if (doWatch) {
    const code = compileOnce(filePath, explicitFlats, out, checkOnly, assetMode)
    const baseDir = dirname(filePath)
    let timer: ReturnType<typeof setTimeout> | undefined
    // We ignore changes to the OUTPUT (.flatpack) — otherwise writing it would re-trigger the compile in a loop.
    watch(baseDir, { recursive: false }, (_e, filename) => {
      if (filename && (filename.endsWith('.flatpack') || filename.endsWith('.flatpack.json'))) return
      clearTimeout(timer); timer = setTimeout(() => compileOnce(filePath, explicitFlats, out, checkOnly, assetMode), 80)
    })
    process.stdout.write(`flatc: watching ${baseDir} … (Ctrl+C to stop)\n`)
    return code
  }
  return compileOnce(filePath, explicitFlats, out, checkOnly, assetMode)
}
