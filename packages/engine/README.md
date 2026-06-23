# @flatkit/engine

The pure core of the [FlatInk](http://flatink.zwyk-studio.com/) toolchain: model evaluation, the expression
language, timeline/keyframe interpolation, geometry (paths, transforms, bezier <-> polygon), color/paint,
and layer queries. **No canvas, no clipper, no DOM** — shared by
[`@flatkit/player`](https://www.npmjs.com/package/@flatkit/player) and
[`@flatkit/compiler`](https://www.npmjs.com/package/@flatkit/compiler).

Most apps depend on the player or the compiler and get the engine transitively. Import it directly for
headless logic: evaluating a timeline, flattening a path, resolving an expression.

## Install

```sh
pnpm add @flatkit/engine
```

## Usage

Each module is its own entry point:

```ts
import { evaluateTimeline } from '@flatkit/engine/timeline'
import { pathToPolygons, transformPath } from '@flatkit/engine/path'
import { compileExpr } from '@flatkit/engine/expr'
```

## License

[MIT](https://github.com/flatink/flatkit/blob/main/LICENSE) (c) Zwyk Studio — part of
[flatkit](https://github.com/flatink/flatkit).
