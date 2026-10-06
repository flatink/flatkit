// Offsets → lines of a source, without re-counting the lines before each offset. Locating N diagnostics by
// `src.slice(0, at).split('\n').length` was quadratic: 20k located warnings on a 476 KB program took 8.6 s.

let lastSrc: string | undefined
let lastAt: ((offset: number) => number) | undefined

/** `offset → 1-based line` for `src`: the line starts are listed once (kept for the last source asked),
 *  each lookup is a binary search. */
export function lineIndex(src: string): (offset: number) => number {
  if (src === lastSrc && lastAt) return lastAt
  const starts = [0]
  for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) starts.push(i + 1)
  const at = (offset: number): number => {
    let lo = 0, hi = starts.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= offset) lo = mid; else hi = mid - 1 }
    return lo + 1
  }
  lastSrc = src; lastAt = at
  return at
}

let declSrc: string | undefined
let decl: { vars: Map<string, number>; fns: Map<string, number> } | undefined

/** The line of each `var` / `let` / `fn` declaration of a source, by name (first one wins): one pass. */
export function declarationLines(src: string): { vars: Map<string, number>; fns: Map<string, number> } {
  if (src === declSrc && decl) return decl
  const at = lineIndex(src)
  const vars = new Map<string, number>(), fns = new Map<string, number>()
  for (const m of src.matchAll(/^[ \t]*(var|let|fn)[ \t]+([\w.]+)/gm)) {
    const into = m[1] === 'fn' ? fns : vars
    if (!into.has(m[2]!)) into.set(m[2]!, at(m.index))
  }
  declSrc = src; decl = { vars, fns }
  return decl
}
