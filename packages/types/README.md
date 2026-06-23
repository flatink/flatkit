# @flatkit/types

Shared TypeScript types for the [FlatInk](http://flatink.zwyk-studio.com/) animation format — `Doc`,
`Layer`, `Item`, `Timeline`, `Path`, and friends. The **leaf** of the
[`flatkit`](https://github.com/flatink/flatkit) dependency graph: zero runtime, zero dependencies.

You rarely install this directly — [`@flatkit/engine`](https://www.npmjs.com/package/@flatkit/engine),
[`@flatkit/player`](https://www.npmjs.com/package/@flatkit/player), and
[`@flatkit/compiler`](https://www.npmjs.com/package/@flatkit/compiler) re-export the types you need. Reach
for it when you want to type a `.flatpack` document on its own.

## Install

```sh
pnpm add -D @flatkit/types
```

## Usage

```ts
import type { Doc, Layer, Text } from '@flatkit/types'

const doc: Doc = JSON.parse(flatpackJson)
```

## License

[MIT](https://github.com/flatink/flatkit/blob/main/LICENSE) (c) Zwyk Studio — part of
[flatkit](https://github.com/flatink/flatkit).
