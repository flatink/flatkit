# Tooling — the `flatc` CLI

`flatc` compiles `.flatink` text into a single `.flatpack`, and helps you **see**, **test**, and
**ship** scenes. Install with `pnpm add -D @flatkit/compiler` (or `pnpm flatc …` in this repo).
`flatc --help` lists everything.

## Files

| File | What |
|---|---|
| `.flatink` | the program (composition + behavior, the DSL) |
| `.flat` | a visual asset library (symbols), exported by the editor |
| `.flatpack` | the baked, playable `Doc` (JSON) — what the player runs |

```
flatc game.flatink hero.flat -o game.flatpack
```

`.flat` libs in the program's folder are discovered automatically; media declared by
`asset "id" "path" kind` are embedded as `data:` URIs.

## Compile & check

```
flatc <program.flatink> [-o out.flatpack]
flatc <program.flatink> --check      # semantic lint only (exits ≠0 on ERROR; warnings don't block)
flatc <program.flatink> --watch      # recompile on every change in the folder
```

`--check` also covers approximate **layout** warnings: text overflowing the canvas, clipped items,
missing/overlapping drop zones, never-used variables, and a `color` param used as a paint (a `fill`/`stroke`,
a gradient stop `0:teinte@…`, or a `tint`) that the symbol doesn't declare — a silent "dead recolor".

## See what you draw — `--render`

Render a PNG (skia backend, faithful to the browser). Needs the optional `skia-canvas` dep
(`npm i -D skia-canvas`).

```
flatc <file> --render -o out.png [--frame N] [--at k=v[,k2=v2]] [--steps N] [--scale S]
```

- `--frame N` target frame · `--scale S` resolution factor.
- `--at score=3,step=2` forces variables → capture a precise state.
- **`--steps N`** runs N fixed simulation steps (`every frame`, 60 Hz) *before* capture, so a stateful
  act unfolds on its own — no need to force every derived ramp variable by hand.
- **Embedded fonts render too**: any `asset "id" "font.woff2" font` is registered with skia before
  capture, so text uses the authored face (matched by the font's intrinsic family name — the same name
  you put in `text … font "…"`) instead of a host fallback. `.woff2/.woff/.ttf/.otf` are all supported;
  flatc prints the registered families to stderr.
- **Font family alias**: add a quoted name after `font` — `asset "id" "font.woff2" font "Quicksand"` —
  to register the face under *that* family instead of the file's intrinsic one. Use it when a font's
  name table is wrong (e.g. a variable-font static export skia reads as `… Thin/Light`), so the alias
  matches the `text … font "Quicksand"` you authored. Browsers ignore it (they bind families via
  `FontFace`); it only steers headless `--render`.

## Preview a `.flat` symbol — `--preview`

Wrap ONE symbol of a `.flat` library into a playable, auto-sized Doc — no hand-authored wrapper. Outputs a
`.flatpack` (drop it in the browser player) or, with `--render`, a PNG.

```
flatc --preview <library.flat> [--symbol NAME] [-o out.flatpack | --render -o out.png]
                [--bbox all|frame0] [--pad N] [--set p=v[,p2=v2]] [--frame N] [--scale S]
```

- `--symbol NAME` picks the symbol (default: the first; others are listed on stderr).
- **`--bbox all`** (default) auto-sizes to the UNION of bounds over every frame (sub-timelines unfrozen),
  so drifting/rotating/growing motion is never clipped. `--bbox frame0` is the old frame-0-only measure;
  `--pad N` adds a margin (default 24).
- **`--set p=v`** sets the symbol's exposed [params](animating-symbols.md#exposed-parameters-params): a
  `color` (`hull=#1a5`), a `number`/`bool` (`wave=1.5`), or a `state` by name (`door=open`). Baked into the
  preview (flatpack + render).
- **`--scale auto`** picks the render factor from the symbol's size — enlarges small/thin assets (so a fine
  filament stays legible) and leaves large ones at 1×. Otherwise `--scale S` (default 2).

## Media packing — `--assets`

```
flatc <file> --assets inline      # default: media embedded as data: URIs → one portable .flatpack
flatc <file> --assets external    # asset.data = relative key + a sidecar <out>.assets/ folder
```

Use `external` for big media you don't want inflating the JSON; serve the folder and play with
`sameOriginAssetResolver(<flatpackUrl>)` (see `@flatkit/player`).

## Headless play — `--play`

Run a scene **without a canvas**, replay a gesture script, and print `{ sends, vars }` — great in CI.

```
flatc <file> --play --script gestures.json [--trace]
```

**Prefer semantic gestures** (by object NAME — robust, the engine resolves coordinates):

```json
[
  { "type": "drag",    "source": "Card1", "target": "ZoneA" },
  { "type": "tap",     "target": "Button" },
  { "type": "scratch", "target": "Cover1" },
  { "type": "connect", "source": "Word",  "target": "Picture" },
  { "type": "wait",    "frames": 30 },
  { "type": "expect",  "sends": ["win"], "vars": { "score": 3 } }
]
```

- `drag` / `tap` / `scratch` (sweeps a `reveal` zone) / `connect` (pulls a `link` wire) — by name.
- `set` drives a variable from the host; `wait` runs N fixed 60 Hz steps (advances `every frame` physics).
- **`expect`** turns the script into a test: it compares the `send`s emitted since the last `expect` and
  the current vars, and makes `--play` **exit ≠0** on mismatch. No more eyeballing.
- Low-level gestures (`down`/`move`/`up`/`cancel` with `x,y`) remain for special cases.
- `--trace` prints a human-readable log per gesture (emitted sends + variable diff) instead of JSON.

### Recording

In the player, `player.startRecording()` / `stopRecording(): Gesture[]` capture gestures you play by
hand into a script that `--play` replays. (Authoring/CI helpers live in `@flatkit/player/debug`.)

## See also

- The language itself → **[Scene & drawing](scene-and-drawing.md)** · **[Behavior & interactions](behavior-and-interactions.md)**
- Pitfalls & best practices → **[Gotchas](dsl-gotchas.md)**
