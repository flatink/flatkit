# Security

## Reporting a vulnerability

Please report security issues privately to **security@zwyk.studio** (or open a [GitHub security
advisory](https://github.com/flatink/flatkit/security/advisories/new)). Do not file a public issue
for an unpatched vulnerability. We aim to acknowledge within a few business days.

## Threat model

flatkit treats two kinds of input as **untrusted**:

1. **A `.flatink` program (and the `.flat` / media it pulls in), compiled by `flatc`.** The compiler may
   run in CI or a build service on programs from third parties.
2. **A `.flatpack` document, played by `@flatkit/player`.** The player is meant to be embedded in
   third-party web pages, so a `.flatpack` can come from anywhere.

Neither input may read host data it was not given, execute arbitrary code, trigger unexpected network
requests, or hang the process / browser tab.

### What the toolchain guarantees

- **No code execution.** The expression language and the action model are pure interpreters — no `eval`,
  no `new Function`. Expression results are coerced to numbers, and identifier lookups are restricted to
  *own* properties of the evaluation context (no `constructor` / `__proto__` / prototype access).
- **Path confinement (`flatc`).** Media (`asset "id" "path" …`) and local packages (`use "x"`) are
  resolved **relative to the program's folder**; a path that escapes that folder (e.g. `../../etc/passwd`)
  is refused, never read or embedded.
- **No document-chosen URLs (player).** By default the player loads only self-contained `data:` URIs and
  never dereferences a remote URL (`http(s):` / `blob:` / `file:`) for an asset, so a `.flatpack` cannot
  turn an asset reference into a tracking beacon, SSRF, or cross-origin request. External (non-embedded)
  assets are supported **only** through a host-supplied resolver (`PlayerOptions.resolveAsset`): the helper
  `sameOriginAssetResolver(baseUrl)` resolves a document's relative key against a base the **host** picked
  and rejects anything that leaves that origin. The untrusted document never chooses the origin. The base
  itself is an absolute URL, or a path on the host's own page (`/…`, `./…`, `../…`); anything else — an
  empty string, a protocol-relative `//other.host/…` — resolves nothing, so a missing setting fails closed.
- **Bounded work per tick.** A single event / frame runs at most `MAX_ACTIONS_PER_TICK` actions; nested
  `repeat` blocks share that global budget (a per-block cap alone would let nesting multiply into a
  freeze). `flatc --render --steps N` clamps N (`MAX_RENDER_STEPS`) so a headless render cannot be made to
  spin forever, and a `--play` gesture script is held to a total number of simulation steps.
- **Bounded waiting.** A handler that `wait`s is suspended, not spun: at most `MAX_TASKS` (256) handlers
  wait at once (past that the oldest is dropped), and the handlers resumed in a step share that step's
  action budget, so waiting cannot be used to escape the per-tick bound.
- **Bounded recursion.** Rendering and hit-testing cap container nesting (`MAX_NEST`); instance cycles are
  also broken by symbol-id tracking.
- **Bounded nesting (`flatc`).** A program that nests beyond any real use is refused with a compile error
  instead of exhausting the stack: blocks (`if` / `else if` / `repeat`) more than 256 deep, groups more
  than 256 deep, an expression more than 200 deep (parentheses, indexes, stacked unary operators). The
  check that reports the depth of a compiled document is iterative. Measured on about 1200 real programs:
  parentheses nest 11 deep at most, braces 16.
- **A document nested deeper than the player can walk fails, it does not hang.** A hand-written
  `.flatpack` is not bound by the compiler's limits. An expression nested more than 200 deep is refused
  when it is first read and evaluates to 0. Actions nested by the thousand raise a `RangeError` — at load
  or in the step that reaches them, within milliseconds — and the host should treat it as any other
  failure to play an untrusted file: catch it around `new FlatPlayer` / `load`; raised from the frame
  loop it reaches the page as an uncaught error (`window.onerror`), and that scene stops.
- **Defensive `Doc` normalization.** A freshly parsed `.flatpack` is normalized before play: non-object
  input is rejected, page dimensions are clamped, `layers`/`symbols` default to arrays, and dangerous
  variable keys (`__proto__`, `constructor`, `prototype`) are stripped (prototype-pollution defense).

### Recommendations for embedders

When embedding the player in a page that may load untrusted `.flatpack` files, set a strict
**Content-Security-Policy** (e.g. `default-src 'self'; img-src 'self' data:; media-src 'self' data:`) as
defense in depth. The player already restricts assets to `data:` URIs, but a CSP bounds the whole page.

### Storing a compiled document

A `.flatpack` is a file. Keep it as one — a string, a blob — rather than as a tree in a document database:
its nesting follows the program, and a store that keeps it as a tree has a ceiling of its own (MongoDB
refuses a document past 180 levels). `flatc --check` warns when a compiled document nests more than 100
levels and names where.

## Scope

These guarantees cover the four core packages (`@flatkit/types`, `@flatkit/engine`, `@flatkit/compiler`,
`@flatkit/player`) and the `flatc` CLI. `@flatkit/sugarflat` only turns text into `.flatink` text, which
then goes through the compiler like any other program. `@flatkit/mcp` is a client of a remote service and
is not covered by them, and neither is the separate visual editor.
