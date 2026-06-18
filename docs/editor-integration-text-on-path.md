# Editor integration — Text on a path (hand-off note for the flatink-edu agent)

> **Audience:** the agent working on the **flatink editor** (`flatink-edu`), which consumes the **published**
> `@flatkit/*` packages over npm (not the workspace). **Prerequisite:** bump to the `@flatkit/*` version
> that ships text-on-path (the `curved-text` release — `pnpm update --latest @flatkit/player @flatkit/compiler`),
> then this note tells you what the editor must add to *author* the feature.
>
> Full spec: [`rfc-text-on-path.md`](./rfc-text-on-path.md). User-facing DSL: [`scene-and-drawing.md`](./scene-and-drawing.md#text-on-a-path).

## TL;DR

The **runtime is already done** in the library — parsing, printing (round-trip), baking, rendering
(straight *and* animated marquee), `--check` overflow warnings. Any document that already contains
`text … along …` **renders correctly in the editor with zero changes** once you bump the dependency. What's
missing is **authoring UI**: a way to create/edit a text-on-path and to name shapes.

## What you get for free (do NOT re-implement)

From `@flatkit/types` / `@flatkit/engine` / `@flatkit/player`:

- **Model.** `Text.textPath?: TextPath` where
  ```ts
  type TextPath = {
    ref?: string          // named-shape id (`along "<id>"`); absent ⇒ inline `along path "<d>"`
    path: Path            // the baked curve glyphs follow (closed NAMED sources are top-anchored)
    start?: number        // 0..1 arc-length anchor (default 0)
    side?: 'over' | 'under'   // outside (default) / inside
    spacing?: number      // px tracking per glyph (may be negative; floored at 1px effective advance)
    startExpr?: string    // `start "<expr>"` — animated marquee (overrides start)
    spacingExpr?: string  // `spacing "<expr>"` — animated tracking (overrides spacing)
  }
  ```
  And `Region.name?: string` — a shape's `as "<id>"` handle (a **separate namespace** from behavior names).
- **Parse / print** (`@flatkit/engine` `flatFormat`): `parseProgram*`/`printProgram*` round-trip
  `along "<id>"`, `along path "<d>"`, `start`/`side`/`spacing` (literal or quoted-expression), and shape
  `as "<id>"`. If the editor serializes via the library, **serialization is already correct** — verify your
  save/load path uses `printProgramFull`/`parseProgramFull` and not a hand-rolled writer.
- **Bake / resolve.** `resolveTextPaths` (run inside `parseProgram`) resolves `along "<id>"` → bakes the
  shape outline into `textPath.path`. Inline `along path` is baked at parse. You normally don't call these
  directly — they run when a document is parsed.
- **Render.** `@flatkit/player` `drawScene` lays the glyphs (`paintTextOnPath`): align/start/side/spacing,
  closed-path wrap, open-path overflow-drop, degenerate fallback. Marquee/eased animation is resolved
  per-frame in `resolveLayerAt` (`@flatkit/engine` `cel`) — the same path as text `bind`. **If your editor
  renders frames with the library player, the marquee animates with no extra work.**
- **Lint.** `docLayoutWarnings` (`@flatkit/compiler`) emits `… overflows its path (~Npx > Lpx)`. Surface it
  wherever you already show layout warnings.
- **Geometry helpers** you may want for the UI: `makePathSampler(path)` → `{ length, closed, at(s) }`
  (arc-length → point + unit tangent) and `pathBBox(path)`, both from `@flatkit/engine/path`.

## What the editor must ADD (authoring)

### 1. Name a shape (`Region.name`)
Add a **name field** to the shape/region inspector so a user can set `as "<id>"`. Without a named shape
there's nothing for `along "<id>"` to reference. Validate against the same id grammar the parser uses
(letters/digits/`_`/`-`, starts with a letter or `_`, ≤64). **Namespace note:** a region name is *only* for
text-on-path; it deliberately does **not** make the shape an interactive behavior object (that still needs a
`group "Name"`). Don't surface region names in the behavior/object pickers.

### 2. Attach a text to a path
A command/affordance to turn a `Text` into a path-laid run. Two sources, matching the DSL:
- **`along "<id>"`** — pick an existing named shape (circle/ellipse/rect/path). The natural UX: select a
  text + a shape → "flow text along shape". Set `textPath.ref` and let the library bake on next parse, or
  bake immediately via the shape's `path` (closed → run it through `normalizeClosedForText`; open → literal).
- **`along path "<d>"`** — inline guide. Either draw a guide curve or reuse a path's `d`. Set `textPath.path`
  directly (baked **literally** — no top-anchoring; the user owns start/direction). No `ref`.

When `textPath` is set, the run ignores `transform`/`box`/`wrap` for layout — hide or disable those controls.

### 3. Inspector controls (when `textPath` is present)
- **`align`** left/center/right (reuse the existing text-align control). ⚠️ On an **open** path, `start 0` +
  `center`/`right` pushes the run off the near end (glyphs dropped) — default a centered open-path run to
  `start 0.5`, or nudge the user there. Closed paths wrap, so `start 0` already centers over the top.
- **`start`** 0..1 slider. Offer a **"marquee"** toggle that swaps the literal for an expression
  (`start "time * 0.1"`) → write `startExpr`. (Same expression scope as `bind`: `time`, `frame`, `clock`,
  vars.)
- **`side`** over/under toggle (outside / inside).
- **`spacing`** px stepper (allow negatives); optional "animate" → `spacingExpr`.
- Editing a literal clears the matching `*Expr` and vice-versa — they're mutually exclusive in authoring
  (the printer prefers the expression when both somehow exist).

### 4. Bounding box / hit-test / selection
Path-laid text has `box = {0,0}` and an identity-ish `transform`, so your existing text bbox (derived from
`box`) is **wrong** for selection/marquee/snapping. For a `Text` with `textPath`, compute the bbox from the
**path extent** inflated by the font size: `pathBBox(textPath.path)` ± `size`. (The player already does this
for tint/filter isolation — mirror it for selection.) Per-glyph hit-testing isn't needed; the inflated path
bbox is enough.

### 5. Direct manipulation (nice-to-have)
- Dragging the run along the curve → adjust `start` (use `makePathSampler(path).at(s)` to map a pointer
  position to an arc fraction via the nearest point; `projectToPath` already exists for the inverse).
- Live re-measure on content/font/size change: path-laid text re-lays automatically at render; you only need
  to refresh the **bbox** (step 4), not a `box` measurement.

## Gotchas / invariants to preserve
- **Don't bake `ref` away.** Keep `textPath.ref` for round-trip/printing; the library re-bakes `path` on
  parse. If you edit the referenced shape's geometry, re-bake (re-parse, or call `normalizeClosedForText`
  for closed / raw `Path` for open) so the text follows.
- **Closed vs open / named vs inline orientation:** named closed shapes are auto top-anchored upright;
  inline `along path` is literal. Don't "fix" inline orientation — it's the manual escape hatch.
- **Marquee = non-static.** A text with `startExpr`/`spacingExpr` must redraw every frame; if your editor
  caches static layers, exclude it (the library's `isRenderStatic` already returns false for it — match that
  in any editor-side caching).
- **Serialization parity.** If the editor has its own model→text writer, add the `textPath` fields and shape
  `as`; otherwise prefer routing through the library's `printProgramFull`.

## Suggested phasing (editor side)
1. **Render-only** (free after the dependency bump): confirm imported/hand-written `along` docs display and
   animate. No UI yet.
2. **Author MVP:** shape naming (step 1) + `along "<id>"` + `start`/`align` inspector + path-bbox selection
   (step 4). Covers the bulk of the banner/badge need.
3. **Full:** `along path` inline guide, `side`, `spacing`, the marquee/eased expression toggles, drag-to-set
   `start`.
