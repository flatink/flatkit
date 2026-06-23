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
flatc scene.flatink --render -o frame.png          # headless PNG preview
flatc scene.flatink --play --script gestures.json  # headless replay + assertions (CI)
```

## Programmatic

```ts
import { compileFlatpack } from '@flatkit/compiler/compile'

const doc = compileFlatpack(programSrc, assetSrcs, media) // -> Doc (the .flatpack)
```

Static analysis (lint, manifest, LLM context) lives under `@flatkit/compiler/analysis`.

## License

[MIT](https://github.com/flatink/flatkit/blob/main/LICENSE) (c) Zwyk Studio — part of
[flatkit](https://github.com/flatink/flatkit).
