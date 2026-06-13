# CLI example — the "modern SWF" on the command line

The VSCode-first flow: you edit **text sources**, you **compile** them into a single `.flatpack` file
that the player runs.

```
examples/cli/
├── scene.flatink    ← the PROGRAM (composition + logic, DSL)
├── hero.flat        ← a visual ASSET lib (exported by the editor)
├── logo.svg         ← a MEDIA file referenced by the program
├── physics.flatink  ← a function PACKAGE (use "physics")
└── shapes.flat      ← a symbol PACKAGE (use "shapes")
```

## Compile

From the repo root:

```bash
pnpm flatc examples/cli/scene.flatink -o examples/cli/scene.flatpack
```

- the `*.flat` libs in the folder are **discovered automatically** (or passed as arguments);
- media declared by `asset "id" "path" kind` are **embedded** (path → data-URI);
- the output `scene.flatpack` is the baked `Doc`, directly **playable** by the player.

```
flatc: scene.flatpack ✓  2 symbol(s) · 2 lib(s) · 2 package(s) · 1 media
```

Full usage: `pnpm flatc --help`. The binary is also exposed under the name `flatc`
(`packages/compiler` → `bin/flatc.mjs`) for `npx` use.

## Preview a single asset (`--preview`)

A `.flat` is a symbol **library**, not a playable document — the player runs a `Doc`. To eyeball one
asset (with its own timeline, nested symbols and all) without hand-authoring a wrapper `.flatink`,
`--preview` wraps a symbol into a minimal playable `Doc`: a single instance, centered on a stage
auto-sized to the symbol's bounds.

```bash
pnpm flatc examples/cli/hero.flat --preview -o hero.flatpack   # → a .flatpack to drop in the player
pnpm flatc examples/cli/hero.flat --preview --render -o hero.png --frame 12   # → a PNG snapshot
```

- `--symbol NAME` picks which symbol to wrap (default: the first in the lib; the others are listed);
- `--pad N` sets the padding around the symbol (default 24px — absorbs motion that overshoots the
  frame-0 bounds);
- with `--render`, the usual `--frame` / `--scale` / `--at` / `--steps` apply (the symbol's own
  timeline plays as the root frame advances). Output defaults to `<library>.<symbol>.flatpack` / `.png`.

## Packages (`use "…"`)

A program imports reusable code with `use "name"`. Resolution order (the v1 "registry"):

1. **embedded stdlib** — `use "collision"` (boxHit/dist/near), `use "easing"`, `use "gesture"`
   (snap/rail/angle…), `use "feedback"` (lift/dim/tilt/sink/shake). Referenced in the `.flatpack`
   and resolved by the player at load time.
2. **local file** — `use "physics"` → `flatc` reads `physics.flatink` (functions) and/or
   `physics.flat` (symbols) from the folder, and **inlines** them into the `.flatpack` (standalone).

Functions are available both **bare** (`tick(score)`) AND **qualified** (`physics.tick(score)`,
`collision.boxHit(…)`) — the qualified form resolves name collisions between packages. Imported
symbols are instantiable by name (`instance "Star" as "deco"`). See `cli/physics.flatink` + `cli/shapes.flat`.

## Root timeline (`timeline <fps> <dur>`)

At the top of a program (before `scene {`), `timeline 30 300` sets the rate and duration of the root
timeline (otherwise: 24 fps / 60 implicit frames). Handy for a long seamless loop or an ambience that
does not loop back at 60 frames. E.g.: `size 400 200` / `timeline 30 300` / `scene { … }`.

## Action `sound "id"`

Inside a behavior handler (`object "x" { when clicked { sound "ping" } }`), `sound "<assetId>"`
triggers a one-shot audio clip — a complement to clips placed on the timeline (`sound "x" at N`).

## Non-interactive item (`nohit`)

A `nohit` suffix on any item (`path … nohit`, `text … nohit`, `group … nohit`, etc.) → it stays
**drawn** but the player's hit-test **ignores** it (clicks/hover pass through to the clickable item
below). Ideal for a full-screen decorative veil/frame, without having to lower the opacity. On a
container, `nohit` makes its whole subtree non-interactive.

## Stable text id (`text "…" as "<id>"`)

To target a Text item by id (from `send "ev", text("<id>")` or from a host like Moiki), set it at
write time: `text "Hello" as "txt_greeting" at 20,100 size 32 color #fff box 200 40`.
Without `as`, the id is auto-generated (unstable, not referenceable). The asymmetry is deliberate: on
`instance`, `as` sets the **name** (ref by name); on `text`, `as` sets the **id** (ref by id, `findText`).

## The editor's role: GENERATOR

These sources are produced from the editor via **"Export sources (code)"** (project menu),
which outputs a readable `.flatsrc` bundle. `exportFlatProject(doc)` (in `@flatkit/compiler`) does the
Doc → `{ flat, flatink, media }` conversion; `compileFlatpack(program, flatLibs, media)` does the
reverse path. The round trip is proven stable (see `compile.test.ts`, `flatc.test.ts`).
