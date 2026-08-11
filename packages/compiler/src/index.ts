// @flatkit/compiler -- the FlatInk language and compiler.
//
// Parses FlatInk Script (the .flatink DSL) and compiles a program plus its assets into a .flatpack:
// a playable `Doc` (JSON, with the material already baked). Also ships the `flatc` CLI, via its `bin` -- NOT from this entry, which stays free of Node builtins.
//
// The language layer (DSL parser/printer, .flat format) lives in @flatkit/engine and is re-exported
// here so the compiler package is a single coherent entry point.

// --- Compile a program (+ assets) into a playable .flatpack Doc ---------------
export { compileFlatpack, packToJSON, type MediaMap } from './compile'

// --- Check a program the way the CLI does (source in, diagnostics out) --------
export { checkProgram, programDiagnostics, formatDiagnostics, applyFixes, repairLoop, type CheckDiagnostic, type CheckOptions, type CheckResult } from './check'
export type { TextEdit } from '@flatkit/engine/dsl'

// --- Static analysis: lint a program / a whole Doc ----------------------------
export { lint, lintReport, localVariables, type LintContext } from './lint'
export {
  lintDoc, lintDocReport, docHasErrors, docLintContext, allScopeVariables,
  scopeProgram, docStructureWarnings, docLayoutWarnings,
} from './programDoc'

// --- Manifest / LLM context for a Doc -----------------------------------------
export { manifestObjects, manifestEvents, docToManifest, llmContext, type ManifestObject } from './manifest'

// --- The reference cards: behavior (languageCard) and composition (drawingCard) -
export { languageCard } from './languageCard'
export { drawingCard } from './drawingCard'

// --- Scope-program helpers (split/join the per-object behavior blocks) ---------
export { splitScopeProgram, scopeRegions, formatObjectBlock, joinScopeProgram } from './scopeProgram'

// --- The flatc CLI entry point (also wired as the `flatc` bin) -----------------
// `run` (the CLI entry) is deliberately NOT re-exported. It lives in a module that imports `fs`/`path` at
// the top, so re-exporting it put Node builtins in the root's chunk graph -- and a browser bundle then
// fails at NAME RESOLUTION (`"extname" is not exported by "__vite-browser-external"`), before tree-shaking
// can drop the unused symbol. The root's job is the pure helpers a service or a browser needs
// (`checkProgram`, `languageCard`, `drawingCard`, `docToManifest`); the CLI's job is the `bin`, which
// imports `./cli/flatc` directly. `scripts/check-pack.mjs` walks the built chunk graph to keep it that way.

// --- The language layer, re-exported from the engine for convenience ----------
export { parseUnits, printUnits } from '@flatkit/engine/dsl'
export {
  parseProgram, printProgram, parseProgramFull, printProgramFull,
  parseFlat, parseFlatLib, exportFlatProject,
} from '@flatkit/engine/flatFormat'
