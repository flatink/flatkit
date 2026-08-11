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
import { parseProgramFull, parseFlatLib } from '@flatkit/engine/flatFormat'
import { hasPackage } from '@flatkit/engine/stdlib'
import { parseUnits } from '@flatkit/engine/dsl'
import { sanitizeDoc } from '@flatkit/engine/validateDoc'
import { unitsToFunctions } from '@flatkit/engine/scriptDoc'
import { containerBBox, containerBBoxUnion } from '@flatkit/engine/groups'
import { isInstance, isGroup } from '@flatkit/engine/layers'
import { IDENTITY } from '@flatkit/engine/transform'
import { lintDocReport, docHasErrors } from '../programDoc'
import { applyFixes, formatDiagnostics, programDiagnostics, repairLoop } from '../check'
import { FlatSyntaxError } from '@flatkit/engine/flatFormat'
import { playHeadless, type Gesture } from '@flatkit/player/debug'
import type { FuncDef } from '@flatkit/engine/actions'
import type { Doc, Instance, Item, Layer, SymbolDef } from '@flatkit/types'

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
  flatc --preview <library.flat> [--symbol NAME] [-o out.flatpack | --render -o out.png]
  flatc <library.flat> [more.flat …] --check

  program.flatink   the program (composition + logic, text DSL)
  assets.flat       visual asset libs (default: every .flat in the program's folder)
  -o, --out         output file (default: <program>.flatpack — the CANONICAL name, JSON inside)
  --assets MODE     media baking: 'inline' (default, base64 in the .flatpack) or 'external'
                    (sidecar <out>.assets/ folder; asset.data = relative key — serve the folder and
                    play with sameOriginAssetResolver(<flatpackUrl>))
  --check           semantic lint only (no .flatpack); exits ≠0 on ERROR (warnings do not stop). Lints a
                    program .flatink OR an asset library .flat (per-symbol; several .flat are merged)
  --fix             apply the MECHANICAL repairs the diagnostics carry (missing separator, run-on line)
                    and re-check, iterating. Writes the file AT MOST ONCE, and never a text it has not
                    re-checked; a file it cannot repair is left untouched, mtime included. Implies --check.
  --no-libs         do NOT auto-discover the .flat files sitting next to the program (use it in a working
                    folder, where a neighbouring scratch file is not a dependency)
  --watch           recompile on every change in the folder (agent → player loop)
  --play            run the file WITHOUT a canvas, replay --script and print { sends, vars } (JSON)
  --trace           (with --play) HUMAN-READABLE log per gesture: emitted sends + variable diff (debug)
  --script <f>      JSON gesture script: [{ "type": "down|move|up|cancel", "x", "y" }, { "type": "set", "name", "value" }, { "type": "wait", "frames": N }, { "type": "wheel", "dy": N }]
                    semantic (by NAME, the engine resolves coords): { "type": "drag", "source", "target" } · { "type": "tap", "target" }
                    · { "type": "scratch", "target" } (sweeps a reveal zone) · { "type": "connect", "source", "target" } (pulls a link wire)
                    { "type": "key", "name": "ArrowRight", "frames": N } holds a key (keys.<name> = 1) N steps, then releases it
                    "wait" lets the simulation run N fixed steps (60 Hz): "every frame" + playhead advance like in real playback
                    "expect" self-verifies: { "type": "expect", "sends": ["done"], "vars": { "score": 3 } } → exits ≠0 on mismatch
                    (sends = sequence of names emitted SINCE the last expect; vars = current state). Great in CI.
  --render          render a PNG IMAGE (headless skia): see what we draw (positioning)
  --preview         wrap ONE symbol of a <library.flat> into a playable Doc (a single centered instance on an
                    auto-sized stage) → a .flatpack to drop in the browser player, or a PNG with --render.
                    No wrapper .flatink to author by hand. Output defaults to <library>.<symbol>.flatpack/.png
  --symbol NAME     (with --preview) which symbol to wrap (default: the first in the lib)
  --bbox all|frame0 (with --preview) auto-size to the UNION over all frames (default 'all', no clipping of
                    drifting/rotating/growing motion) or just frame 0 ('frame0', the old behavior)
  --pad N           (with --preview) padding in px around the symbol's bounds (default 24)
  --set p=v[,p2=v2] set a SYMBOL's exposed params (works with --preview AND --render); a state param
                    takes a state NAME
                    or a number (e.g. --set door=open), others take a number → baked into the preview
  --frame N         (with --render) target frame (default 0)
  --at k=v[,k2=v2]  (with --render) force variables → capture a given state (e.g. a step of an escape)
  --steps N         (with --render) run N fixed sim steps (60 Hz, every-frame) BEFORE capture → see a
                    stateful act unfold without forcing every derived variable by hand in --at
  --scale S|auto    (with --render) resolution factor (default 2); 'auto' picks one from the canvas size
                    (enlarges small/thin assets so fine filaments stay legible, large assets stay 1x)
  -h, --help        this help

Media referenced by 'asset "id" "path" kind' are embedded (paths relative to the program).
`)
}

/** How media is baked: `inline` = base64 data-URI in the .flatpack; `external` = relative key + sidecar files. */
type AssetMode = 'inline' | 'external'
type MediaCopy = { src: string; key: string } // external mode: source file → relative key (forward slashes)
type BuildResult = { doc: Doc; flatLibs: number; packages: number; media: number; mediaCopies: MediaCopy[]; src: string }

/**
 * Reads a `.flatink`, resolves libs/packages/media, compiles → standalone Doc. Throws on compile error.
 * `assetMode`: `inline` embeds each media as a base64 data-URI (default); `external` keeps `asset.data` as a
 * relative key (`<assetsDir>/<path>`) and returns the files to copy beside the .flatpack (no base64 bloat).
 */
function buildDocFromProgram(programPath: string, explicitFlats: string[] = [], assetMode: AssetMode = 'inline', assetsDir = '', noLibs = false, srcOverride?: string): BuildResult {
  const baseDir = dirname(programPath)
  // `srcOverride` compiles a CANDIDATE text as if it were the file, without writing it. `--fix` needs it:
  // it must re-check each repair before committing anything, and writing-then-reverting leaves a window
  // where the author's file holds a version we already know we do not want.
  const programSrc = srcOverride ?? readFileSync(programPath, 'utf8')
  const prog = parseProgramFull(programSrc)

  // .flat libs: explicit if provided, otherwise auto-discover the .flat files in the program's folder
  // (`--no-libs` opts out — in a working folder, a neighbouring scratch file is not a dependency).
  const flatPaths = new Set<string>(explicitFlats.map((p) => resolve(p)))
  if (!flatPaths.size && !noLibs) for (const f of readdirSync(baseDir).filter((f) => f.endsWith('.flat'))) flatPaths.add(join(baseDir, f))

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
  // Parse each lib HERE so a failure names the FILE. Libs are auto-discovered from the folder, so the one
  // that fails is often a neighbour the author never mentioned — a bare "compile error: …" sent them hunting
  // through their own program for a fault that was never in it.
  const assetSrcs = [...flatPaths].map((p) => {
    const src = readFileSync(p, 'utf8')
    try { parseFlatLib(src) } catch (e) { throw new Error(`${basename(p)}: ${(e as Error).message} (pass --no-libs to ignore the .flat files sitting next to the program)`, { cause: e }) }
    if (programConstructsIn(src).length) process.stderr.write(`flatc: ${basename(p)}: looks like a PROGRAM saved as .flat — loaded as a symbol library, so its scene/object blocks are ignored. Rename it to .flatink, or pass --no-libs.\n`)
    return src
  })

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
  // The source travels with the Doc: the source-level passes (`programDiagnostics`) need the author's text,
  // since a parse-level drop and an `object` block binding to nothing leave no trace in the compiled Doc.
  return { doc, flatLibs: flatPaths.size, packages: localResolved.size, media: Object.keys(media).length, mediaCopies, src: programSrc }
}

/** Compile once (write or --check). Returns the exit code. */
function compileOnce(programPath: string, explicitFlats: string[], out: string, checkOnly: boolean, assetMode: AssetMode = 'inline', noLibs = false, doFix = false): number {
  const outPath = out ? resolve(out) : join(dirname(programPath), basename(programPath, extname(programPath)) + '.flatpack')
  // External mode: sidecar folder next to the .flatpack, e.g. `game.flatpack` → `game.assets/`.
  const assetsDir = assetMode === 'external' ? basename(outPath, extname(outPath)) + '.assets' : ''
  const build = (src?: string) => buildDocFromProgram(programPath, explicitFlats, assetMode, assetsDir, noLibs, src)
  // `--fix` on a source the parser REJECTS. That case never reaches the diagnostics pass below, and it is
  // exactly where a mechanical repair earns its keep: there is no partial result to work from. Repaired
  // IN MEMORY, one syntax error per turn, so the whole of `--fix` still writes the file at most once.
  let parseRepaired = ''
  if (doFix) {
    let candidate = readFileSync(programPath, 'utf8')
    for (let pass = 0; pass < 10; pass++) {
      try { build(candidate); break } catch (e) {
        if (!(e instanceof FlatSyntaxError) || !e.fix) break
        const { text, applied } = applyFixes(candidate, [{ scope: 'scene', line: e.line, col: e.col, severity: 'error', message: e.message, fix: e.fix }])
        if (!applied) break
        candidate = text
        parseRepaired = candidate
        process.stderr.write(`flatc: --fix: repaired \`${e.message.split(':')[0]}\` in ${basename(programPath)}\n`)
      }
    }
  }
  let built: BuildResult
  try { built = build(parseRepaired || undefined) }
  catch (e) {
    process.stderr.write(`flatc: compile error: ${(e as Error).message}\n`)
    return 1
  }
  const { doc } = built
  // The SAME pass the `checkProgram` API runs — source-level diagnostics (statements the parser dropped,
  // `object` blocks binding to nothing) merged with the semantic lint of the Doc. Shared on purpose: a
  // check that lives only in the CLI is a check an integrator has to shell out for.
  const diagnostics = programDiagnostics(doc, built.src)
  const report = formatDiagnostics(diagnostics)
  const hasErrors = diagnostics.some((d) => d.severity === 'error')
  // `--fix` applies the MECHANICAL repairs the diagnostics carry (a missing separator, a run-on line),
  // then re-checks. Two rules make it safe to run unattended:
  //   • it ITERATES, because repairing one error unmasks the next — a run-on interactor line swallows the
  //     statements under it, and their own diagnostics only appear once it is split;
  //   • it writes only if the error count strictly DROPS at each pass. An auto-fix that makes things worse
  //     must not survive, and the honest way to know is to run the same check again on the result.
  if (doFix) {
    // START from the text the diagnostics were computed on. Falling back to the file would apply edits
    // whose line/col were measured against the parse-repaired text -- a comma insertion survives that,
    // a multi-line replacement does not.
    const original = parseRepaired || readFileSync(programPath, 'utf8')
    const { text, applied: total, first, errors: before } = repairLoop(original, diagnostics, (src) =>
      programDiagnostics(buildDocFromProgram(programPath, explicitFlats, assetMode, assetsDir, noLibs, src).doc, src))
    if (!total && !parseRepaired) {
      // NOT even a rewrite of the identical bytes: a new mtime wakes every watcher pointed at the folder,
      // and a write fails outright on a read-only checkout we had no reason to touch.
      process.stderr.write(`flatc: --fix: nothing to repair mechanically${hasErrors ? ' — the remaining errors need a decision, not a separator\n' : '\n'}`)
    } else {
      writeFileSync(programPath, text) // ONE write, of a text this loop has already re-checked
      process.stderr.write(`flatc: --fix: ${total} repair(s) applied to ${basename(programPath)} · errors ${first} → ${before}\n`)
      return compileOnce(programPath, explicitFlats, out, checkOnly, assetMode, noLibs, false)
    }
  }
  if (checkOnly) {
    if (report) process.stderr.write(report + '\n')
    if (hasErrors) return 1
    // Success line deliberately avoids the word "error" (the report on a FAILURE already prints "error" to
    // stderr + exits ≠0) so a `grep error` over the output can't false-positive — the real signal is the exit
    // code; on success, only warnings remain (non-blocking), surfaced as a count.
    const warnings = diagnostics.length
    process.stdout.write(`flatc: check passed ✓${warnings ? ` · ${warnings} warning(s)` : ''}\n`)
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

/** PROGRAM-only constructs found in what is supposed to be a `.flat` symbol library. `parseFlatLib` reads a
 *  `.flat` as a bag of symbols and silently ignores everything else, so a whole program saved under the wrong
 *  extension parsed to "0 symbol(s)" and passed `--check` with nothing verified — the worst possible answer
 *  for tooling, since a check written against the wrong extension ALWAYS passes and looks like a safety net.
 *  Both constructs are anchored at line start: only a real block matches, not a mention inside a string. */
function programConstructsIn(src: string): string[] {
  const found: string[] = []
  if (/^[ \t]*scene\s*\{/m.test(src)) found.push('a `scene { … }` block')
  if (/^[ \t]*object\s+"/m.test(src)) found.push('`object "…" { … }` blocks')
  return found
}

/**
 * `--check` for a `.flat` asset LIBRARY (one or several): parse via `parseFlatLib` (NOT the program parser,
 * which would choke on `symbol`/`params`/`layer`), merge the symbols into an empty-scene Doc, and run the SAME
 * Doc lint as a program -> per-symbol diagnostics (`[<Symbol>] line:col: …`). Reuses `lintDocReport`/
 * `docHasErrors`, so every existing check (params-in-expr, undeclared color param in a paint, unknown
 * functions/objects…) applies for free, with the same `[scope] line:col: level: msg` format and exit code.
 * No `behaviorDiagnostics` (those are scene-level — a pure lib has no scene).
 */
function checkFlatLibs(flatPaths: string[]): number {
  const symbols: SymbolDef[] = []
  for (const p of flatPaths) {
    let src: string
    try { src = readFileSync(p, 'utf8') } catch (e) { process.stderr.write(`flatc: cannot read: ${(e as Error).message}\n`); return 1 }
    const disguised = programConstructsIn(src)
    if (disguised.length) { // a PROGRAM saved as `.flat` — see programConstructsIn
      process.stderr.write(`flatc: ${basename(p)}: this is a PROGRAM, not a symbol library — it contains ${disguised.join(' and ')}, which a .flat never carries and which --check therefore does NOT verify. Rename it to .flatink.\n`)
      return 1
    }
    try { symbols.push(...parseFlatLib(src).symbols) } // ids are uid-unique across calls -> safe to merge libs
    catch (e) { process.stderr.write(`flatc: ${basename(p)}: ${(e as Error).message}\n`); return 1 } // a malformed lib -> a clean parse error (not "[scene] …")
  }
  const doc: Doc = { width: 1, height: 1, timeline: { fps: 24, durationFrames: 1, tracks: [] }, variables: {}, layers: [], symbols }
  const report = lintDocReport(doc) // scene scope is empty -> only per-symbol diagnostics
  if (report) process.stderr.write(report + '\n')
  if (docHasErrors(doc)) return 1
  // "check passed", NOT "no errors" — the word "error" must not appear on success (a `grep error` trap); the
  // exit code is the signal, and any remaining lines are warnings (non-blocking), reported as a count.
  const warnings = report ? report.split('\n').filter(Boolean).length : 0
  process.stdout.write(`flatc: check passed ✓  ${symbols.length} symbol(s)${warnings ? ` · ${warnings} warning(s)` : ''}\n`)
  return 0
}

/** Loads a Doc from a `.flatink` (compiled) or a `.flatpack`/`.flatpack.json` (already-baked JSON). */
function loadDoc(filePath: string, noLibs = false): Doc {
  if (filePath.endsWith('.flatink')) return buildDocFromProgram(filePath, [], 'inline', '', noLibs).doc
  // .flatpack (canonical) or .flatpack.json (alias): untrusted JSON → normalize before use.
  return sanitizeDoc(JSON.parse(readFileSync(filePath, 'utf8')))
}

/** --play: runs the file headless, replays --script, prints { sends, vars }. */
function playOnce(filePath: string, scriptPath: string, trace: boolean, noLibs = false): number {
  if (!scriptPath) { process.stderr.write('flatc: --play requires --script <gestures.json>\n'); return 1 }
  if (!existsSync(scriptPath)) { process.stderr.write(`flatc: script not found: ${scriptPath}\n`); return 1 }
  let doc: Doc, gestures: Gesture[]
  try { doc = loadDoc(filePath, noLibs) } catch (e) { process.stderr.write(`flatc: cannot read: ${(e as Error).message}\n`); return 1 }
  try { gestures = JSON.parse(readFileSync(scriptPath, 'utf8')) as Gesture[] } catch (e) { process.stderr.write(`flatc: invalid JSON script: ${(e as Error).message}\n`); return 1 }
  if (!Array.isArray(gestures)) { process.stderr.write('flatc: the script must be an array of gestures\n'); return 1 }
  const res = playHeadless(doc, gestures, { trace })
  if (!trace) process.stdout.write(JSON.stringify(res, null, 2) + '\n')
  else // --trace: readable log (one gesture per line) → inspection / debug-player.
    for (const s of res.steps ?? []) {
      // `name` · `name=value` · `name{a=1, b=2}` (record payload) — the three shapes the host receives.
      const send = (e: { name: string; value?: number | string; fields?: Record<string, number> }): string =>
        e.fields ? `${e.name}{${Object.entries(e.fields).map(([k, v]) => `${k}=${v}`).join(', ')}}`
          : e.value !== undefined ? `${e.name}=${e.value}` : e.name
      const sends = s.sends.length ? '  sends:[' + s.sends.map(send).join(', ') + ']' : ''
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

/** `--scale auto`: pick a resolution factor from the canvas size — enlarge small/thin content (so fine
 *  filaments stay legible) while leaving large content at 1×. `max(160/long, 48/short)`, clamped [1, 8]. */
function autoScale(w: number, h: number): number {
  const maxSide = Math.max(1, w, h), minSide = Math.max(1, Math.min(w, h))
  return Math.max(1, Math.min(8, Math.round(Math.max(160 / maxSide, 48 / minSide))))
}

/** Renders a Doc to a PNG file (headless skia). Async (SVG decode + raster). Shared by --render and --preview. */
async function renderDocToFile(doc: Doc, outPath: string, frame: number, vars: Record<string, number>, scale: number, steps: number, params: Record<string, string> = {}): Promise<number> {
  try {
    const { renderDocToPng } = await import('./render')
    const png = await renderDocToPng(doc, { frame, vars: Object.keys(vars).length ? vars : undefined, scale, steps: steps || undefined, params: Object.keys(params).length ? params : undefined })
    writeFileSync(outPath, png)
  } catch (e) {
    process.stderr.write(`flatc: render failed: ${(e as Error).message}\n`)
    if (process.env.FLATC_DEBUG && (e as Error).stack) process.stderr.write(`${(e as Error).stack}\n`) // FLATC_DEBUG=1 → full stack for diagnosis
    return 1
  }
  process.stdout.write(`flatc: ${basename(outPath)} ✓  ${doc.width}×${doc.height} ×${scale}${frame ? ` · frame ${frame}` : ''}${steps ? ` · ${steps} step(s)` : ''}${Object.keys(vars).length ? ` · ${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}\n`)
  return 0
}

/** --render: renders the file to PNG (headless skia). Async (SVG decode + raster). */
async function renderOnce(filePath: string, out: string, frame: number, vars: Record<string, number>, scale: number, steps: number, scaleAuto: boolean, noLibs = false, params: Record<string, string> = {}): Promise<number> {
  let doc: Doc
  // `--no-libs` was parsed and then not passed on, so `--render` still auto-discovered the neighbouring
  // .flat files -- and failed on one, advising the very flag that had been given. Same hole in `--play`.
  try { doc = loadDoc(filePath, noLibs) } catch (e) { process.stderr.write(`flatc: cannot read: ${(e as Error).message}\n`); return 1 }
  // A frame past the end WRAPS silently, so a render can show frame 20 while the caller asked for 200
  // and reads the result as a renderer bug. It cost exactly that once.
  const dur = doc.timeline?.durationFrames ?? 0
  if (dur > 0 && frame >= dur) process.stderr.write(`flatc: --frame ${frame} is past the timeline (durationFrames ${dur}); the playhead WRAPS, so this renders frame ${frame % dur}\n`)
  const outPath = out ? resolve(out) : join(dirname(filePath), basename(filePath, extname(filePath)) + '.png')
  return renderDocToFile(doc, outPath, frame, vars, scaleAuto ? autoScale(doc.width, doc.height) : scale, steps, params)
}

const gcd = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t } return a || 1 }
const lcm = (a: number, b: number): number => Math.max(1, Math.round((a / gcd(a, b)) * b))

/** Every instance in a symbol's subtree (descends into local groups; does NOT cross into other symbols). */
function* instancesOf(sym: SymbolDef): Generator<Instance> {
  const stack: Item[] = []
  for (const l of sym.layers) stack.push(...l.items)
  for (let it = stack.pop(); it; it = stack.pop()) {
    if (isInstance(it)) yield it
    else if (isGroup(it)) for (const l of it.layers) stack.push(...l.items)
  }
}

/**
 * Preview window length (frames). A `synced` instance loops on the PARENT's frame, so the symbol's own
 * duration suffices — that's the historical behavior, kept for every symbol with no MovieClip descendant.
 * But an `independent` (`loop`) descendant runs on its OWN duration, immune to the parent's wrap: to SHOW it
 * loop CLEANLY the window must be a common multiple of every such clip's duration (and the root's) — its
 * "loop seam". `once` clips only need the window to REACH their last frame (they hold afterwards). We walk
 * the subtree, fold each independent clip's duration into the seam (LCM), and extend past the longest clip,
 * keeping the window a whole number of seams. Capped, so coprime durations can't blow the window up.
 */
function previewDuration(root: SymbolDef, symbols: SymbolDef[]): number {
  const byId = new Map(symbols.map((s) => [s.id, s]))
  const seen = new Set<string>()
  let seam = Math.max(1, root.timeline?.durationFrames ?? 1) // clean-loop period (multiple of every loop clip)
  let longest = seam                                          // window must reach the last frame of any clip
  const walk = (sym: SymbolDef | undefined): void => {
    if (!sym || seen.has(sym.id)) return
    seen.add(sym.id)
    for (const it of instancesOf(sym)) {
      const child = byId.get(it.symbolId)
      const cdur = Math.max(1, child?.timeline?.durationFrames ?? 1)
      const mode = it.playback?.mode
      if (mode === 'independent') { seam = lcm(seam, cdur); longest = Math.max(longest, cdur) }
      else if (mode === 'once') longest = Math.max(longest, cdur)
      walk(child)
    }
  }
  walk(root)
  let dur = seam
  while (dur < longest) dur += seam // keep a clean loop seam while covering the longest MovieClip
  return Math.min(dur, 6000) // hard cap (~4 min @24fps) against a pathological coprime-duration blow-up
}

/**
 * Wraps ONE symbol from a `.flat` library into a minimal, playable Doc: a single centered instance on a
 * canvas auto-sized to the symbol's frame-0 bounds (+ padding). Lets you preview a library asset without
 * hand-authoring a wrapper `.flatink`. The root timeline borrows the symbol's own fps and a duration long
 * enough to show every nested MovieClip (`loop`/`once`) loop cleanly (`previewDuration`). Throws if the lib
 * is empty or the named symbol is missing.
 */
function buildPreviewDoc(flatPath: string, symbolName: string, pad: number, bboxMode: 'all' | 'frame0', setSpec: Record<string, string> = {}): { doc: Doc; symbol: SymbolDef; others: string[] } {
  const { symbols } = parseFlatLib(readFileSync(flatPath, 'utf8'))
  if (!symbols.length) throw new Error('no symbols found in this .flat library')
  let symbol = symbols[0]
  if (symbolName) {
    const found = symbols.find((s) => s.name === symbolName)
    if (!found) throw new Error(`symbol "${symbolName}" not found — available: ${symbols.map((s) => s.name).join(', ')}`)
    symbol = found
  }

  const instance: Instance = { id: 'preview_instance', kind: 'instance', name: symbol.name, transform: { ...IDENTITY }, symbolId: symbol.id }
  const layer: Layer = { id: 'preview_layer', name: 'preview', visible: true, locked: false, opacity: 1, items: [instance] }
  const tl = symbol.timeline
  const dur = previewDuration(symbol, symbols)
  const timeline = { fps: tl?.fps ?? 24, durationFrames: dur, tracks: [] }
  // ALL symbols stay in the library (the chosen one may instance the others) — only `instance` is on stage.
  let doc: Doc = { width: 1, height: 1, layers: [layer], symbols, timeline }

  // Auto-size & center. Default `--bbox all`: UNION over every frame of the symbol (sub-timelines NOT
  // frozen) so motion that drifts/rotates/grows is never clipped. `--bbox frame0` keeps the old frame-0
  // measure (+`--pad` to absorb motion).
  // Sample at most ~240 evenly-spaced frames (+ the last) so a long/abusive `durationFrames` can't blow
  // up memory/time; a sparse union is virtually as tight as every-frame for real motion.
  const sampleFrames = (n: number): number[] => {
    const step = Math.max(1, Math.ceil(n / 240))
    const fs: number[] = []
    for (let f = 0; f < n; f += step) fs.push(f)
    if (fs[fs.length - 1] !== n - 1) fs.push(n - 1)
    return fs
  }
  const bb = bboxMode === 'all' ? containerBBoxUnion(doc, instance, sampleFrames(dur)) : containerBBox(doc, instance, 0)
  if (bb) {
    doc = { ...doc, width: Math.max(1, Math.ceil(bb.maxX - bb.minX) + pad * 2), height: Math.max(1, Math.ceil(bb.maxY - bb.minY) + pad * 2) }
    instance.transform = { ...IDENTITY, e: pad - bb.minX, f: pad - bb.minY }
  } else {
    doc = { ...doc, width: 512, height: 512 } // empty/degenerate symbol: fall back to a fixed centered stage
    instance.transform = { ...IDENTITY, e: 256, f: 256 }
  }

  // `--set param=value`: set the preview instance's exposed params (call-site values, raw literals). The
  // renderer resolves them per the symbol's ParamDef / state machines (color → fill, number/bool → scope,
  // state name → driven frame). A light validation warns on names the symbol does not expose.
  const entries = Object.entries(setSpec)
  if (entries.length) {
    const known = new Set([...(symbol.states ?? []).map((s) => s.param), ...(symbol.params ?? []).map((p) => p.name)])
    for (const [k, v] of entries) {
      if (!known.has(k)) process.stderr.write(`flatc: --set ${k}: "${symbol.name}" exposes no such param (${[...known].join(', ') || 'none'})\n`)
      else (instance.params ??= {})[k] = v
    }
  }
  return { doc, symbol, others: symbols.filter((s) => s !== symbol).map((s) => s.name) }
}

/** --preview: wraps one symbol of a `.flat` into a playable Doc, then writes a .flatpack (default) or a PNG (with --render). */
async function previewOnce(flatPath: string, symbolName: string, out: string, frame: number, vars: Record<string, number>, scale: number, steps: number, doRender: boolean, pad: number, bboxMode: 'all' | 'frame0', setSpec: Record<string, string>, scaleAuto: boolean): Promise<number> {
  let built: { doc: Doc; symbol: SymbolDef; others: string[] }
  try { built = buildPreviewDoc(flatPath, symbolName, pad, bboxMode, setSpec) }
  catch (e) { process.stderr.write(`flatc: ${(e as Error).message}\n`); return 1 }
  const { doc, symbol, others } = built
  const stem = `${basename(flatPath, extname(flatPath))}.${symbol.name}`
  let code: number
  if (doRender) {
    // auto scale from the CONTENT size (minus the padding), so thin filaments still trigger an upscale.
    const sc = scaleAuto ? autoScale(doc.width - 2 * pad, doc.height - 2 * pad) : scale
    code = await renderDocToFile(doc, out ? resolve(out) : join(dirname(flatPath), stem + '.png'), frame, vars, sc, steps)
  } else {
    const outPath = out ? resolve(out) : join(dirname(flatPath), stem + '.flatpack')
    writeFileSync(outPath, packToJSON(doc))
    process.stdout.write(`flatc: ${basename(outPath)} ✓  preview of "${symbol.name}" · ${doc.width}×${doc.height} · play it in the browser player\n`)
    code = 0
  }
  if (!symbolName && others.length) process.stderr.write(`flatc: previewed "${symbol.name}"; other symbols in this lib: ${others.join(', ')} (pick with --symbol <name>)\n`)
  return code
}

export function run(argv: string[]): number | Promise<number> {
  const args = argv.slice(2)
  let out = '', scriptPath = '', symbolName = ''
  let checkOnly = false, doFix = false, doWatch = false, doPlay = false, doRender = false, doTrace = false, doPreview = false, noLibs = false
  let frame = 0, scale = 2, steps = 0, pad = 24
  let scaleAuto = false
  let bboxMode: 'all' | 'frame0' = 'all'
  let assetMode: AssetMode = 'inline'
  const vars: Record<string, number> = {}
  const setSpec: Record<string, string> = {} // `--set param=value` (state name or number) for --preview
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-o' || a === '--out') out = args[++i] ?? ''
    else if (a === '--script') scriptPath = resolve(args[++i] ?? '')
    else if (a === '--assets') assetMode = args[++i] === 'external' ? 'external' : 'inline'
    else if (a === '--check') checkOnly = true
    else if (a === '--fix') { doFix = true; checkOnly = true }
    else if (a === '--no-libs') noLibs = true
    else if (a === '--watch') doWatch = true
    else if (a === '--play') doPlay = true
    else if (a === '--trace') doTrace = true
    else if (a === '--render') doRender = true
    else if (a === '--preview') doPreview = true
    else if (a === '--symbol') symbolName = args[++i] ?? ''
    else if (a === '--pad') pad = Math.max(0, Number(args[++i] ?? '24') || 0)
    else if (a === '--bbox') bboxMode = args[++i] === 'frame0' ? 'frame0' : 'all'
    else if (a === '--frame') frame = Number(args[++i] ?? '0') || 0
    else if (a === '--steps') steps = Math.max(0, Number(args[++i] ?? '0') || 0)
    else if (a === '--scale') { const v = args[++i] ?? '2'; if (v === 'auto') scaleAuto = true; else scale = Number(v) || 2 }
    else if (a === '--at') parseVars(args[++i] ?? '', vars)
    else if (a === '--set') for (const pair of (args[++i] ?? '').split(',')) { const j = pair.indexOf('='); if (j > 0) setSpec[pair.slice(0, j).trim()] = pair.slice(j + 1).trim() }
    else if (a === '-h' || a === '--help') { printHelp(); return 0 }
    else positional.push(a)
  }
  if (!positional.length) { printHelp(); return 1 }

  const filePath = resolve(positional[0])
  if (!existsSync(filePath)) { process.stderr.write(`flatc: not found: ${filePath}\n`); return 1 }

  const explicitFlats = positional.slice(1)
  if (doPreview) return previewOnce(filePath, symbolName, out, frame, vars, scale, steps, doRender, pad, bboxMode, setSpec, scaleAuto)
  if (doRender) return renderOnce(filePath, out, frame, vars, scale, steps, scaleAuto, noLibs, setSpec)
  if (doPlay) return playOnce(filePath, scriptPath, doTrace, noLibs)
  // `--check <library>.flat`: a `.flat` first positional is an asset LIB, not a program → lint via parseFlatLib
  // (the following positionals are more `.flat` libs to merge). Every other path is unchanged.
  const action: () => number = checkOnly && filePath.endsWith('.flat')
    ? () => checkFlatLibs([filePath, ...explicitFlats])
    : () => compileOnce(filePath, explicitFlats, out, checkOnly, assetMode, noLibs, doFix)
  if (doWatch) {
    const code = action()
    const baseDir = dirname(filePath)
    let timer: ReturnType<typeof setTimeout> | undefined
    // We ignore changes to the OUTPUT (.flatpack) — otherwise writing it would re-trigger the compile in a loop.
    watch(baseDir, { recursive: false }, (_e, filename) => {
      if (filename && (filename.endsWith('.flatpack') || filename.endsWith('.flatpack.json'))) return
      clearTimeout(timer); timer = setTimeout(action, 80)
    })
    process.stdout.write(`flatc: watching ${baseDir} … (Ctrl+C to stop)\n`)
    return code
  }
  return action()
}
