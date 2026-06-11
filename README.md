# flatkit

[![CI](https://github.com/zwykstudio/flatkit/actions/workflows/ci.yml/badge.svg)](https://github.com/zwykstudio/flatkit/actions/workflows/ci.yml)

**The open language, compiler, and player for the [FlatInk](http://flatink.zwyk-studio.com/) animation format** — a modern, web-native take on the "one file that just plays" idea behind the old SWF.

Write a scene as readable text, compile it to a single self-contained `.flatpack`, and play it in any `<canvas>` with a runtime small enough to drop into someone else's bundle. Animations *and* interactivity — drags, drop zones, scratch-to-reveal, connect-the-dots, physics, sound — all in plain data, no plugin, no black box.

> **Status: beta.** The packages and the `.flatpack` format are still moving; expect breaking changes (and tell us when something feels wrong).

## ✨ Prefer to draw? Meet the FlatInk editor

The fastest way in is the visual studio: **[flatink.zwyk-studio.com](http://flatink.zwyk-studio.com/)**.

Draw shapes, key your timeline, wire up interactions by clicking — then **export to the open `.flatpack`** that this toolchain compiles and plays. The editor is the friendly front door; **flatkit is the code-first half** of the same format: author by hand, generate from a script or an LLM, diff it in git, test it in CI. Same `.flatpack` either way — pick the workflow that fits the moment.

## What you can build

- **Animations** — timelines, tweens, motion paths, morphs, easing, filters (glow/shadow), gradients.
- **Interactive scenes** — `drag`/drop, `turn` (dials), `trace` (follow a path), `reveal` (scratch cards), `link` (connect pairs), plus per-frame logic (`every frame`) and a tiny expression language.
- **Things that ship anywhere** — one `.flatpack` JSON, media embedded as `data:` URIs (or served as local files), played by a runtime with no editor and no heavy dependencies.

## Packages

| Package | What it does |
|---|---|
| [`@flatkit/types`](packages/types) | Shared types for the format (`Doc`, `Layer`, `Item`, …). The leaf of the graph: zero runtime, zero dependencies. |
| [`@flatkit/engine`](packages/engine) | The pure core — model evaluation, expressions, timeline, geometry, layers. No canvas, no clipper. Shared by the compiler and the player. |
| [`@flatkit/compiler`](packages/compiler) | The language (parser + AST) and the compiler (`.flatink` → `.flatpack`). Ships the `flatc` CLI. |
| [`@flatkit/player`](packages/player) | A tiny runtime that plays a `.flatpack` in a `<canvas>`. No editor, no heavy dependencies. |

### Why the split

The **player** must stay tiny — it gets embedded in third-party bundles — so it never pulls in the compiler. The **compiler** is bigger and lives in build/CLI tools. **engine** is the shared core, **types** the common leaf. The boundary is enforced in CI: the public packages never import editor-only or heavy code.

## Install

```sh
pnpm add @flatkit/player        # play a .flatpack
pnpm add -D @flatkit/compiler   # the flatc CLI
```

## Quick taste

Write a program, compile it, play it:

```sh
flatc scene.flatink -o scene.flatpack          # text sources → one playable file
flatc scene.flatink --render -o frame.png       # headless PNG (see what you draw)
flatc scene.flatink --play --script gestures.json   # headless replay + assertions (great in CI)
```

```js
import { FlatPlayer } from '@flatkit/player'
const player = new FlatPlayer(canvas, doc, { autoplay: true })
```

See [`examples/cli`](examples/cli) for an end-to-end project, and [`docs/dsl-gotchas.md`](docs/dsl-gotchas.md) for the hands-on DSL reference (everything learned the hard way, then fixed or written down).

## Development

```sh
pnpm install
pnpm verify      # lint + english check + typecheck + tests
```

The four packages (`types`, `engine`, `compiler`, `player`) are in place and tested; the `.flatpack` format and public APIs are still moving (beta), so expect breaking changes.

## Security

A `.flatink` program or a `.flatpack` document is **untrusted input**. The toolchain hardens the two boundaries accordingly: path confinement when compiling, `data:`-only assets (with an opt-in same-origin resolver for local files), and bounded per-tick work and recursion in the player. See [SECURITY.md](SECURITY.md) for the threat model and how to report an issue.

## License

[MIT](LICENSE) © [Zwyk Studio](http://flatink.zwyk-studio.com/)
