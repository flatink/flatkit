# Scene & drawing

Everything inside `scene { … }` is composition. The tree is **layers → items**; items can be shapes,
text, images, or **groups** (which nest their own layers).

```
scene {
  layer "bg"   { rect 0 0 480 320 fill #0a0e1c }
  layer "game" {
    group "Hero" at 240,160 { layer "c" { circle 0 0 30 fill #ffcc00 } }
  }
}
```

Layers stack bottom-to-top. A `layer` takes `"name"` and options (`opacity <n>`, `locked`, `hidden`).

## Shapes

Sugar primitives (normalized to a `path` on save — no need to hand-compute Béziers):

```
circle  <cx> <cy> <r>
ellipse <cx> <cy> <rx> <ry>
rect    <x> <y> <w> <h>            # · <r> for uniform rounded corners · <rx> <ry> for distinct
path    "M0 0 L10 0 L10 10 Z"      # raw SVG path data
circle  100 100 40 as "Ring"       # name a shape (right after the geometry) → addressable, e.g. text `along "Ring"`
```

### Fill, stroke, opacity

```
circle 0 0 20 fill #ff3366
path "…" fill #000 stroke #ffffff 3 cap round join round       # stroke: <color> <width> [cap] [join] [miter n] [dash a,b]
path "…" nofill stroke #888 2                                   # outline only (a line, a thread)
rect 0 0 40 40 fill #00aaff opacity 0.5                         # 0..1 (8-digit hex alpha also works)
```

### Paints (gradients)

```
fill linear(90, 0:#bdecff, 1:#2f8fe0)          # angle: 0 = →, 90 = ↓ ; stops are offset:color
fill radial(0.5, 0.5, 0.5, 0:#fff, 1:#000)     # cx, cy, r (0..1), then stops
```

### Filters

`filter` works on any item (shape, text, image, group) — no need to wrap in a group:

```
filter glow <blur> <color>
filter shadow <dx> <dy> <blur> <color>
filter blur <radius>
filter adjust <brightness> <contrast> <saturate> <hue>
```

Filters on **static** decor are cached (nearly free); on **animated** elements they recomposite every
frame — keep those small (see the [gotchas](dsl-gotchas.md) for the perf details).

## Text

```
text "Hello" font "sans-serif" size 24 align center line 1.2 color #ffffff box 200 40
text "OUTLINE" font "sans-serif" size 64 color #ffd23f stroke #e23b3b 6 join round   # outlined text
```

- `box <w> <h>` sets the text box; `align left|center|right`; `line` = line-height; `bold` / `italic`.
- `stroke <color> <width> [cap …] [join …] [miter n] [dash a,b]` outlines the glyphs (same grammar as
  paths). The stroke is drawn **behind** the fill, so the fill keeps its full weight. Accepts a gradient
  paint too (`stroke linear(…) 4`).
- **Word-wrap is opt-in**: add `wrap` to break at spaces within the box width (otherwise only explicit `\n` wraps).
- **Live text**: `text "Angle: {}°" bind "round(a)" decimals 1` evaluates the expression every frame and
  fills the `{}` slot (or replaces the whole string if there's no `{}`).
- **Stable id**: `text "…" as "myId"` lets behavior reference it via `text("myId")` (e.g. in a `send`
  payload). Without `as`, the id is auto-generated and not referenceable.

### Text on a path

Lay glyphs **along a curve** instead of a straight baseline — banners, badges, ribbons, dials:

```
text "SURF CLUB" along "Banner" align center             # follow a NAMED shape's outline
text "loop" along path "M0 80 C120 0 360 0 480 80"       # …or inline SVG path data
```

- **`along "<id>"`** follows a **named shape** (`circle`/`rect`/`ellipse`/`path … as "<id>"`). A *closed*
  named shape (circle/ellipse) anchors the run **upright, centered over the top** by default. **`along path
  "<d>"`** takes inline path data instead — baked **literally**, so you own its start/direction.
- **`align`** reuses the text alignment: `left` starts the run at the anchor, `center` centers on it,
  `right` ends on it. **`start <0..1>`** moves the anchor along the curve (fraction of its length). On an
  **open** path the anchor defaults to the start (0), so to center a label *on the path* use `align center
  start 0.5` — with `start 0`, `center`/`right` push the run off the near end and those glyphs are dropped.
  (Closed paths wrap, so `start 0` already centers over the top.)
- **`side over|under`** — which side of the curve the run sits on: `over` = outside (default), `under` = inside.
- **`spacing <px>`** — extra tracking per glyph (may be negative; the effective advance is floored at 1px).
- **Animate** by quoting the value (it becomes an expression, same scope as `bind`: `time`, `frame`,
  `clock`, vars): `start "time * 0.1"` scrolls the run along the path (**marquee** — wraps on a closed
  shape); `spacing "sin(time) * 4"` eases the tracking.
- `along` replaces `at`/`box`/`wrap` (a path-laid run is not box-wrapped). A run longer than the path drops
  its trailing glyphs, and `flatc` warns (`… overflows its path (~Npx > Lpx)`).

## Images

```
asset "logo" "logo.svg" image      # declare the media (top of file) — embedded by flatc
scene { layer "c" { image "logo" 80 80 at -40,-40 } }   # the origin is the top-left → center with at -w/2,-h/2
```

## Transforms & placement

On any group / instance / text / image:

```
at <x>,<y>                          # translation
matrix(a,b,c,d,e,f)                 # full affine
at center  ·  at center,540  ·  at 120,center        # canvas-relative anchor (resolved from `size`)
align <point> of "Name" [offset dx,dy]               # pin this item's origin onto another item's bbox
```

> **Placement & naming gotchas.** On `text`/`image`, put `at …` / `matrix(…)` / `as "…"` **right after the
> content** (the string, or `image "id" w h`), *before* style attributes (`font`/`box`/`fill`/…). So
> `text "…" box W H at x,y` fails — write `text "…" at x,y box W H`. **Shapes** name themselves with `as
> "<id>"` **right after the geometry** (`circle cx cy r as "Ring" fill …`); a named shape is addressable by
> **text-on-path** (`along "<id>"`). To drive a shape from *behavior* (clicks, `send`, drop zones), still
> wrap it in a `group "Name"` — the region name addresses geometry, the group name an interactive object.

`align` points: `center`, `top`, `bottom`, `left`, `right`, `topleft`, `topright`, `bottomleft`,
`bottomright`. It uses the target's **static** bbox (no expression channels) — placement only, no flow
layout (stack with `repeat` + `$()`, see [factoring](behavior-and-interactions.md#reuse--factoring)).

## Other item attributes

- `pivot <x>,<y>` — origin offset (the rotation/scale center).
- `tint <color> <amount>` — Flash-style tint, `amount` 0..1.
- `nohit` — stays **drawn** but ignored by hit-testing (clicks pass through). On a group, applies to the
  whole subtree. Ideal for a decorative full-screen veil.

## See also

- Animate and react → **[Behavior & interactions](behavior-and-interactions.md)**
- Reuse shapes (symbols, `repeat`, `each`) → **[Behavior & interactions → Reuse](behavior-and-interactions.md#reuse--factoring)**
