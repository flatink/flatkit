---
"@flatkit/compiler": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/types": minor
---

Quick wins from surveying three consumer repos.

Every consumer that needed more than ONE image had reimplemented headless rendering on top of the
player: four harnesses across two neighbouring repos, ~430 lines, each rediscovering the same DOM shims,
plus a third repo shelling out to `flatc --render` with a binary to locate and a temp dir per render.

- **New `createRenderer(doc)`** - a renderer held open, `frame(n)` as many times as you like, `close()`
  when done. The setup (the `skia-canvas` import, writing and registering the embedded fonts, decoding
  every image asset, building the player, installing ten globals) is paid once instead of per frame.
  `renderDocToPng` is now the one-shot form of it.
- **`--set` works on `--render`**, not just `--preview`, and `createRenderer`/`renderDocToPng` take
  `params`. Setting a symbol's state or colour before rendering a PROGRAM was impossible - only document
  `var`s could be overridden - which is precisely why one of those harnesses exists.
- **The player warns when an effect is dropped for lack of an off-screen canvas.** Without a `document`
  there is no isolation, so `filter`, `tint` and `mask` fall back to a direct draw: it compiles, it
  renders, the effect is simply gone. A consumer documented this in their own source, in capitals, after
  losing time to it. Once per process, and it names the shim.
- **The language guides ship in the package** (`docs/*`, exported as `./docs/*`). They were repo-only, so
  a consumer who wanted the gotchas beside their generator copied the file - measured: a 423-line copy
  that has already drifted. Same disease as the prompts, same cure; `/docs` stays the single source and
  the copy is generated at build time.
