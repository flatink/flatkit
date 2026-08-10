# @flatkit/sugarflat

Declarative sugar for FlatInk. A compact block expands into **inspectable `.flatink`** — the expansion is
the artefact of record, and anything the sugar writes can be written by hand instead.

```
place natures {
  prompt "Put each word under its part of speech"
  target Nouns at 230,470
  target Verbs at 530,470
  item cat -> Nouns at 150,150
  item run -> Verbs at 310,150
}
```

```ts
import { desugar } from '@flatkit/sugarflat'
import { checkProgram } from '@flatkit/compiler'

const { flatink } = desugar(src)
const { ok, report } = checkProgram(flatink)   // the expansion is what you ship, and what you read
if (!ok) retry(report)
```

## Why it lives in the flatkit repo

Not to put authoring opinions into the language. It is a **separate package**, out of the lockstep
version group (the same standing as `@flatkit/mcp`), and **`@flatkit/compiler` never depends on it** —
that direction is the whole guarantee.

It lives here so the two move together: a grammar change breaks these tests in the same CI run. That was
argued for a long time and then demonstrated — the previous out-of-tree sugar never emitted the format's
**required** `size` line, on its entire corpus, for months, and nobody noticed because the compiler
silently defaults it. Every document was laid out for one canvas and drawn on another.

## The line this package does not cross

**No visual opinion.** A gesture emits state and behavior; it never emits a coordinate, a colour or a
font. The language already ships plenty of *interaction* opinions (`drag`, `when dropped on … at pointer`,
`hitbox`, `match`, `feedback`, `spring`) — what it has never shipped is a look, and a sugar that shipped
one would hand every activity built on it the same face. That has happened before, and the activities all
came out looking alike.

Two consequences, both deliberate:

- **`raw { … }` passes through verbatim, always** — before or after the block, and so does any plain
  FlatInk you write beside it. A sugar you cannot opt out of stops being scaffolding and becomes a
  template.
- **`raw scene { … }` goes INSIDE the generated scene** — a program may only have one `scene`, so this
  is the route decor takes. A gesture emits no appearance, which makes this the hatch that matters.
- **The composition is yours.** A gesture names the objects it drives; you (or a skin) draw them. This is
  how `match` has always worked in the language proper.

```
place organs { prompt "…"  target Chest at 300,300  item heart -> Chest at 120,140 }

raw scene { layer "backdrop" { rect 0 0 760 620 fill linear(90, 0:#1b2a4a, 1:#4a6fa5) } }
raw { object "TChest" { opacity = 0.9 } }
```

## Several blocks in one document

```
place words { prompt "…"  target Nouns at 200,200  item cat -> Nouns at 120,80 }
compose coins { prompt "…"  total 150  chip 50 at 200,500  chip 100 at 420,500 }

raw scene under { layer "bg" { rect 0 0 760 620 fill #112233 } }
```

Blocks are laid out in the order you write them, and the decor sits behind all of them. Two things the
assembly decides:

- **Names are prefixed by the block's name, always** — `words_TNouns`, `coins_C0` — including when a
  document holds one block. Prefixing only on collision would mean the same source compiles to different
  names depending on whether a sibling exists, so a skin written against one block would break the day a
  second arrived. Every id is in `meta[].objects`; nothing has to be guessed.
- **`completed` belongs to the DOCUMENT.** Each block emits `part` with its own index when its portion is
  finished, and `completed` fires once, when every block is done. With a single block the two coincide,
  which is what `completed` always meant.

Two blocks sharing a name raise `DuplicateBlockError` — every name they emit would collide.

## What it guarantees

- **The required header is emitted.** `size` and `timeline`, from a document spec that is *readable*
  (`DEFAULT_DOCUMENT`) and overridable per call, rather than a literal buried in a generator.
- **An unknown block is a hard error.** A sugar block nobody claims used to fall through as if it were
  FlatInk, and failed a hundred lines downstream in a vocabulary that only talks about FlatInk.
- **Human labels become valid identifiers.** `ident()` folds accents, because FlatInk identifiers are
  `[A-Za-z0-9_]` and the lexer stops at an accent rather than erroring — one variable silently became two.
- **Every expansion passes `checkProgram` with ZERO warnings.** Not "it compiles": a warning on generated
  DSL is a defect in a place nobody is watching.

## Tests: contracts, not goldens

`src/contracts/` states what each gesture **does** — the events a learner's actions produce and the state
left behind — never the DSL it writes. Text goldens cannot survive a rewrite that changes every emitted
line; a gesture-replay contract can.

It earned that on day one: replaying the *shipped* implementation showed that the full-canvas `Flash`
overlay carries no `nohit`, so after a wrong answer it swallows every pointer event for ~40 frames. The
learner makes a mistake and the activity stops responding, at the exact moment they retry.

## The three gestures

| | |
|---|---|
| `place <name> { prompt "…"  target <T> at x,y  item <i> -> <T> at x,y }` | drag items onto where they belong |
| `compose <name> { prompt "…"  total <n>  chip <v> at x,y }` | tap values until they add up; overshooting resets |
| `steps <name> { prompt "…"  step "…" at x,y }` | a gated sequence; out-of-order taps do nothing |

Each emits `send "correct" / "incorrect" / "step" / "completed"` with a record payload naming the index
(`{ item = 2 }`), so a host reads which one without depending on what the theme drew. `desugar()` returns
the labels behind those indices, and the prompt, in `meta` — the host displays them, the gesture never
draws them:

```ts
const { flatink, meta } = desugar(src)
meta[0].prompt      // the learner's instruction for the first block
meta[0].items[2]    // the label behind `{ block = 0, item = 2 }`
meta[0].objects     // every id it emitted, prefixed — what a skin binds to
```

For prompting a model, `sugarCard()` assembles the grammar, the canvas and the **footprints** of every
role. The footprints matter: measured on ten model-written activities, a prompt without them produced
overlapping hitboxes in 4 of 10, and 0 of 10 with.

**Five gestures came in and three shipped.** `tri`, `ordonner` and `placement` shared one implementation:
the only thing that differed was whether their targets were drawn as rectangles, squares or dotted discs.
That is appearance, so it moved to the theme and the three became `place`. A sort and an ordering differ
in their data — several items on one target, or one each — not in their code.

## Themes

```ts
import { desugar, gestures, GREYBOX, BLANK, type Theme } from '@flatkit/sugarflat'

desugar(src)                                        // GREYBOX: plain, provisional, playable now
desugar(src, { gestures: gestures({ theme: mine }) }) // your appearance, same behavior
```

A theme answers two questions per role (`item`, `target`, `card`, `chip`): how big it is, and what to
draw inside it. `BLANK` answers "nothing", which is how the no-visual-opinion rule is tested rather than
promised — expand every gesture with it and the output must not contain one colour, font or stroke.

## Status

New. The three gestures are covered by behavior contracts and by the zero-warning rule; the design record
for how this package came to exist is internal.
