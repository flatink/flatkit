// ─────────────────────────────────────────────────────────────────────────────
//  scopeProgram.ts — the "unified file" of a scope (the Scene, or a Symbol).
//
//  Vision: one file = one scope. All the code of a scope fits in ONE text:
//    var …            (global variables, root only)
//    when loaded {}   (lifecycle of the scope's timeline)
//    every frame {}
//    object "name" {}  (one block per scripted object of the scope)
//
//  This is the `.flatink` structure WITHOUT the geometry (which stays visual). This module
//  ONLY deals with the text: splitting the `object` blocks from the rest, and formatting a block.
//  The wiring to the Doc (a single commit) lives in the store, which reuses these functions
//  + scriptDoc/dsl. Pure, no DOM, testable.
// ─────────────────────────────────────────────────────────────────────────────

/** End of the block opened at `open` (index of the matching `}`), ignoring strings and comments. -1 if unclosed. */
function matchBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (c === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; i++ }; continue }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i }
  }
  return -1
}

/** Splits a scope file: the `object "name" { … }` blocks on one side, the REST (var + lifecycle) on the other. */
export function splitScopeProgram(text: string): { rest: string; objects: { name: string; body: string }[] } {
  let rest = ''
  let i = 0
  const objects: { name: string; body: string }[] = []
  while (i < text.length) {
    const m = /object\s+"((?:[^"\\]|\\.)*)"\s*\{/.exec(text.slice(i))
    if (!m) { rest += text.slice(i); break }
    const start = i + m.index
    rest += text.slice(i, start)
    const ob = start + m[0].length - 1 // the opening brace
    const oc = matchBrace(text, ob)
    if (oc < 0) { rest += text.slice(start); break } // unclosed block → left to the rest (diagnostic downstream)
    objects.push({ name: m[1].replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c)), body: text.slice(ob + 1, oc) })
    i = oc + 1
  }
  return { rest, objects }
}

/** LINTABLE regions of a scope file (the "rest" gaps + the `object` bodies), with their
 *  1-based start line in the original text — to lint each piece as pure DSL and
 *  reproject the positions. The `object` keyword and its braces are NOT DSL: we skip them. */
export function scopeRegions(text: string): { body: string; line: number }[] {
  const lineAt = (off: number) => text.slice(0, off).split('\n').length
  const regions: { body: string; line: number }[] = []
  let i = 0
  let restStart = 0
  while (i < text.length) {
    const m = /object\s+"((?:[^"\\]|\\.)*)"\s*\{/.exec(text.slice(i))
    if (!m) break
    const start = i + m.index
    const gap = text.slice(restStart, start)
    if (gap.trim()) regions.push({ body: gap, line: lineAt(restStart) })
    const ob = start + m[0].length - 1
    const oc = matchBrace(text, ob)
    if (oc < 0) break
    regions.push({ body: text.slice(ob + 1, oc), line: lineAt(ob + 1) })
    i = oc + 1
    restStart = i
  }
  const tail = text.slice(restStart)
  if (tail.trim()) regions.push({ body: tail, line: lineAt(restStart) })
  return regions
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
const indent = (body: string) => body.split('\n').map((l) => (l.trim() ? '  ' + l : l)).join('\n')

/** Formats an `object "name" { … }` block (body already in DSL). */
export function formatObjectBlock(name: string, body: string): string {
  const inner = body.trim()
  return `object "${esc(name)}" {\n${inner ? indent(inner) + '\n' : ''}}`
}

/** Assembles a scope file: rest (var + lifecycle) then the object blocks, separated by a blank line. */
export function joinScopeProgram(rest: string, objects: { name: string; body: string }[]): string {
  const parts: string[] = []
  if (rest.trim()) parts.push(rest.trim())
  for (const o of objects) if (o.body.trim()) parts.push(formatObjectBlock(o.name, o.body))
  return parts.length ? parts.join('\n\n') + '\n' : ''
}
