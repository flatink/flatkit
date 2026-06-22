// ─────────────────────────────────────────────────────────────────────────────
//  lint.ts — linter for the FlatInk Script language (batch L3).
//
//  Builds on the parser (dsl.ts) for syntax errors + positions, then adds
//  SEMANTIC validation, ~free and PURE:
//   • each expression is compiled (compileExpr) → expression syntax error;
//   • referenced functions / member objects / identifiers are checked against
//     the standard environment (expr.ts) + the known variables → "unknown";
//   • `go to "label"` is checked against the set of known labels.
//
//  Tolerant and kid-friendly: a variable is "known" if it is declared
//  (`let`) OR simply assigned (`x = …`) somewhere in the source, or provided
//  by the caller (document global variables). Labels are only checked
//  if the caller provides their list (otherwise we don't know the universe).
// ─────────────────────────────────────────────────────────────────────────────
import { analyzeExpr, STD_CONSTANTS, STD_FUNCTIONS, STD_IDS, STD_OBJECTS } from '@flatkit/engine/expr'
import { packageFunctionNames } from '@flatkit/engine/stdlib'
import { parseUnits, type Diagnostic, type ScriptUnit } from '@flatkit/engine/dsl'
import type { Action } from '@flatkit/engine/actions'

export type LintContext = {
  /** Known variables in addition to those declared/assigned in the source. */
  variables?: Iterable<string>
  /** Known labels (timeline). Absent = we don't check `go to "…"`. */
  labels?: Iterable<string>
  /** Known functions in addition to those defined in the source. */
  functions?: Iterable<string>
  /** Scene objects referenceable by name (`Hero.x`) — in addition to mouse/keys. */
  objects?: Iterable<string>
}

/** Collects the names of ASSIGNED variables (setVar) + loop vars, inside action bodies. */
function collectAssigned(actions: Action[], into: Set<string>): void {
  for (const a of actions) {
    if (a.do === 'setVar') into.add(a.name)
    else if (a.do === 'if') {
      collectAssigned(a.then, into)
      if (a.else) collectAssigned(a.else, into)
    } else if (a.do === 'repeat') collectAssigned(a.body, into)
    else if (a.do === 'repeatRange') { into.add(a.var); collectAssigned(a.body, into) } // i is known in the body
  }
}

/** Locally known variables: `let` declarations + every assigned variable. */
export function localVariables(units: ScriptUnit[]): Set<string> {
  const vars = new Set<string>()
  for (const u of units) {
    if (u.kind === 'declare') vars.add(u.name)
    else if (u.kind === 'event' || u.kind === 'frameActions') collectAssigned(u.body, vars)
    else if (u.kind === 'each') vars.add(u.as) // the index is known in the each bindings
    else if (u.kind === 'interactor') { if (u.varX) vars.add(u.varX); if (u.varY) vars.add(u.varY) } // drag writes these variables
    else if (u.kind === 'drop') collectAssigned(u.body, vars)
    else if (u.kind === 'func') { for (const p of u.func.params) vars.add(p); if (u.func.kind === 'proc') collectAssigned(u.func.body, vars) } // params + assignments
  }
  return vars
}

/** Detects a `text(` call (whole word) in an expression → only allowed in a `send` payload. */
const TEXT_CALL = /\btext\s*\(/

/** A bare assignment (`x =`, `a[i] =`; NOT ==/<=/>=/!=) left inside an expression: the tell-tale of a
 *  SECOND statement crammed onto one line (FlatInk ends a statement at the newline, so it got swallowed). */
const SECOND_ASSIGN = /[\w\]]\s*=(?![=])/

/** Analyze a DSL source and return all diagnostics (syntax + semantic). */
export function lint(src: string, ctx: LintContext = {}): Diagnostic[] {
  const { units, diagnostics, sites } = parseUnits(src)
  const out: Diagnostic[] = [...diagnostics]

  const variables = localVariables(units)
  for (const v of ctx.variables ?? []) variables.add(v)
  const knownIds = new Set<string>([...STD_IDS, ...STD_CONSTANTS, ...variables])
  const knownFns = new Set(STD_FUNCTIONS)
  knownFns.add('velocity') // valid inside a spring/smooth target (resolved by the modifier advance); NOT a stdlib
  for (const u of units) {
    if (u.kind === 'func') knownFns.add(u.func.name) // user-defined functions
    else if (u.kind === 'use') for (const name of packageFunctionNames(u.name)) knownFns.add(name) // package functions (bare + qualified)
  }
  for (const f of ctx.functions ?? []) knownFns.add(f)
  const knownObjs = new Set(STD_OBJECTS)
  for (const o of ctx.objects ?? []) knownObjs.add(o) // scene objects (Hero.x…)
  const labels = ctx.labels ? new Set(ctx.labels) : null

  for (const s of sites) {
    if (s.kind === 'expr') {
      // `text(…)` is valid ONLY as a `send` payload (consumed by the parser, never
      // exposed as an expression site). Seeing it here = out-of-context use → dedicated error.
      if (TEXT_CALL.test(s.text)) {
        out.push({ line: s.line, col: s.col, message: 'text("…") is only allowed as an argument to "send"' })
        continue
      }
      const a = analyzeExpr(s.text)
      if (!a.ok) {
        // #1 footgun: two statements on one line. The 2nd `channel = …` got swallowed into this
        // expression → a cryptic "unexpected character =". Detect the leftover assignment and say so.
        const message = SECOND_ASSIGN.test(s.text)
          ? 'two statements on one line — put each on its own line (FlatInk ends a statement at the newline)'
          : `invalid expression: ${a.error}`
        out.push({ line: s.line, col: s.col, message })
        continue
      }
      for (const fn of a.refs.calls) if (!knownFns.has(fn)) out.push({ line: s.line, col: s.col, message: `unknown function "${fn}"` })
      for (const o of a.refs.members)
        if (!knownObjs.has(o)) out.push({ line: s.line, col: s.col, message: `unknown object "${o}" (expected: ${[...knownObjs].join(', ')})` })
      for (const id of a.refs.ids)
        if (!knownIds.has(id))
          out.push({ line: s.line, col: s.col, message: `unknown variable "${id}"${variables.size ? '' : ' — declare it with "let"'}` })
    } else if (labels && !labels.has(s.name)) {
      out.push({ line: s.line, col: s.col, message: `unknown label "${s.name}"` })
    }
  }

  return out.sort((a, b) => a.line - b.line || a.col - b.col)
}

/**
 * Lint report ready to feed back to a generator (LLM/CLI): `''` = no issue (the code passes),
 * otherwise one `line:col: message` line per diagnostic. Primitive of the "generate → lint →
 * fix" loop: the language fits in few tokens, robustness comes from this feedback, not from context.
 */
export function lintReport(src: string, ctx: LintContext = {}): string {
  return lint(src, ctx).map((d) => `${d.line}:${d.col}: ${d.message}`).join('\n')
}
