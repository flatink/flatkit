// ─────────────────────────────────────────────────────────────────────────────
//  gestures.ts — the three primitives.
//
//  Five named gestures came in (`tri`, `ordonner`, `placement`, `composer`, `etapes`). Read side by
//  side, the first three share ONE implementation: the only thing that differed between them was which
//  shape their targets were drawn as -- rectangles, squares or dotted discs. That is appearance, and
//  appearance is the theme's business, so they collapse into a single `place`.
//
//  Each gesture emits state, structure and behavior. Not one colour, not one font: `BLANK` proves it.
//  Coordinates DO appear, and that is not an opinion -- they are the ones the author wrote in the block.
//
//  A gesture returns PARTS, never a finished program: its `var` lines, its layers, its behavior. That is
//  what lets a document hold several of them -- a program has exactly one `scene`, so merging text after
//  the fact was always going to be surgery. Assembling parts is not.
// ─────────────────────────────────────────────────────────────────────────────
import type { Expansion, Gesture, GestureContext } from './index'
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

/**
 * `shuffle`: the spots the author declared, handed out in another order when the activity loads. The
 * spots live in two arrays (`<p>sx`, `<p>sy`) that a `when loaded` shuffles in place (Fisher-Yates over
 * `random()` — reproducible under a seed, see the player's `seed` option); element `i` then stands at
 * `<p>sx[i]`, `<p>sy[i]`. Fewer than two spots: nothing to shuffle, and nothing is emitted.
 */
function shuffler(p: string, spots: { x: string; y: string }[]): { vars: string[]; load: string[]; x: (i: number) => string; y: (i: number) => string } | null {
  const n = spots.length
  if (n < 2) return null
  const sx = `${p}sx`, sy = `${p}sy`, j = `${p}sj`, t = `${p}st`, k = `${p}sk`
  return {
    vars: [`var ${sx} = [${spots.map((s) => s.x).join(', ')}]`, `var ${sy} = [${spots.map((s) => s.y).join(', ')}]`, `var ${j} = 0`, `var ${t} = 0`],
    load: [
      `  repeat ${k} from 0 to ${n - 2} {`,
      `    ${j} = ${k} + floor(random() * (${n} - ${k}))`,
      `    ${t} = ${sx}[${k}]`, `    ${sx}[${k}] = ${sx}[${j}]`, `    ${sx}[${j}] = ${t}`,
      `    ${t} = ${sy}[${k}]`, `    ${sy}[${k}] = ${sy}[${j}]`, `    ${sy}[${j}] = ${t}`,
      '  }',
    ],
    x: (i) => `${sx}[${i}]`,
    y: (i) => `${sy}[${i}]`,
  }
}

/** A line holding two statements: one keyword, then another after a run of spaces. */
const RUNON = /^(?:prompt|target|item|total|chip|step)\b.*\s{2,}(?:prompt|target|item|total|chip|step)\b/

/**
 * Split a block body into its non-empty, comment-free lines — ONE STATEMENT PER LINE, like FlatInk
 * itself. A body written inline is a run-on, and it deserves its own message: the grammar sketch in
 * `summary` shows the shape on one line, so that is the natural thing to copy.
 */
function lines(kind: string, name: string, body: string): string[] {
  const out = body.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean)
  for (const line of out) {
    if (!RUNON.test(line)) continue
    const laid = line.split(/\s{2,}/).filter(Boolean).map((st) => `    ${st}`).join('\n')
    throw new Error(`${kind} "${name}": two statements on one line — a block takes ONE per line, like FlatInk itself:\n  ${kind} ${name} {\n${laid}\n  }`)
  }
  return out
}

// ── place ────────────────────────────────────────────────────────────────────
// The drop gesture: items belong on targets. Several items may share a target (a sort) or each may have
// its own (an ordering, a labelled diagram) -- that falls out of the data, it is not a separate gesture.

type PlaceModel = {
  prompt: string
  shuffle: boolean
  /** `targets size w,h`: the footprint of every target of the block that does not give its own. */
  targetSize?: { w: number; h: number }
  targets: { id: string; label: string; x: string; y: string; size?: { w: number; h: number } }[]
  items: { id: string; label: string; target: string; x: string; y: string }[]
}

function parsePlace(name: string, body: string, p: string): PlaceModel {
  const m: PlaceModel = { prompt: '', shuffle: false, targets: [], items: [] }
  // An object is named after its label, and `ident` keeps letters and digits only: `-1` and `+1` fold to
  // the same name, `< 1`, `= 1` and `> 1` too. The first keeps the plain name (so nothing moves for
  // labels that never collided — a skin addresses these objects by name); the next ones take `_2`, `_3`…
  const taken = new Set<string>()
  const own = (base: string): string => {
    let id = base
    for (let k = 2; taken.has(id); k++) id = `${base}_${k}`
    taken.add(id)
    return id
  }
  const targetOf = new Map<string, string>() // target LABEL -> its object: an item names a target by label
  for (const line of lines('place', name, body)) {
    let x: RegExpMatchArray | null
    if ((x = line.match(/^prompt\s+"(.*)"$/))) m.prompt = x[1]
    else if (line === 'shuffle') m.shuffle = true
    else if ((x = line.match(/^targets\s+size\s+(\d+),(\d+)$/))) m.targetSize = { w: Number(x[1]), h: Number(x[2]) }
    else if ((x = line.match(/^target\s+(?:"([^"]+)"|(\S+))\s+at\s+(-?[\d.]+),(-?[\d.]+)(?:\s+size\s+(\d+),(\d+))?$/))) {
      const label = x[1] ?? x[2]
      if (targetOf.has(label)) throw new Error(`place "${name}": two targets are labelled "${label}" — an item pointing at it could mean either`)
      const id = own(`${p}T${ident(label)}`)
      targetOf.set(label, id)
      // The size of a target is the author's (flatink/flatink#56): five fixed-size ones could not stand in a
      // row on a 760 px scene.
      m.targets.push({ id, label, x: x[3], y: x[4], ...(x[5] ? { size: { w: Number(x[5]), h: Number(x[6]) } } : {}) })
    } else if (/^targets?\b.*\bsize\b/.test(line)) {
      throw new Error(`place "${name}": a size is two whole numbers, width,height — \`target T at x,y size 120,80\`, or \`targets size 120,80\` for the whole block: ${line}`)
    } else if ((x = line.match(/^item\s+(?:"([^"]+)"|(\S+))\s*->\s*(?:"([^"]+)"|(\S+))\s+at\s+(-?[\d.]+),(-?[\d.]+)$/))) {
      const label = x[1] ?? x[2]
      m.items.push({ id: own(`${p}I${ident(label)}`), label, target: x[3] ?? x[4], x: x[5], y: x[6] })
    } else throw new Error(`place "${name}": unrecognised line: ${line}`)
  }
  if (!m.targets.length) throw new Error(`place "${name}": no target — an item has nowhere to go`)
  if (!m.items.length) throw new Error(`place "${name}": no item — nothing for the learner to do`)
  // Resolved once every line is read: a target may be declared after the item that names it.
  for (const it of m.items) {
    // By label; failing that by the identifier the label folds to, as long as ONE target answers to it
    // (`Vegetaux` for a target written with its accents — what this lookup accepted before).
    const folded = m.targets.filter((t) => ident(t.label) === ident(it.target))
    const id = targetOf.get(it.target) ?? (folded.length === 1 ? folded[0].id : undefined)
    if (!id) throw new Error(`place "${name}": item "${it.label}" points at an unknown target`)
    it.target = id
  }
  return m
}

/** Each block owns a range of 1000 focus ranks, so Tab goes through the blocks in their order whatever their
 *  kind — a sequence numbered its cards from 1 and a compose ranked nothing, which mixed them with the others. */
const focusBase = (block: number): number => block * 1000

function expandPlace(name: string, body: string, theme: Theme, ctx: GestureContext): Expansion {
  const { prefix: p, index: b, doneVar } = ctx
  const m = parsePlace(name, body, p)
  const n = m.items.length
  const vars = [`// ${p}— place "${q(name)}"`, ...(m.prompt ? [`// prompt: ${q(m.prompt)}`] : []), `var ${p}progress = 0`, `var ${doneVar} = 0`]
  for (const it of m.items) vars.push(`var ${it.id}X = ${it.x}`, `var ${it.id}Y = ${it.y}`, `var ${it.id}Placed = 0`)
  const sh = m.shuffle ? shuffler(p, m.items) : null
  if (sh) vars.push(...sh.vars)
  // The second way in, for a keyboard (and for a finger that would rather tap twice than drag): pick an
  // item, then pick a target. `<p>sel` = the picked item, 1-based; 0 = none.
  const sel = `${p}sel`
  vars.push(`var ${sel} = 0`)
  // Tab order: the items of this block, then its targets — and the blocks one after the other.
  const itemOrder = focusBase(b) + 1, targetOrder = focusBase(b) + 2
  /** What putting item `i` on target `t` does — the SAME outcome whether it was dragged or picked. */
  const put = (it: PlaceModel['items'][number], i: number, t: PlaceModel['targets'][number], ind: string): string[] => t.id === it.target
    ? [
        `${ind}if ${it.id}Placed < 0.5 {`,
        `${ind}  ${it.id}Placed = 1`, `${ind}  ${p}progress = ${p}progress + 1`,
        // Snap onto the target it was put on, reading the target's LIVE position -- so a skin may move
        // the target anywhere and the item still lands on it.
        `${ind}  ${it.id}X = ${t.id}.x`, `${ind}  ${it.id}Y = ${t.id}.y`,
        `${ind}  if ${sel} == ${i + 1} {`, `${ind}    ${sel} = 0`, `${ind}  }`, // placed: no longer picked, however it got there
        `${ind}  send "correct", { block = ${b}, item = ${i} }`,
        `${ind}  if ${p}progress == ${n} {`, `${ind}    ${doneVar} = 1`, `${ind}    send "part", { block = ${b} }`, `${ind}  }`,
        `${ind}}`,
      ]
    : [
        `${ind}${it.id}X = ${sh ? sh.x(i) : it.x}`, `${ind}${it.id}Y = ${sh ? sh.y(i) : it.y}`, // back where it started
        `${ind}send "incorrect", { block = ${b}, item = ${i} }`,
      ]

  const layers = [`  layer "${p}targets" {`]
  for (const t of m.targets) {
    const size = t.size ?? m.targetSize ?? theme.size('target')
    layers.push(...container(t.id, t.x, t.y, theme.draw('target', t.label, size), size))
  }
  layers.push('  }', `  layer "${p}items" {`)
  for (const it of m.items) layers.push(...container(it.id, it.x, it.y, theme.draw('item', it.label)))
  layers.push('  }')

  const behavior: string[] = []
  if (sh) behavior.push('when loaded {', ...sh.load, ...m.items.flatMap((it, i) => [`  ${it.id}X = ${sh.x(i)}`, `  ${it.id}Y = ${sh.y(i)}`]), '}', '')
  m.items.forEach((it, i) => {
    behavior.push(`object "${it.id}" {`, `  focusable order ${itemOrder}`)
    behavior.push(`  drag ${it.id}X, ${it.id}Y { enabled ${it.id}Placed == 0 }`)
    behavior.push('  when clicked {', `    if ${it.id}Placed < 0.5 {`, `      ${sel} = ${i + 1}`, '    }', '  }')
    // Its own target first, then the others — the order these handlers have always been declared in.
    for (const t of [...m.targets.filter((x) => x.id === it.target), ...m.targets.filter((x) => x.id !== it.target)]) behavior.push(`  when dropped on ${t.id} at pointer {`, ...put(it, i, t, '    '), '  }')
    behavior.push(`  x = ${it.id}X`, `  y = ${it.id}Y`)
    // Which item is picked is STATE, like the live step of a sequence: it stands out a little. A theme
    // that disagrees rebinds the scale itself.
    behavior.push(`  scaleX = ${sel} == ${i + 1} ? 1.08 : 1`, `  scaleY = ${sel} == ${i + 1} ? 1.08 : 1`, '}', '')
  })
  for (const t of m.targets) {
    behavior.push(`object "${t.id}" {`, `  focusable order ${targetOrder}`, '  when clicked {')
    // Only an item still to place: one picked and then dragged home must not be sent back by a later tap.
    m.items.forEach((it, i) => behavior.push(`    if ${sel} == ${i + 1} && ${it.id}Placed < 0.5 {`, `      ${sel} = 0`, ...put(it, i, t, '      '), '    }'))
    behavior.push('  }', '}', '')
  }
  return {
    vars,
    layers,
    behavior,
    meta: { keyword: 'place', name, prompt: m.prompt, items: m.items.map((i) => i.label), targets: m.targets.map((t) => t.label), objects: [...m.targets, ...m.items].map((o) => o.id), doneVar, ...(sh ? { shuffle: true } : {}) },
  }
}

// ── compose ──────────────────────────────────────────────────────────────────
// Tap values until they add up to a target. Overshooting resets the total -- the whole point of the
// exercise is that going over is a mistake you feel, not one you are prevented from making.

function expandCompose(name: string, body: string, theme: Theme, ctx: GestureContext): Expansion {
  const { prefix: p, index: b, doneVar } = ctx
  let target = 0
  const chips: { value: string; x: string; y: string }[] = []
  let prompt = ''
  let shuffle = false
  for (const line of lines('compose', name, body)) {
    let x: RegExpMatchArray | null
    if ((x = line.match(/^prompt\s+"(.*)"$/))) prompt = x[1]
    else if (line === 'shuffle') shuffle = true
    else if ((x = line.match(/^total\s+(\d+)$/))) target = Number(x[1])
    else if ((x = line.match(/^chip\s+(\d+)\s+at\s+(-?[\d.]+),(-?[\d.]+)$/))) chips.push({ value: x[1], x: x[2], y: x[3] })
    else throw new Error(`compose "${name}": unrecognised line: ${line}`)
  }
  if (!target) throw new Error(`compose "${name}": no \`total <n>\` — there is nothing to reach`)
  if (!chips.length) throw new Error(`compose "${name}": no chip — nothing for the learner to tap`)

  const vars = [`// ${p}— compose "${q(name)}"`, ...(prompt ? [`// prompt: ${q(prompt)}`] : []), `var ${p}total = 0`, `var ${doneVar} = 0`]
  const layers = [`  layer "${p}chips" {`]
  chips.forEach((c, i) => layers.push(...container(`${p}C${i}`, c.x, c.y, theme.draw('chip', c.value), theme.size('chip'))))
  layers.push('  }')

  const sh = shuffle ? shuffler(p, chips) : null
  if (sh) vars.push(...sh.vars)
  const behavior: string[] = []
  if (sh) behavior.push('when loaded {', ...sh.load, '}', '')
  chips.forEach((c, i) => {
    behavior.push(`object "${p}C${i}" {`, `  focusable order ${focusBase(b) + 1}`, ...(sh ? [`  x = ${sh.x(i)}`, `  y = ${sh.y(i)}`] : []), '  when clicked {', `    if ${doneVar} < 0.5 {`)
    behavior.push(`      if ${p}total + ${c.value} > ${target} {`)
    behavior.push(`        ${p}total = 0`, `        send "incorrect", { block = ${b}, item = ${i} }`)
    behavior.push('      } else {')
    behavior.push(`        ${p}total = ${p}total + ${c.value}`, `        send "correct", { block = ${b}, item = ${i} }`)
    behavior.push(`        if ${p}total == ${target} {`, `          ${doneVar} = 1`, `          send "part", { block = ${b} }`, '        }')
    behavior.push('      }', '    }', '  }', '}', '')
  })
  return {
    vars,
    layers,
    behavior,
    meta: { keyword: 'compose', name, prompt, items: chips.map((c) => c.value), targets: [], objects: chips.map((_c, i) => `${p}C${i}`), doneVar, ...(sh ? { shuffle: true } : {}) },
  }
}

// ── steps ────────────────────────────────────────────────────────────────────
// A gated sequence: step i only responds when it is the current one. A step AHEAD of the current one is a
// mistake the host may count (`incorrect`, like `place` and `compose` — flatink/flatink#58); nothing else
// moves, so the sequence stays usable as an escape-room stage. A step already done stays silent.

function expandSteps(name: string, body: string, theme: Theme, ctx: GestureContext): Expansion {
  const { prefix: p, index: b, doneVar } = ctx
  let prompt = ''
  let shuffle = false
  const steps: { label: string; x: string; y: string }[] = []
  for (const line of lines('steps', name, body)) {
    let x: RegExpMatchArray | null
    if ((x = line.match(/^prompt\s+"(.*)"$/))) prompt = x[1]
    else if (line === 'shuffle') shuffle = true
    else if ((x = line.match(/^step\s+"(.*)"\s+at\s+(-?[\d.]+),(-?[\d.]+)$/))) steps.push({ label: x[1], x: x[2], y: x[3] })
    else throw new Error(`steps "${name}": unrecognised line: ${line}`)
  }
  if (!steps.length) throw new Error(`steps "${name}": no step — the sequence is empty`)

  const vars = [`// ${p}— steps "${q(name)}"`, ...(prompt ? [`// prompt: ${q(prompt)}`] : []), `var ${p}step = 0`, `var ${doneVar} = 0`]
  const layers = [`  layer "${p}steps" {`]
  steps.forEach((s, i) => layers.push(...container(`${p}S${i}`, s.x, s.y, theme.draw('card', s.label), theme.size('card'))))
  layers.push('  }')

  // `shuffle` moves the CARDS; the order of the sequence stays the declared one.
  const sh = shuffle ? shuffler(p, steps) : null
  if (sh) vars.push(...sh.vars)
  const behavior: string[] = []
  if (sh) behavior.push('when loaded {', ...sh.load, '}', '')
  steps.forEach((_s, i) => {
    // `order`: Tab walks the cards in the order of the SEQUENCE, wherever they stand (`shuffle` moves them).
    behavior.push(`object "${p}S${i}" {`, `  focusable order ${focusBase(b) + 1 + i}`, ...(sh ? [`  x = ${sh.x(i)}`, `  y = ${sh.y(i)}`] : []), '  when clicked {', `    if ${p}step == ${i} {`, `      ${p}step = ${p}step + 1`, `      send "step", { block = ${b}, item = ${i} }`)
    if (i === steps.length - 1) behavior.push(`      ${doneVar} = 1`, `      send "part", { block = ${b} }`)
    behavior.push('    }')
    if (i > 0) behavior.push(`    if ${p}step < ${i} {`, `      send "incorrect", { block = ${b}, item = ${i} }`, '    }')
    behavior.push('  }')
    // The only thing the gesture says about looks: a step that is not current is dimmed, because
    // "which one is live" is STATE, not decoration. A theme that disagrees rebinds opacity itself.
    behavior.push(`  opacity = ${p}step == ${i} ? 1 : 0.45`, '}', '')
  })
  return {
    vars,
    layers,
    behavior,
    meta: { keyword: 'steps', name, prompt, items: steps.map((s) => s.label), targets: [], objects: steps.map((_s, i) => `${p}S${i}`), doneVar, ...(sh ? { shuffle: true } : {}) },
  }
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
      summary: `place <name> { prompt "…"  [shuffle]  [targets size w,h]  target <T> at x,y [size w,h]  item <i> -> <T> at x,y }  — drag items onto where they belong. Footprints: target ${footprint(theme, 'target')} unless sized, item ${footprint(theme, 'item')}; keep centres at least one footprint apart or the drop is ambiguous`,
      expand: (name, body, _doc, ctx) => expandPlace(name, body, theme, ctx),
    },
    {
      keyword: 'compose',
      summary: `compose <name> { prompt "…"  [shuffle]  total <n>  chip <v> at x,y }  — tap values until they add up; overshooting resets. Footprint: chip ${footprint(theme, 'chip')}`,
      expand: (name, body, _doc, ctx) => expandCompose(name, body, theme, ctx),
    },
    {
      keyword: 'steps',
      summary: `steps <name> { prompt "…"  [shuffle]  step "…" at x,y }  — a gated sequence; a step tapped ahead of its turn sends "incorrect". Footprint: card ${footprint(theme, 'card')}`,
      expand: (name, body, _doc, ctx) => expandSteps(name, body, theme, ctx),
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
    '# FlatInk sugar — a document is one or more blocks',
    '',
    `Canvas: ${doc.width}x${doc.height}, origin top-left. Coordinates are the CENTRE of each thing.`,
    'Anything you do not describe is not drawn.',
    '',
    '## Blocks — ONE statement per line, like FlatInk itself',
    '',
    'place <name> {          compose <name> {        steps <name> {',
    '  prompt "…"              prompt "…"              prompt "…"',
    '  target <T> at x,y       total <n>               step "…" at x,y',
    '  item <i> -> <T> at x,y  chip <v> at x,y       }',
    '}                       }',
    '',
    ...gestures({ theme }).map((g) => `- ${g.summary}`),
    '',
    'Several blocks may share a document; give each a DISTINCT name. They are laid out in the order you',
    'write them, each keeps its own state, and each emits `part` when its own portion is finished. The',
    'document emits `completed` once, when every block is done.',
    '',
    '## Footprints — respect them or two things overlap and the drop becomes ambiguous',
    ...ROLES.map((role) => `- ${role}: ${footprint(theme, role)}`),
    '',
    `A row of targets fits about ${Math.floor(doc.width / (theme.size('target').w + 20))} across; a row of items about ${Math.floor(doc.width / (theme.size('item').w + 20))}.`,
    'Leave a gap the size of the thing itself between two centres. Two blocks must not share the same area.',
    '',
    '## Escape hatch — three forms, and they are not interchangeable',
    'The blocks draw NOTHING beyond the pieces above. Everything else goes through one of these:',
    '',
    'raw scene under { layer "bg" { … } }   <- BACKGROUND and decor. Drawn BEHIND everything.',
    'raw scene { layer "banner" { … } }     <- overlays drawn ON TOP: a title, a frame, a caption.',
    'raw { var lives = 3   object "X" { … } }  <- header and behavior: var, fn, asset, object blocks.',
    '',
    'A `layer` written in a plain `raw { … }` lands OUTSIDE the scene and is a compile error — anything',
    'that is drawn belongs in one of the two `raw scene` forms. Any of them may be written on one line.',
  ].join('\n')
}
