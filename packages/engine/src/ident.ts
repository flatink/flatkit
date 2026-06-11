// ─────────────────────────────────────────────────────────────────────────────
//  ident.ts — DSL identifiers.
//
//  An object/variable name can only be referenced in code if it is an IDENTIFIER:
//  `Hero.x`, `object "Hero"`, `score = …` — the expression tokenizer (expr.ts) only recognizes
//  `[A-Za-z_]\w*`. Names with spaces / parentheses / dots ("Brick 0") cannot be typed.
//  This module (pure, no dependency) is used to validate (lint/autocomplete) and to sanitize on input
//  in the editor (spaces & forbidden characters → "_").
// ─────────────────────────────────────────────────────────────────────────────

import { STD_CONSTANTS, STD_FUNCTIONS, STD_IDS, STD_OBJECTS } from './expr'

const IDENT = /^[A-Za-z_]\w*$/

// Reserved words: cannot be used as an object/variable name (collision in an expression or while
// parsing). = expression built-ins (mouse, self, time, PI, sin, between…) + DSL keywords.
const KEYWORDS = [
  'when', 'every', 'at', 'label', 'loaded', 'clicked', 'hovered', 'unhovered', 'pressed', 'dragged', 'released', 'held',
  'let', 'var', 'set', 'fn', 'use', 'each', 'as', 'from', 'to', 'if', 'else', 'repeat', 'times', 'go', 'and',
  'play', 'pause', 'send', 'sound', 'fill', 'object', 'scene', 'true', 'false',
  'drag', 'dragX', 'dragY', 'dropped', 'on', 'confine', 'snap', 'over', // interactors
]
/** Reserved words (cannot name an object/variable). */
export const RESERVED: ReadonlySet<string> = new Set([...STD_CONSTANTS, ...STD_FUNCTIONS, ...STD_IDS, ...STD_OBJECTS, ...KEYWORDS])

/** Is the name a valid DSL identifier (referenceable as-is)? */
export const isIdentifier = (s: string): boolean => IDENT.test(s)

/** Is the name a reserved word (collision with a built-in or keyword)? */
export const isReserved = (s: string): boolean => RESERVED.has(s)

/**
 * Sanitize a name into a SAFE identifier: every forbidden character (spaces, parentheses, brackets, dots,
 * quotes, operators…) → "_"; never a leading digit; a reserved word is suffixed with "_" (`self` →
 * `self_`, `if` → `if_`). `fallback` if nothing usable remains.
 */
export function toIdentifier(raw: string, fallback = 'X'): string {
  let s = raw.trim().replace(/\W+/g, '_') // \W = anything but [A-Za-z0-9_]
  if (!s || /^_+$/.test(s)) return fallback
  if (/^\d/.test(s)) s = `_${s}`
  return RESERVED.has(s) ? `${s}_` : s
}
