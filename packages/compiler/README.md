# @flatkit/compiler

The [FlatInk](http://flatink.zwyk-studio.com/) language (parser + AST) and compiler: turn readable
`.flatink` text into a single self-contained `.flatpack`. Ships the **`flatc`** CLI. Lives in build/CLI
tooling — the [player](https://www.npmjs.com/package/@flatkit/player) stays tiny and never pulls it in.

## Install

```sh
pnpm add -D @flatkit/compiler
```

## CLI

```sh
flatc scene.flatink -o scene.flatpack             # text sources -> one playable file
flatc scene.flatink --render -o frame.png          # headless PNG preview (needs skia-canvas 4)
flatc scene.flatink --play --script gestures.json  # headless replay + assertions (CI)
```

## Programmatic

```ts
import { compileFlatpack } from '@flatkit/compiler/compile'

const doc = compileFlatpack(programSrc, assetSrcs, media) // -> Doc (the .flatpack)
```

`checkProgram(src, { assetSrcs })` runs the whole `flatc --check` pass on a string; `docToManifest`,
`llmContext`, `languageCard` and `drawingCard` (the scene map and the reference cards for a model) are on
the root entry too. `@flatkit/compiler/analysis` holds the lint and scope-program helpers,
`@flatkit/compiler/render` the headless renderer (`createRenderer`, `renderDocToPng`; needs the optional
peer `skia-canvas` 4), and the guides and prompts ship as files under `@flatkit/compiler/docs/*` and
`@flatkit/compiler/prompts/*`.

## License

[MIT](https://github.com/flatink/flatkit/blob/main/LICENSE) (c) Zwyk Studio — part of
[flatkit](https://github.com/flatink/flatkit).
