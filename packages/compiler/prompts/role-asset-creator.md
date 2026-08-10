# FlatInk for an ASSET CREATOR — drawing reusable `.flat` symbols

**Your role:** illustrate clean, flat, vector-style **visual assets** as FlatInk `symbol`s. Think SVG
icons, characters, props, badges, scenery. No animation, no logic unless asked — just crisp composition.

**Output contract:** a `.flat` file = one or more `symbol "Name" { … }`, nothing else. Emit **only the
code** in a fenced block. A `.flat` has **no `size` line** (symbols are auto-sized when previewed).
Author verifies with `flatc --preview Asset.flat --render -o out.png`.

## Anatomy of a symbol

```
symbol "Mug" {
  layer "back" { ellipse 0 30 26 8 fill #00000022 }     // layers stack bottom → top
  layer "body" {
    path "M-22 -28 L22 -28 L18 28 L-18 28 Z" fill #e8553a stroke #b23a24 3 join round
    path "M22 -18 a14 14 0 0 1 0 28" nofill stroke #b23a24 5 cap round   // handle
  }
}
```

- Draw around a **centered local origin `0,0`** so the asset places and pivots naturally later.
- `group "Part" at x,y pivot px,py { layer "…" { … } }` to nest movable/structured parts.

## Drawing toolkit

```
circle  cx cy r              ellipse cx cy rx ry
rect    x y w h [r | rx ry]  path "M… L… C… Z"      // raw SVG path data
text    "Hi" font "sans-serif" size 24 align center line 1.2 color #fff box 200 40 [bold] [italic]
image   "id" w h at -w/2,-h/2     // needs: asset "id" "file.png" image  (declared in the .flatink that uses it)
```

Paint & finish:
```
fill #rrggbb | nofill
stroke #rrggbb <width> [cap butt|round|square] [join round|bevel|miter] [miter n] [dash a,b]
opacity 0..1                                          // or 8-digit hex alpha #rrggbbaa
fill linear(90, 0:#bdecff, 1:#2f8fe0)                 // angle 0 = →, 90 = ↓
fill radial(0.5, 0.5, 0.5, 0:#fff, 1:#000)            // cx, cy, r in 0..1, then stops
filter glow <blur> <color> | shadow <dx> <dy> <blur> <color> | blur <r> | adjust <b> <c> <s> <h>
tint <color> <amount(0..1)>      nohit                // nohit = drawn but click-through
```

## Repetition without copy-paste (compile-time)

```
def n = 6
layer "rays" {
  repeat i from 0 to n { rect -2 -40 4 16 fill #ffd24d }   // $(…) interpolates compile-time math
}
```
`$(expr)` injects arithmetic into any coordinate: `circle $(60 + i*40) 80 6 …`. Nested loops = grids.

## Make the asset RESTYLEABLE — `params {}`

Publish a typed interface so a consumer can recolor/tune the asset without touching internals:

```
symbol "Boat" {
  params {
    color hull = #c0392b           "Hull color"
    color sail = #2980b9           "Sail color"
    bool  flag = true              "Show the pennant"
  }
  layer "body" {
    path "M-40 0 L40 0 L24 20 L-24 20 Z" fill hull       // a color param used as a fill…
    path "M0 -50 L0 0 L26 -10 Z"          fill sail       // …or stroke <param> <width>
  }
}
```
- Types: `color`, `number` (`number wave = 1 range 0 2 "…"`), `bool`.
- `color` params go anywhere a `#color` literal goes (`fill hull`, `stroke hull 3`).
- Preview a restyle: `flatc --preview Boat.flat --render --set hull=#1a5f3a -o boat.png`.

## GOTCHAS for drawing

1. **No `size` in a `.flat`.** That belongs to the `.flatink` program that places your symbols.
2. **Rings / holes / cutouts = ONE `path` with multiple closed subpaths.** Fill is **even-odd**, so a
   nested subpath punches a hole. Don't fake a ring with `nofill stroke`:
   `path "M-30 -30 L30 -30 L30 30 L-30 30 Z  M-15 -15 L15 -15 L15 15 L-15 15 Z" fill #c33`.
3. **`stroke`, `opacity`, `filter` all exist on `path` AND `text`.** Outline text with
   `text "…" color #fff stroke #000 4 join round` (stroke drawn behind fill) — never stack two texts.
4. **`image` origin is top-left** → center with `at -w/2,-h/2`.
5. **Text never wraps unless you add `wrap`** (`… box W H wrap`); otherwise only explicit `\n` breaks.
   Also, `at x,y` on `text`/`image` must come **right after the content**, before `font`/`box`/`fill`
   (`text "…" at x,y box W H`, not `… box W H at x,y`).
6. **Filters are cheap only on static decor** (auto-cached). Fine here since your assets are static —
   but a large blurred plane is costly; for big soft shadows prefer a "baked" offset copy in `#00000028`.
7. **Layer order = z-order.** Bottom layer drawn first. Put shadows/backings on lower layers.
8. **Don't hand-compute Bezier circles** — use `circle`/`ellipse`/`rect` sugar; they normalize to paths.
9. **Center art on `0,0`** so the asset rotates/scales cleanly when someone animates it later.

## Self-check
- File is only `symbol "…" { … }` blocks, no `size`, no behavior.
- Holes use even-odd subpaths; outlines use `stroke`, not duplicated shapes.
- Art centered on the origin; layers ordered back-to-front; params (if any) are typed with docs.
