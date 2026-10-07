# @flatkit/mcp

## 0.3.15

### Patch Changes

- Updated dependencies []:
  - @flatkit/compiler@0.46.0

## 0.3.14

### Patch Changes

- Updated dependencies []:
  - @flatkit/compiler@0.45.0

## 0.3.13

### Patch Changes

- Updated dependencies [[`88fe486`](https://github.com/flatink/flatkit/commit/88fe48671799d848c2e3e5af8686bc8b0ff712a4)]:
  - @flatkit/compiler@0.44.0

## 0.3.12

### Patch Changes

- [`87a8912`](https://github.com/flatink/flatkit/commit/87a8912d75e52fcc48623442e7919f78ad2c6576) Thanks [@kaelhem](https://github.com/kaelhem)! - A security / correctness / performance pass before release. Security: an untrusted document could write to
  the host page's Object.prototype through an instance named `__proto__` (by-name param reads, unreleased),
  freeze the player with a param name used as a regex, allocate gigabytes per tick with a huge `fps` (the
  `at frame` walk of 0.41), or stall on a long `from` value; `--check` crashed on an object named `toString`.
  Correctness: `text()` of a bound text inside a symbol reads its instance's params; a `pause` on a
  stepped-over frame holds that frame; `load()` of a shorter document no longer fires a burst of frame scripts;
  an instance playing on its own keeps a held scene alive; a range-loop variable read after its loop is an
  error; fewer false warnings (text named with `as`, quoted `from`, gated `time` motions); a trailing comma in
  a `var` array is allowed again. Performance: `--check` stays linear on large programs (12k located warnings:
  8.2 s to 0.7 s). `@flatkit/mcp` moves to `@modelcontextprotocol/sdk` 1.31+ (advisory).
- Updated dependencies [[`aec31e0`](https://github.com/flatink/flatkit/commit/aec31e03a01e5092388833b1b92d227cc6429456), [`87a8912`](https://github.com/flatink/flatkit/commit/87a8912d75e52fcc48623442e7919f78ad2c6576), [`80568af`](https://github.com/flatink/flatkit/commit/80568af00b74e5ea8ae4ab8215be961a1b24708f)]:
  - @flatkit/compiler@0.43.0

## 0.3.11

### Patch Changes

- Updated dependencies [[`f1022d8`](https://github.com/flatink/flatkit/commit/f1022d89d50c5b0df822473346d12a780249905f)]:
  - @flatkit/compiler@0.42.0

## 0.3.10

### Patch Changes

- Updated dependencies [[`e9544ab`](https://github.com/flatink/flatkit/commit/e9544ab35127697ae88a4af59f36f2fc1fa695f4)]:
  - @flatkit/compiler@0.41.0

## 0.3.9

### Patch Changes

- Updated dependencies [[`669ab59`](https://github.com/flatink/flatkit/commit/669ab59554bcbd35ec11a3741bca4837256db7db), [`be29259`](https://github.com/flatink/flatkit/commit/be29259a11207b62ef6347a1a0cd288558c5a82e), [`00e721b`](https://github.com/flatink/flatkit/commit/00e721b657ffb569ca2a9330c5608da7ebfbe09a)]:
  - @flatkit/compiler@0.40.0

## 0.3.8

### Patch Changes

- Updated dependencies [[`0110e0a`](https://github.com/flatink/flatkit/commit/0110e0a0dc1d71fc37c58efe6eeb46af170d82e9)]:
  - @flatkit/compiler@0.39.1

## 0.3.7

### Patch Changes

- Updated dependencies [[`30605db`](https://github.com/flatink/flatkit/commit/30605db0fd1feb3334e72f89f6a404f44c0437e2)]:
  - @flatkit/compiler@0.39.0

## 0.3.6

### Patch Changes

- Updated dependencies [[`59bd47f`](https://github.com/flatink/flatkit/commit/59bd47f16d049874f9973dd0abd5e0ae86440729)]:
  - @flatkit/compiler@0.38.0

## 0.3.5

### Patch Changes

- Updated dependencies [[`7611bc8`](https://github.com/flatink/flatkit/commit/7611bc847ffb83d3328dceac8e8418a96ea75880)]:
  - @flatkit/compiler@0.37.1

## 0.3.4

### Patch Changes

- Updated dependencies [[`ebeb796`](https://github.com/flatink/flatkit/commit/ebeb796f2d03954c5955b798296f87216a592473)]:
  - @flatkit/compiler@0.37.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`9673b96`](https://github.com/flatink/flatkit/commit/9673b96063f6068d6fa85875ca81529b4fa73920), [`9ba1877`](https://github.com/flatink/flatkit/commit/9ba187778ca41d14aae99bfc2055dc4badb2cd39)]:
  - @flatkit/compiler@0.36.1

## 0.3.2

### Patch Changes

- Updated dependencies [[`357137e`](https://github.com/flatink/flatkit/commit/357137ea70e9064d6ecea56e93be827351ef2e03), [`b29bb4e`](https://github.com/flatink/flatkit/commit/b29bb4e482be3ffbb1242c68081e067278ff9e94), [`a6a462c`](https://github.com/flatink/flatkit/commit/a6a462c101c710147c279f2ea2424ebf35aa0e34), [`e6eca55`](https://github.com/flatink/flatkit/commit/e6eca55c5bc56a1506aabd6cd9c0849cff152548), [`ecd419e`](https://github.com/flatink/flatkit/commit/ecd419e136906bbcd28c8740169adf71db9a8934), [`8bf60de`](https://github.com/flatink/flatkit/commit/8bf60dedcefc3332d280c5147543346a3dd8f3cd), [`aac2a80`](https://github.com/flatink/flatkit/commit/aac2a809e926333168426538646227f4af6e2cd9)]:
  - @flatkit/compiler@0.36.0

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @flatkit/compiler@0.35.3

## 0.3.0

### Minor Changes

- [`6e51f77`](https://github.com/flatink/flatkit/commit/6e51f774f3bb138163972d48ad7c99d32dfbdc7f) Thanks [@kaelhem](https://github.com/kaelhem)! - The MCP server now serves the LANGUAGE, not only the forge -- plus `describe_scene`, and its own version.

  An agent connecting to it could search assets, check, render and publish, and had **nowhere to learn the
  DSL from** -- while `@flatkit/compiler` ships exactly that. The reference material is exposed as MCP
  resources:

  - `flatink://card/language` and `flatink://card/drawing` -- the two reference cards, GENERATED by the
    installed compiler, so they never drift from the version that will check the source;
  - `flatink://docs/<guide>` -- the nine published guides;
  - `flatink://prompt/<name>` -- the ready-made system prompts (`flatink-core`, `flatink-lite`, and the three
    `role-*` postures).

  **`describe_scene`** answers "what does this program DO?" locally, with no forge round-trip: the named
  objects and the contract each carries, the state variables, the functions, and the events it emits --
  including one emitted from inside a procedure or an `if` body, which reading the text for `send` cannot
  see.

  Two smaller things, both found by looking: the server announced `version: "0.1.0"` in its handshake while
  the package was 0.2.0 (it reads its own `package.json` now, with a test pinning the two together), and the
  package was **absent from the publishability gate** -- `check-pack` covered the other five and not this one.
  It is in, and it passes.

### Patch Changes

- Updated dependencies [[`6e51f77`](https://github.com/flatink/flatkit/commit/6e51f774f3bb138163972d48ad7c99d32dfbdc7f)]:
  - @flatkit/compiler@0.35.2

## 0.2.0

### Minor Changes

- [`f36005b`](https://github.com/flatink/flatkit/commit/f36005b4557ad1393d184319b77b40630b1c1787) Thanks [@kaelhem](https://github.com/kaelhem)! - search_assets: add optional `view` and `style` filters

  The `search_assets` tool now forwards `view` (orientation: front, side, three-quarter, top, back, flat) and `style` (graphic collection, e.g. "engraving" antique monochrome vs "paper-theater" flat color clipart) to the forge's `/v1/library/search`. This lets clients narrow results to a single visual look so an illustrated deck stays stylistically consistent.
