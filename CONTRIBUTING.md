# Contributing to flatkit

Thanks for taking the time to contribute! flatkit is the open toolchain behind the
[FlatInk](http://flatink.zwyk-studio.com/) animation format. This guide gets you from clone to PR.

## Prerequisites

- **Node 24+** (an `.nvmrc` pins it — `nvm use`).
- **pnpm** (the repo pins the version via `packageManager`; `corepack enable` will pick it up).

## Setup

```sh
pnpm install
pnpm verify      # lint + english-only check + typecheck + tests — run this before every PR
```

`pnpm verify` is the same gate CI runs. To also check the packages are publishable
(build + `publint` + `are-the-types-wrong`), run `pnpm check:pack`.

## Repository layout

A pnpm monorepo (`packages/*`):

| Package | Role |
|---|---|
| `@flatkit/types` | shared format types (zero runtime) |
| `@flatkit/engine` | pure core: model, expressions, timeline, geometry (consumed by subpath, e.g. `@flatkit/engine/expr`) |
| `@flatkit/compiler` | the language + compiler, ships the `flatc` CLI |
| `@flatkit/player` | the `<canvas>` runtime — standard entry stays tiny; authoring/CI tools live under `@flatkit/player/debug` |

In dev, packages resolve to their **TypeScript source** (no build needed — tsx/Vitest read `src`).
The `dist/` build is only produced for publishing.

## Making a change

1. Branch from `main`.
2. Make your change. Keep the surrounding style (the code is its own style guide). Add or update tests —
   we keep the suite green and meaningful.
3. Run `pnpm verify`.
4. **Add a changeset** if your change affects a published package:
   ```sh
   pnpm changeset
   ```
   Pick the bump and write a one-line summary; commit the generated file in `.changeset/`. (Docs-only or
   internal-tooling changes don't need one.)
5. Open a PR. Fill in the template. CI must be green.

## Tips

- **Docs** live in [`docs/`](docs/) — the DSL guide. Keep them in sync with the parser.
- The codebase is **English-only** (a CI guard enforces it).
- Found something? The [`docs/dsl-gotchas.md`](docs/dsl-gotchas.md) appendix collects hard-won pitfalls —
  add to it when you learn one.

## Reporting bugs & ideas

Open an [issue](https://github.com/zwykstudio/flatkit/issues) (templates provided). For **security**
issues, follow [SECURITY.md](SECURITY.md) instead of a public issue.
