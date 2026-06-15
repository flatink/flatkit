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
> `text "…" box W H at x,y` fails — write `text "…" at x,y box W H`. And **bare shapes
> (`circle`/`rect`/`ellipse`/`path`) can't be named** with `as` at all: to reference one from behavior,
> wrap it in a `group "Name"` (the name lives on the group).

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
