# Decision — the sugar layer (`@flatkit/sugar`): declined as a package, absorbed as capabilities

> Answer to [`rfc-sugar-layer.md`](rfc-sugar-layer.md). Read that first. Every number below was measured
> against the proposal's own sources on 2026-08-09, with flatkit 0.23.0.

**Verdict: no `@flatkit/sugar` package.** The RFC's diagnosis is right and its central argument holds —
sugar that describes *the language* must live with the language, or it diverges the moment the language
moves, and it did. But the boundary it draws puts the wrong 335 lines on the flatkit side. Read module by
module, almost none of that code is language-level *as written*. What belongs here are the **capabilities**
those modules stand in for, and three of the four are now implemented.

---

## 1. Why the proposed partition does not hold

The RFC proposes moving `motion.mjs` (150 lines), `manifest.mjs` (88), `index.mjs` (76) and `skin.mjs` (21).
Each was read in full.

### `motion.mjs` — one artistic template, not an ambience grammar

It is not generic ambience. It is a **space scene hard-coded**: a `BG` table whose only entry is
`space-deep`, a literal 16-star scatter array, the nouns `nebula` / `stars` / `streak`, `font "Georgia,
serif"`, a timeline frozen at 240 frames, and — decisively — an emitted `instance "HaloPulse"` that must
exist in a `.flat` library living in the neighbouring repo. A generic package cannot depend by name on
another repository's symbol.

The **idea** is excellent and worth keeping on that side: declarative ambience should expand to **tween
cels**, not to `sin()` formulas, because poses can be read and dragged in a timeline while a formula can
only be executed to be understood. That argument is sound. It is an argument about how to *author* a
scene, and it needs no support from this repo: cels and tweens are already primitives here. Nothing is
missing for `motion` to keep doing exactly what it does — outside.

### `manifest.mjs` — the right idea, an implementation that cannot travel

It scrapes `.flatink` **text with regular expressions**, and carries hard-coded educational heuristics
(`/(Xp|Yp|Bnc|Out)$/`, `dockBounce`, `pop*` are classed as "plumbing") plus a French Markdown renderer.
None of that generalises. And flatkit already shipped the same job done properly — `manifestObjects` /
`docToManifest` / `llmContext`, derived from the **parsed Doc**.

What the flatkit version genuinely lacked was the part the RFC is right to care about: the interaction
**roles**, the **emitted events**, and the **state each object reads**. That gap is now closed (§2).

### `index.mjs` — a dispatch table over the business sugars

Seventy-six lines, of which the substance is a `DETECT` array pointing at eleven educational expanders.
Remove those and what remains is roughly ten lines that unwrap a `raw { … }` block. That is not a package.

### `skin.mjs` — three workarounds for a gap the language has already closed

Its own comment states the reason it exists: *"a BOUND channel REPLACES the `at` component (it is not
additive)"*. That is precisely what **`dx`/`dy` additive offsets** fixed in 0.20 — `pos = at + (dx, dy)`.

```
lift "Gate" open travel 110   →   object "Gate" { y = -open * 110 }   // must be authored at y = 0
                              →   object "Gate" { dy = -open * 110 }  // any anchor, offset from it
```

`lift` and `follow` are largely obsolete against the current language; `surface` is a one-line `scaleY`
idiom. Three regex substitutions encoding conventions is not a package either — it is a paragraph of
documentation, and the paragraph is now in the [gotchas](dsl-gotchas.md).

---

## 2. What was absorbed instead

The capabilities behind the proposal, implemented from the Doc and the source rather than from text:

- **The binding contract** — `manifestObjects` now reports, per named object: the item events the logic
  handles, whether a `drag`/`turn` interactor owns its position, whether it is a drop zone (named by a
  `when dropped on`, or carrying a `hitbox`), the **channels the logic drives**, and the **state it
  reads** — the last one parsed with the real expression analyser, so `open` never matches `reopen`.
  `manifestEvents` returns what the program sends to its host. `docToManifest` renders it as a
  `contract:` block, and **not one coordinate crosses that boundary** — that is what lets a second skin
  honour the same logic with a completely different composition, which is the RFC's own strongest point.
- **`drawingCard()`** — the composition half of the reference, beside `languageCard()` (friction F2). Its
  examples are compiled by a test, so a copied reference can no longer drift into DSL that does not parse.
- **The agent prompts ship in the npm package** (friction F3). They were gitignored and absent from the
  tarball, which is what forced an integrator to hand-copy the grammar in the first place.
- **The four other frictions** — the silent `time` → `pulse` trap, `checkProgram` so the API sees what the
  CLI sees, layout checks that descend into groups and measure wrapped text, and a real message for a
  stroke option written out of order. See the CHANGELOG.

## 3. What sugarflat should rely on

Nothing needs to move for the business sugars to keep working, and two things get better:

- **Validate the expansion in-process.** `checkProgram(flatink)` returns exactly what `flatc --check`
  returns, without a subprocess — so "expand → check → repair" becomes a loop inside the pipeline, and
  the "zero warnings" bar the RFC asks for is now enforceable. It also reaches two error classes no
  public call could reach before, including `object` blocks that bind to nothing.
- **Read the contract instead of re-deriving it.** `manifestObjects` / `manifestEvents` replace
  `manifest.mjs` with a Doc-derived equivalent that survives a grammar change.

One correction to carry back: **`socle`'s `time` captures must become `clock` captures.** The RFC's
friction 6 called this cosmetic. It is not — since 0.23 it is the *silent* failure described in F1, and
`flatc --check` now names it. That is the one change the sugar side has to make.

## 4. The guard-rail, kept

The RFC's non-negotiable — *escape hatch everywhere; any block must be replaceable by raw `.flatink`* —
needs no enforcement here, because nothing in flatkit constrains composition in the first place. It is
worth restating as the reason this decision went the way it did: a package that shipped `motion`'s star
field would have shipped a **house style**, and every scene built on it would have carried the same sky.
The language stays a language.

## 5. What was NOT done, and why

- **`require` export** (friction F5). The compiler is deliberately ESM-only (`format: ['esm']`). Adding a
  CJS build to spare `tsx -e` a ten-minute confusion buys a dual-package hazard on a package whose
  functions are pure. Load it with `import`, or `tsx --tsconfig` an ESM context. Reopen this if a real
  consumer is stuck on CJS.
- **Migrating `poc/` (255 files) and `components/` (12).** The RFC says sort rather than ship, and none
  of it is covered by the goldens. Nothing here to take.
