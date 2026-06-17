# RFC — Text on a path (`text … along`)

> Status: **draft / proposal** · Origin: EDU production friction **W** (curved banners, ribbons, arcs).
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
- **`spacing <px>`** *(default 0)* — extra per-glyph advance (tracking), for loose banner lettering.

`along` **replaces** `at`/`box`/`wrap` (a path-laid run is not box-wrapped). `bind "<var>"` MAY combine
with `along` (a live value rendered on a curve) — see §6.

### Alternative form (inline guide, no named shape)

```
text "surf club" guide "M0 80 C 120 0 360 0 480 80" start 0.1 …
```

`guide "<d>"` takes raw SVG path data inline (same grammar as `path "<d>"`). Useful when the curve is not
already a drawn shape. Both forms desugar to the same model field (`alongPath: Path`).

## 3. Model / types (`@flatkit/types`)

Extend `Text` with an **optional** layout descriptor (absent = today's straight text, zero behavior change):

```ts
export type TextPath = {
  ref?: string        // named-shape id (`along "<id>"`); resolved to a Path at compile time
  path?: Path         // inline guide (`guide "<d>"`) OR the resolved `ref` outline, baked into the doc
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

- **Parse**: extend the `text` leaf parser (`flatFormat.ts` `text()`) to accept `along "<id>"` / `guide
  "<d>"` + `start`/`side`/`spacing`. Mutually exclusive with `at`.
- **Resolve**: at `parseProgramFull`/compile, resolve `along "<id>"` against the scene's named shapes →
  bake `textPath.path` (the outline as a `Path`). Reuse `itemsByName` (now indexes explicit ids).
- **Print / round-trip**: emit `along "<ref>"` when `ref` is set, else `guide "<d>"`; print
  `start`/`side`/`spacing` only when non-default (same discipline as the rest of the printer). Stable
  round-trip is the acceptance bar (cf. the existing `text … as` round-trip tests).
- **`--check`**: error if `along "<id>"` names no shape; warn if the run overflows the path length (§6).

## 6. Edge cases & interactions

- **`bind "<var>"` + `along`** — a live number on a curve (e.g. a value on a dial). Allowed; the bound
  content is re-measured per frame. Cost is acceptable (short strings).
- **Overflow** — run longer than the path ⇒ drop trailing glyphs + `--check` warning
  (`text "…" overflows its path (~Npx > Lpx)`), mirroring the existing canvas-overflow warning.
- **Closed paths** (circle/ellipse) — `t` wraps mod 1; supports full-circle dial labels.
- **Degenerate path** (zero length) ⇒ fall back to straight `at 0,0` + `--check` warning.
- **`align`** reuses the existing enum; no new concept. **Animation**: `start` could later become an
  expression channel (marquee along a path) — out of scope here, noted in §8.
- **Hit-testing / bbox** — `itemBBox` for a path-text = the path's bbox inflated by font size; good enough
  for layout warnings. Precise per-glyph hit-testing is not needed (decorative text).

## 7. Scope / phasing

- **Phase 1 (MVP)**: `along "<id>"` + `start` + `align`, baked path, renderer + round-trip + `--check`
  existence error. Covers banners/ribbons/arcs — the bulk of the EDU need.
- **Phase 2**: `guide "<d>"` inline, `side`, `spacing`, overflow warning.
- **Phase 3** *(optional)*: `start` as an expression channel (marquee), `letterSpacing` easing.

## 8. Alternatives considered

- **Per-glyph `path` slicing in EDU** (status quo) — works, but verbose, brittle, and loses the text
  semantics (no `bind`, no re-flow). Rejected as the long-term answer.
- **A `warp`/displacement filter on a straight text** — cheaper to spec, but gives a *distorted* look, not
  true baseline-follows-curve typesetting. Doesn't match the "clean cutout banner" goal.
- **SVG `<textPath>` passthrough** — N/A; FlatInk renders to canvas/skia, not SVG.

## 9. Open questions

1. **Naming**: `along` vs `on` vs `follow`? (`along "<id>"` reads best.)
2. **Path source for shapes**: a `rect`/`circle` outline starts at an arbitrary point — do we expose a
   `start`-point convention, or require an explicit `path` for full control? (Lean: document the
   convention, allow `start` to compensate.)
3. **Default `side`** for closed paths (text inside vs outside a circle) — `over` = outside; confirm.
4. Should `spacing` accept a negative value (tightening)? (Probably yes, clamp to a sane floor.)

## 10. Test plan

- `flatFormat.test.ts` — parse + **stable round-trip** of `along`/`guide` + non-default `start/side/spacing`.
- `path.test.ts` — already covers `samplePathAt`; add a glyph-layout helper unit test (arc positions).
- `drawScene.test.ts` — a path-text renders N glyphs at expected transformed positions (skia/headless).
- `programDoc.test.ts` — `--check`: unknown `along` id → error; run-overflows-path → warning.
