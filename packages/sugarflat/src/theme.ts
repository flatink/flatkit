// ─────────────────────────────────────────────────────────────────────────────
//  theme.ts — where appearance lives, so that gestures do not carry any.
//
//  A gesture emits STRUCTURE and BEHAVIOR: named groups at the coordinates the author gave, their drop
//  boxes, their state, their handlers. It must never decide what any of it LOOKS like — a sugar that
//  ships a look hands every activity built on it the same face, and that has already happened once.
//
//  So appearance is a parameter. `BLANK` draws nothing at all, which is what makes the claim testable
//  rather than aspirational: expand a gesture with `BLANK` and the output must not contain one colour,
//  one font, or one stroke. `GREYBOX` is a deliberately plain default so a freshly written block is
//  playable immediately — it is provisional by design, and swapping it is a single argument.
// ─────────────────────────────────────────────────────────────────────────────

/** What a drawn thing is FOR. Four roles cover every gesture; a theme need not distinguish more. */
export type Role =
  | 'item' // something the learner moves
  | 'target' // where an item belongs
  | 'card' // a panel the learner reads and taps
  | 'chip' // a small tappable value

export type Theme = {
  readonly name: string
  /** Footprint of a role. The gesture uses it for drop boxes; the theme must draw within it. */
  size(role: Role): { w: number; h: number }
  /** Drawing statements for a role, in LOCAL coordinates centred on 0,0. May be empty. */
  draw(role: Role, label: string): string[]
}

/** Every role, in a stable order — for a reference card, or to sweep a theme. */
export const ROLES: Role[] = ['item', 'target', 'card', 'chip']

const SIZES: Record<Role, { w: number; h: number }> = {
  item: { w: 92, h: 92 },
  target: { w: 208, h: 118 },
  card: { w: 180, h: 140 },
  chip: { w: 96, h: 96 },
}

/**
 * Draws nothing. The gesture still emits every group, every box and every handler, so an author (or a
 * skin) supplies the whole appearance — and the test suite uses it to prove the gestures themselves
 * carry no visual opinion.
 */
export const BLANK: Theme = {
  name: 'blank',
  size: (role) => SIZES[role],
  draw: () => [],
}

/** Rounded rectangle path, centred on the origin — the greybox's only shape vocabulary. */
const plate = (w: number, h: number, r: number): string => `rect ${-w / 2} ${-h / 2} ${w} ${h} ${r}`

/**
 * A plain, provisional greybox: readable, anonymous, and meant to be replaced. It exists so `place x {
 * … }` is playable the moment it is written; it is not a design, and anything built for an audience
 * should pass its own theme (or redraw beside the gesture with `raw { … }`).
 */
export const GREYBOX: Theme = {
  name: 'greybox',
  size: (role) => SIZES[role],
  draw(role, label) {
    const { w, h } = SIZES[role]
    const text = (size: number, boxW: number, boxH: number, colour: string, y: number) =>
      `text "${label.replace(/"/g, "'")}" at ${-boxW / 2},${y} font "system-ui, sans-serif" size ${size} align center line 1.2 color ${colour} box ${boxW} ${boxH} wrap`
    switch (role) {
      case 'item':
        return [`circle 0 0 ${w / 2 - 12} fill #e8c46b`, `circle 0 0 ${w / 2 - 12} nofill stroke #b8923f 2`, text(14, w - 8, 20, '#4a3a1e', -9)]
      case 'target':
        return [`${plate(w - 8, h - 8, 14)} fill #2e3a4e`, `${plate(w - 8, h - 8, 14)} nofill stroke #5a6f8a 2 dash 8,6`, text(16, w - 28, 22, '#aeb6c4', -h / 2 + 10)]
      case 'card':
        return [`${plate(w, h, 16)} fill #2b3447`, `${plate(w, h, 16)} nofill stroke #44516a 2`, text(15, w - 20, h - 40, '#d7deea', -h / 2 + 26)]
      case 'chip':
        return [`circle 0 0 ${w / 2 - 8} fill #e8c46b`, `circle 0 0 ${w / 2 - 8} nofill stroke #b8923f 3`, text(22, w - 16, 28, '#4a3a1e', -13)]
    }
  },
}
