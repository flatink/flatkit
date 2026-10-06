// The ` — did you mean "…"?` suffix shared by the linter and the Doc passes.

/** The closest of `names` to `word` (edit distance <= 2), as a ` — did you mean "…"?` suffix, or ''. */
export function didYouMean(word: string, names: string[]): string {
  // A suggestion is for a TYPO: a name within two edits. Two names whose lengths differ by more than that
  // cannot be, and a full edit distance between two names of thousands of characters was 22 s of `--check`
  // on a 181 KB program. Nobody types a 64-character name with a typo they need help with.
  if (word.length > 64) return ''
  names = names.filter((n) => n.length <= 64 && Math.abs(n.length - word.length) <= 2)
  const dist = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]; row[0] = i
      for (let j = 1; j <= b.length; j++) { const t = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t }
    }
    return row[b.length]
  }
  const best = names.map((n) => ({ n, d: dist(word, n) })).filter((x) => x.d <= 2).sort((a, b) => a.d - b.d)[0]
  return best ? ` — did you mean "${best.n}"?` : ''
}
