// ─────────────────────────────────────────────────────────────────────────────
//  gestures.ts — the three primitives.
//
//  Five named gestures came in (`tri`, `ordonner`, `placement`, `composer`, `etapes`). Read side by
//  side, the first three share ONE implementation: the only thing that differed between them was which
//  shape their targets were drawn as -- rectangles, squares or dotted discs. That is appearance, and
//  appearance is now the theme's business, so they collapse into a single `place`. Five public promises
//  became three.
//
//  Each gesture emits state, structure and behavior. Not one colour, not one font: `BLANK` proves it.
//  Coordinates DO appear, and that is not an opinion -- they are the ones the author wrote in the block.
// ─────────────────────────────────────────────────────────────────────────────
import type { Expansion, Gesture } from './index'
import { ident } from './ident'
import { GREYBOX, ROLES, type Role, type Theme } from './theme'

/** Everything a gesture needs beyond the author's text. */
export type GestureOptions = { theme?: Theme }

const q = (s: string) => s.replace(/"/g, "'")

/** Statements of a named group placed at `x,y`, drawn by the theme, optionally a drop box. */
function container(name: string, x: string, y: string, art: string[], hitbox?: { w: number; h: number }): string[] {
  const box = hitbox ? ` hitbox ${hitbox.w} ${hitbox.h}` : ''
  return [`    group "${name}" at ${x},${y} pivot 0,0${box} {`, '      layer "art" {', ...art.map((l) => `        ${l}`), '      }', '    }']
}

/** Split a block body into its non-empty, comment-free lines. */
const lines = (body: string): string[] => body.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean)

// ── place ────────────────────────────────────────────────────────────────────
// The drop gesture: items belong on targets. Several items may share a target (a sort) or each may have
// its own (an ordering, a labelled diagram) -- that falls out of the data, it is not a separate gesture.

type PlaceModel = {
  prompt: string
  targets: { id: string; label: string; x: string; y: string }[]
  items: { id: string; label: string; target: string; x: string; y: string }[]
}

function parsePlace(name: string, body: string): PlaceModel {
  const m: PlaceModel = { prompt: '', targets: [], items: [] }
  for (const line of lines(body)) {
    let x: RegExpMatchArray | null
    if ((x = line.match(/^prompt\s+"(.*)"$/))) m.prompt = x[1]
    else if ((x = line.match(/^target\s+(?:"([^"]+)"|(\S+))\s+at\s+(-?[\d.]+),(-?[\d.]+)$/))) {
      const label = x[1] ?? x[2]
      m.targets.push({ id: `T${ident(label)}`, label, x: x[3], y: x[4] })
    } else if ((x = line.match(/^item\s+(?:"([^"]+)"|(\S+))\s*->\s*(?:"([^"]+)"|(\S+))\s+at\s+(-?[\d.]+),(-?[\d.]+)$/))) {
      const label = x[1] ?? x[2]
      m.items.push({ id: `I${ident(label)}`, label, target: `T${ident(x[3] ?? x[4])}`, x: x[5], y: x[6] })
    } else throw new Error(`place "${name}": unrecognised line: ${line}`)
  }
  if (!m.targets.length) throw new Error(`place "${name}": no target — an item has nowhere to go`)
  if (!m.items.length) throw new Error(`place "${name}": no item — nothing for the learner to do`)
  const known = new Set(m.targets.map((t) => t.id))
  for (const it of m.items) {
    if (!known.has(it.target)) throw new Error(`place "${name}": item "${it.label}" points at an unknown target`)
  }
  return m
}

function expandPlace(name: string, body: string, theme: Theme): Expansion {
  const m = parsePlace(name, body)
  const n = m.items.length
  const out: string[] = [`// place "${q(name)}" — generated. The expansion is the artefact of record: edit it, or edit the block.`]
  if (m.prompt) out.push(`// prompt: ${q(m.prompt)}`)

  out.push('var progress = 0', 'var done = 0')
  for (const it of m.items) out.push(`var ${it.id}X = ${it.x}`, `var ${it.id}Y = ${it.y}`, `var ${it.id}Placed = 0`)

  out.push('', 'scene {', '  layer "targets" {')
  for (const t of m.targets) out.push(...container(t.id, t.x, t.y, theme.draw('target', t.label), theme.size('target')))
  out.push('  }', '  layer "items" {')
  for (const it of m.items) out.push(...container(it.id, it.x, it.y, theme.draw('item', it.label)))
  out.push('  }', '}', '')

  m.items.forEach((it, i) => {
    out.push(`object "${it.id}" {`)
    out.push(`  drag ${it.id}X, ${it.id}Y { enabled ${it.id}Placed == 0 }`)
    out.push(`  when dropped on ${it.target} at pointer {`)
    out.push(`    if ${it.id}Placed < 0.5 {`)
    out.push(`      ${it.id}Placed = 1`, '      progress = progress + 1')
    // Snap onto the target it was dropped on, reading the target's LIVE position -- so a skin may move
    // the target anywhere and the item still lands on it.
    out.push(`      ${it.id}X = ${it.target}.x`, `      ${it.id}Y = ${it.target}.y`)
    out.push(`      send "correct", { item = ${i} }`)
    out.push(`      if progress == ${n} {`, '        done = 1', '        send "completed"', '      }')
    out.push('    }', '  }')
    for (const t of m.targets) {
      if (t.id === it.target) continue
      out.push(`  when dropped on ${t.id} at pointer {`)
      out.push(`    ${it.id}X = ${it.x}`, `    ${it.id}Y = ${it.y}`) // back where it started
      out.push(`    send "incorrect", { item = ${i} }`)
      out.push('  }')
    }
    out.push(`  x = ${it.id}X`, `  y = ${it.id}Y`, '}', '')
  })
  return {
    flatink: out.join('\n'),
    meta: { keyword: 'place', name, prompt: m.prompt, items: m.items.map((i) => i.label), targets: m.targets.map((t) => t.label) },
  }
}

// ── compose ──────────────────────────────────────────────────────────────────
// Tap values until they add up to a target. Overshooting resets the total -- the whole point of the
// exercise is that going over is a mistake you feel, not one you are prevented from making.

function expandCompose(name: string, body: string, theme: Theme): Expansion {
  let target = 0
  const chips: { value: string; x: string; y: string }[] = []
  let prompt = ''
  for (const line of lines(body)) {
    let x: RegExpMatchArray | null
    if ((x = line.match(/^prompt\s+"(.*)"$/))) prompt = x[1]
    else if ((x = line.match(/^total\s+(\d+)$/))) target = Number(x[1])
    else if ((x = line.match(/^chip\s+(\d+)\s+at\s+(-?[\d.]+),(-?[\d.]+)$/))) chips.push({ value: x[1], x: x[2], y: x[3] })
    else throw new Error(`compose "${name}": unrecognised line: ${line}`)
  }
  if (!target) throw new Error(`compose "${name}": no \`total <n>\` — there is nothing to reach`)
  if (!chips.length) throw new Error(`compose "${name}": no chip — nothing for the learner to tap`)

  const out: string[] = [`// compose "${q(name)}" — generated.`, ...(prompt ? [`// prompt: ${q(prompt)}`] : []), 'var total = 0', 'var done = 0', '', 'scene {', '  layer "chips" {']
  chips.forEach((c, i) => out.push(...container(`C${i}`, c.x, c.y, theme.draw('chip', c.value), theme.size('chip'))))
  out.push('  }', '}', '')
  chips.forEach((c, i) => {
    out.push(`object "C${i}" {`, '  when clicked {', '    if done < 0.5 {')
    out.push(`      if total + ${c.value} > ${target} {`)
    out.push('        total = 0', `        send "incorrect", { chip = ${i} }`)
    out.push('      } else {')
    out.push(`        total = total + ${c.value}`, `        send "correct", { chip = ${i} }`)
    out.push(`        if total == ${target} {`, '          done = 1', '          send "completed"', '        }')
    out.push('      }', '    }', '  }', '}', '')
  })
  return { flatink: out.join('\n'), meta: { keyword: 'compose', name, prompt, items: chips.map((c) => c.value), targets: [] } }
}

// ── steps ────────────────────────────────────────────────────────────────────
// A gated sequence: step i only responds when it is the current one. Tapping out of order does nothing
// at all -- no error, no penalty, which is what makes it usable as an escape-room stage.

function expandSteps(name: string, body: string, theme: Theme): Expansion {
  let prompt = ''
  const steps: { label: string; x: string; y: string }[] = []
  for (const line of lines(body)) {
    let x: RegExpMatchArray | null
    if ((x = line.match(/^prompt\s+"(.*)"$/))) prompt = x[1]
    else if ((x = line.match(/^step\s+"(.*)"\s+at\s+(-?[\d.]+),(-?[\d.]+)$/))) steps.push({ label: x[1], x: x[2], y: x[3] })
    else throw new Error(`steps "${name}": unrecognised line: ${line}`)
  }
  if (!steps.length) throw new Error(`steps "${name}": no step — the sequence is empty`)

  const out: string[] = [`// steps "${q(name)}" — generated.`, ...(prompt ? [`// prompt: ${q(prompt)}`] : []), 'var step = 0', '', 'scene {', '  layer "steps" {']
  steps.forEach((s, i) => out.push(...container(`S${i}`, s.x, s.y, theme.draw('card', s.label), theme.size('card'))))
  out.push('  }', '}', '')
  steps.forEach((_s, i) => {
    out.push(`object "S${i}" {`, '  when clicked {', `    if step == ${i} {`, `      step = step + 1`, `      send "step", { index = ${i} }`)
    if (i === steps.length - 1) out.push('      send "completed"')
    out.push('    }', '  }')
    // The only thing the gesture says about looks: a step that is not current is dimmed, because
    // "which one is live" is STATE, not decoration. A theme that disagrees rebinds opacity itself.
    out.push(`  opacity = step == ${i} ? 1 : 0.45`, '}', '')
  })
  return { flatink: out.join('\n'), meta: { keyword: 'steps', name, prompt, items: steps.map((s2) => s2.label), targets: [] } }
}

/** `208x118` — the footprint of a role under a theme, for a summary or a prompt. */
const footprint = (theme: Theme, role: Role): string => {
  const { w, h } = theme.size(role)
  return `${w}x${h}`
}

/**
 * Build the shipped gestures against a theme. `GREYBOX` unless the caller supplies one.
 *
 * Each `summary` carries the FOOTPRINTS of the roles it places, because the author writes positions and
 * two overlapping surfaces make a drop ambiguous. Measured on ten model-written activities: a prompt
 * giving only "space them out" produced overlapping hitboxes in 4 of 10; the same prompt with the
 * numbers, 0 of 10. The sizes were public all along — nothing said you had to go and read them.
 */
export function gestures(opts: GestureOptions = {}): Gesture[] {
  const theme = opts.theme ?? GREYBOX
  return [
    {
      keyword: 'place',
      summary: `place <name> { prompt "…"  target <T> at x,y  item <i> -> <T> at x,y }  — drag items onto where they belong. Footprints: target ${footprint(theme, 'target')}, item ${footprint(theme, 'item')}; keep centres at least one footprint apart or the drop is ambiguous`,
      expand: (name, body) => expandPlace(name, body, theme),
    },
    {
      keyword: 'compose',
      summary: `compose <name> { prompt "…"  total <n>  chip <v> at x,y }  — tap values until they add up; overshooting resets. Footprint: chip ${footprint(theme, 'chip')}`,
      expand: (name, body) => expandCompose(name, body, theme),
    },
    {
      keyword: 'steps',
      summary: `steps <name> { prompt "…"  step "…" at x,y }  — a gated sequence; out-of-order taps do nothing. Footprint: card ${footprint(theme, 'card')}`,
      expand: (name, body) => expandSteps(name, body, theme),
    },
  ]
}

/**
 * The paste-ready reference for a model writing sugar: the grammar of every gesture, the footprints it
 * must respect, and the canvas it is laying out on. This is the artefact `summary` was being used as by
 * hand — assembled here so nobody has to know that the sizes live on the theme.
 */
export function sugarCard(opts: GestureOptions & { document?: { width: number; height: number } } = {}): string {
  const theme = opts.theme ?? GREYBOX
  const doc = opts.document ?? { width: 760, height: 620 }
  return [
    '# FlatInk sugar — one block, one activity',
    '',
    `Canvas: ${doc.width}x${doc.height}, origin top-left. Write ONE block, nothing else. Coordinates are the`,
    'CENTRE of each thing. Anything you do not describe is not drawn.',
    '',
    '## Blocks',
    ...gestures({ theme }).map((g) => `- ${g.summary}`),
    '',
    '## Footprints — respect them or two things overlap and the drop becomes ambiguous',
    ...ROLES.map((role) => `- ${role}: ${footprint(theme, role)}`),
    '',
    `A row of targets fits about ${Math.floor(doc.width / (theme.size('target').w + 20))} across; a row of items about ${Math.floor(doc.width / (theme.size('item').w + 20))}.`,
    'Leave a gap the size of the thing itself between two centres.',
    '',
    '## Escape hatch — three forms, and they are not interchangeable',
    'The block draws NOTHING beyond the pieces above. Everything else goes through one of these:',
    '',
    'raw scene under { layer "bg" { … } }   <- BACKGROUND and decor. Drawn BEHIND the activity.',
    'raw scene { layer "banner" { … } }     <- overlays drawn ON TOP: a title, a frame, a caption.',
    'raw { var lives = 3   object "X" { … } }  <- header and behavior: var, fn, asset, object blocks.',
    '',
    'A `layer` written in a plain `raw { … }` lands OUTSIDE the scene and is a compile error — anything',
    'that is drawn belongs in one of the two `raw scene` forms. Either may be written on one line.',
  ].join('\n')
}
