// ─────────────────────────────────────────────────────────────────────────────
//  ident.ts — a human label -> a FlatInk identifier.
//
//  A sugar lets an author name things in their own language ("chene", "Vegetaux", "21 janvier 1793"),
//  and those names become identifiers (`var`, `object`). FlatInk identifiers are `[A-Za-z0-9_]`, so an
//  accent does not error -- the lexer stops at it and reads the tail. `chene` written with its accent
//  became `var <accented>X`, read as `neX`: two variables where the author wrote one, and no diagnostic.
//  Transliterate here, once, rather than in every gesture.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A FlatInk identifier derived from a human label: accents folded to ASCII, anything else to `_`, and
 * a leading digit prefixed (an identifier may not start with one). Stable and idempotent, so the same
 * label always yields the same name — the sugar's variables and the author's references must agree.
 */
export function ident(label: string): string {
  const ascii = label.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Za-z0-9_]/g, '_')
  return /^[0-9]/.test(ascii) ? `n${ascii}` : ascii
}

/** `true` if the label survives `ident` unchanged — i.e. it is already a usable identifier. */
export const isIdent = (label: string): boolean => ident(label) === label && label.length > 0
