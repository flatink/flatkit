// @flatkit/compiler/analysis — static-analysis & program-tooling entry point.
//
// Curated public surface for tools (editors, linters) that inspect a program WITHOUT compiling it:
// lint a `.flatink` source or a whole Doc, build the per-scope "logic map", and split/join the
// per-object behavior blocks. Pure (no canvas, no CLI).
export * from './lint'
export * from './programDoc'
export * from './scopeProgram'
