// @flatkit/compiler -- the FlatInk language and compiler.
//
// Parses FlatInk Script (the .flatink DSL) and compiles a program plus its assets into a .flatpack:
// a playable `Doc` (JSON, with the material already baked). Also ships the `flatc` CLI (`run`).
//
// The language layer (DSL parser/printer, .flat format) lives in @flatkit/engine and is re-exported
// here so the compiler package is a single coherent entry point.

// --- Compile a program (+ assets) into a playable .flatpack Doc ---------------
export { compileFlatpack, packToJSON, type MediaMap } from './compile'

// --- Static analysis: lint a program / a whole Doc ----------------------------
export { lint, lintReport, localVariables, type LintContext } from './lint'
export {
  lintDoc, lintDocReport, docHasErrors, docLintContext, allScopeVariables,
  scopeProgram, docStructureWarnings, docLayoutWarnings,
} from './programDoc'

// --- Manifest / LLM context for a Doc -----------------------------------------
export { manifestObjects, docToManifest, llmContext, type ManifestObject } from './manifest'

// --- The language reference card ----------------------------------------------
export { languageCard } from './languageCard'

// --- Scope-program helpers (split/join the per-object behavior blocks) ---------
export { splitScopeProgram, scopeRegions, formatObjectBlock, joinScopeProgram } from './scopeProgram'

// --- The flatc CLI entry point (also wired as the `flatc` bin) -----------------
export { run } from './cli/flatc'

// --- The language layer, re-exported from the engine for convenience ----------
export { parseUnits, printUnits } from '@flatkit/engine/dsl'
export {
  parseProgram, printProgram, parseProgramFull, printProgramFull,
  parseFlat, parseFlatLib, exportFlatProject,
} from '@flatkit/engine/flatFormat'
