# RFC — Text on a path (`text … along`)

> Status: **Phases 1, 2 & 3 shipped on branch `curved-text`** (§9 decisions locked; RFC fully implemented) ·
> Origin: EDU production friction **W** (curved banners, ribbons, arcs).
> Author: agent-assisted. Scope: `@flatkit/types`, `@flatkit/engine`, `@flatkit/player`, `@flatkit/compiler`.

## 1. Motivation

A straight `text` plastered on a curved shape (banner, pennant, ribbon, arc, dial) reads as "cheap":
e.g. `surf club` set dead-straight across a wavy banner. Today `text` only supports `at X,Y` + `align`
+ `box`/`wrap` — **no curvature**. Curved banners are everywhere in the paper-cutout target style, so the
gap shows up constantly. The only workaround is painful (slice the word into per-glyph `path`s, or accept
the straight look).

This RFC proposes **text laid out along a path**, the FlatInk analogue of SVG `textPath` / "text on a
path".

## 2. Proposed syntax

A new trailing clause on the `text` leaf, mutually exclusive with `at`:

```
text "surf club" along "Banner" [start <0..1>] [side over|under] [spacing <px>] \
     font "…" size 36 align center color #fff
```

- **`along "<id>"`** — the path the glyphs follow. `<id>` references a **named path/shape in the same
  scene** (a `path "…" as "Banner"`, or a `circle/rect/ellipse as "…"` — their outline is a path). This
  reuses the existing `as "<id>"` leaf-id namespace (cf. friction S fix: leaves are now addressable by id).
- **`start <0..1>`** *(default 0)* — arc-length offset where the text begins (fraction of total length).
- **`align`** *(reuse existing)* — `left` = start at `start`; `center` = center the run around `start`;
  `right` = end at `start`. (Maps cleanly to the offset math; no new keyword.)
- **`side over|under`** *(default `over`)* — which side of the path the baseline sits on (flip the normal).
  For a closed path, `over` = **outside** (normal points away from the centroid), `under` = inside.
- **`spacing <px>`** *(default 0)* — extra per-glyph advance (tracking), for loose banner lettering. May be
  **negative** (tightening); the model stores the raw value and layout clamps the *effective* per-glyph
  advance to a ≥1px floor (no reversal / total overlap).

`along` **replaces** `at`/`box`/`wrap` (a path-laid run is not box-wrapped). `bind "<var>"` MAY combine
with `along` (a live value rendered on a curve) — see §6.

### Alternative form (inline path data, no named shape)

```
text "surf club" along path "M0 80 C 120 0 360 0 480 80" start 0.1 …
```

`along path "<d>"` takes raw SVG path data inline (reuses the existing `path "<d>"` literal grammar). Useful
when the curve is not already a drawn shape. `along` is thus **one keyword with two operand forms** —
`along "<id>"` (named ref) or `along path "<d>"` (inline) — rather than a separate `guide` keyword (which
already prefixes a guide *layer*). Both desugar to the same model field (`textPath.path`).

## 3. Model / types (`@flatkit/types`)

Extend `Text` with an **optional** layout descriptor (absent = today's straight text, zero behavior change):

```ts
export type TextPath = {
  ref?: string        // named-shape id (`along "<id>"`); resolved to a Path at compile time
  path?: Path         // inline (`along path "<d>"`) OR the resolved `ref` outline, baked into the doc
  start?: number      // 0..1 arc-length offset (default 0)
  side?: 'over' | 'under'   // default 'over'
  spacing?: number    // extra px per glyph (default 0)
}
export type Text = {
  // … existing fields …
  textPath?: TextPath   // present ⇒ lay glyphs along `path`; `transform`/`box`/`wrap` ignored
}
```

Resolution choice (compile time): **bake the referenced path into `textPath.path`** so the player/runtime
needs no scene lookup and the `.flatpack` stays self-contained (consistent with how instances resolve
symbol refs by name at compile time). Keep `ref` for round-trip/printing only.

## 4. Renderer (`@flatkit/player` — `paintText`)

The engine already exposes everything needed:

- `samplePathAt(path, t) → { point, tangent }` (`packages/engine/src/path.ts:175`) — arc-length sampling +
  tangent. This is the core primitive.
- `pathToPolygons` / total length via the same arc-length machinery — for the per-run length.
- Canvas `measureText` — per-glyph advance.

Algorithm (per glyph, in `paintText` when `t.textPath` is set):

1. Measure each glyph's advance (`ctx.measureText(g).width`) → cumulative arc positions, summed with
   `spacing`. Compute the run's total advance `W`.
2. Resolve the start offset in arc-length: `align` + `start` → `s0` (e.g. center ⇒ `s0 = start*L - W/2`).
3. For each glyph at cumulative arc `s`: `t = clamp((s0 + s + adv/2) / L, 0, 1)`; `{point, tangent} =
   samplePathAt(path, t)`. Rotate the canvas to `atan2(tangent.y, tangent.x)` at `point`, offset along the
   normal by the baseline (flipped for `side: 'under'`), `fillText(glyph, 0, 0)` with `textAlign:'center'`.
4. Restore. Stroke/weight/italic/color reuse the existing `paintText` setup.

Glyphs that fall off the path end (`t` clamped) are dropped or clamped — pick **drop** to avoid pile-ups
(and surface a `--check` warning when the run is longer than the path, see §6).

Headless skia render (`flatc --render`) shares `paintText`, so it works there too.

## 5. Compiler (`@flatkit/compiler` + `flatFormat`)

- **Parse**: extend the `text` leaf parser (`flatFormat.ts` `text()`) to accept `along "<id>"` / `along
  path "<d>"` + `start`/`side`/`spacing`. Mutually exclusive with `at`.
- **Resolve**: at `parseProgramFull`/compile, resolve `along "<id>"` against the scene's named shapes →
  bake `textPath.path` (the outline as a `Path`). Reuse `itemsByName` (now indexes explicit ids). For a
  **closed** *named* source (circle/ellipse/closed custom), normalize the baked outline to start at the
  **topmost point** (min-y; leftmost on tie), oriented so the **tangent there points +x** (text reads
  left→right, upright over the top) — see §6. Open named sources are baked **literally**, and `rect` is a
  no-op (already top-left, clockwise). **Inline `along path "<d>"` is *always* baked literally** — open or
  closed — since the author hand-wrote the baseline and owns its start/direction (the escape hatch for full
  control). So the top-anchor heuristic applies to **named** sources only.
- **Print / round-trip**: emit `along "<ref>"` when `ref` is set, else `along path "<d>"`; print
  `start`/`side`/`spacing` only when non-default (same discipline as the rest of the printer). Stable
  round-trip is the acceptance bar (cf. the existing `text … as` round-trip tests).
- **`--check`**: error if `along "<id>"` names no shape; warn if the run overflows the path length (§6).

## 6. Edge cases & interactions

- **`bind "<var>"` + `along`** — a live number on a curve (e.g. a value on a dial). Allowed; the bound
  content is re-measured per frame. Cost is acceptable (short strings).
- **Overflow** — run longer than the path ⇒ drop trailing glyphs + `--check` warning
  (`text "…" overflows its path (~Npx > Lpx)`), mirroring the existing canvas-overflow warning.
- **Closed paths** (circle/ellipse) — the baked outline is **re-anchored at the topmost point and oriented
  so its tangent there points +x**, so a label arches **upright** over the top by default (`ellipsePath`'s
  raw start is the *west* point winding through the *bottom* — a naive default would render top labels
  upside-down). `start` then offsets clockwise from the top; `side under` puts the run inside. This
  reparameterization is for the textPath bake **only** — fills/strokes keep `ellipsePath` as-is. The
  trigger is path **closed-ness** (the bake sees a resolved `Path`, not the original primitive), which is
  exactly circle/ellipse/closed shapes; `rect` already starts top-left clockwise so it is a no-op. `t`
  wraps mod 1; supports full-circle dial labels.
- **Degenerate path** (zero length) ⇒ fall back to straight `at 0,0` + `--check` warning.
- **`align`** reuses the existing enum; no new concept. **Animation**: `start` could later become an
  expression channel (marquee along a path) — out of scope here, noted in §8.
- **Hit-testing / bbox** — `itemBBox` for a path-text = the path's bbox inflated by font size; good enough
  for layout warnings. Precise per-glyph hit-testing is not needed (decorative text).

## 7. Scope / phasing

- **Phase 1 (MVP)** — ✅ **shipped** (branch `curved-text`): `along "<id>"` + `start` + `align`, baked path
  (closed sources top-anchored, cf. §6), renderer + stable round-trip. Covers banners/ribbons/arcs — the
  bulk of the EDU need. Two notes vs. the original sketch:
  - **Prerequisite added**: shapes were not addressable, so `<shape> as "<id>"` (name on a `Region`) landed
    as part of this phase — that's what `along "<id>"` resolves against.
  - **Unknown-id is a hard error** thrown at resolve time (`along: shape not found: …`), mirroring
    `resolveAligns` — stronger than the proposed `--check` warning, so no `--check` wiring was needed.
- **Phase 2** — ✅ **shipped** (branch `curved-text`): `along path "<d>"` inline (baked literally), `side
  over|under` (outside/inside, glyphs upright — at the top; the bottom of a closed loop is inherently
  inverted, as with SVG `textPath`), `spacing` (tracking, negative allowed, effective advance floored at
  1px), and the overflow `--check` warning (`text "…" overflows its path (~Npx > Lpx)`). Path-laid text is
  excluded from the canvas/box-overflow checks.
- **Phase 3** — ✅ **shipped** (branch `curved-text`): `start "<expr>"` and `spacing "<expr>"` are animated
  channels (quoted = expression, bare = literal). `start "<expr>"` scrolls the run along the path (marquee;
  wraps on a closed path); `spacing "<expr>"` eases the tracking. Evaluated per frame in `resolveLayerAt`
  (same path as text `bind`), so the renderer stays purely numeric; animated path-text is flagged
  non-`isRenderStatic` so the cache redraws it each frame.

## 8. Alternatives considered

- **Per-glyph `path` slicing in EDU** (status quo) — works, but verbose, brittle, and loses the text
  semantics (no `bind`, no re-flow). Rejected as the long-term answer.
- **A `warp`/displacement filter on a straight text** — cheaper to spec, but gives a *distorted* look, not
  true baseline-follows-curve typesetting. Doesn't match the "clean cutout banner" goal.
- **SVG `<textPath>` passthrough** — N/A; FlatInk renders to canvas/skia, not SVG.

## 9. Resolved decisions

*(settled 2026-06-18 on branch `curved-text`)*

1. **Naming → `along`.** Reuses the existing DSL keyword (`trace <p> along <Path>`, `dsl.ts:951`) for
   "follow a path": grammatically consistent, no collision (different grammar position), reads best. The
   inline form is **`along path "<d>"`** — one keyword `along` with two operands (`"<id>"` ref or
   `path "<d>"` inline) — *not* a separate `guide` keyword, which already prefixes a guide **layer**.
2. **Path source for shapes → top-anchored, tangent-points-+x for closed *named* sources.** A baked
   **closed named** outline (circle/ellipse/closed custom path) is re-anchored at its **topmost point**,
   oriented so the tangent there points **+x**, so a label sits **upright** over the top with no magic
   offset (`ellipsePath`'s raw start is the west point, winding through the bottom — a naive default renders
   top labels upside-down). `start` offsets clockwise from there. **Open** named sources keep their literal
   direction; `rect` is a no-op (already top-left clockwise). The trigger is closed-ness because the bake
   only sees a resolved `Path`. **Inline `along path "<d>"` is always literal** (open or closed) — the
   author hand-wrote the baseline, so name a shape for the ergonomic default or write raw `path` data for
   full control. Reparam affects the textPath bake only — fills/strokes untouched. (§5 resolve, §6.)
3. **Default `side` → `over` = outside.** For a closed path, `over` puts the baseline outside (normal away
   from the centroid), `under` inside. Confirmed.
4. **`spacing` accepts negatives.** Tightening allowed; the model stores the raw value, and layout clamps
   the **effective per-glyph advance** to a ≥1px floor so glyphs never reverse or fully overlap. (§2.)

## 10. Test plan

- `flatFormat.test.ts` — parse + **stable round-trip** of `along "<id>"` / `along path "<d>"` + non-default
  `start/side/spacing`.
- `path.test.ts` — already covers `samplePathAt`; add a glyph-layout helper unit test (arc positions).
- `drawScene.test.ts` — a path-text renders N glyphs at expected transformed positions (skia/headless).
- `programDoc.test.ts` — `--check`: unknown `along` id → error; run-overflows-path → warning.
