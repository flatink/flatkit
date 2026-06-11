# Security

## Reporting a vulnerability

Please report security issues privately to **security@zwyk.studio** (or open a [GitHub security
advisory](https://github.com/zwykstudio/flatkit/security/advisories/new)). Do not file a public issue
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
  and rejects anything that leaves that origin. The untrusted document never chooses the origin.
- **Bounded work per tick.** A single event / frame runs at most `MAX_ACTIONS_PER_TICK` actions; nested
  `repeat` blocks share that global budget (a per-block cap alone would let nesting multiply into a
  freeze). `flatc --render --steps N` clamps N (`MAX_RENDER_STEPS`) so a headless render cannot be made to
  spin forever.
- **Bounded recursion.** Rendering and hit-testing cap container nesting (`MAX_NEST`); instance cycles are
  also broken by symbol-id tracking.
- **Defensive `Doc` normalization.** A freshly parsed `.flatpack` is normalized before play: non-object
  input is rejected, page dimensions are clamped, `layers`/`symbols` default to arrays, and dangerous
  variable keys (`__proto__`, `constructor`, `prototype`) are stripped (prototype-pollution defense).

### Recommendations for embedders

When embedding the player in a page that may load untrusted `.flatpack` files, set a strict
**Content-Security-Policy** (e.g. `default-src 'self'; img-src 'self' data:; media-src 'self' data:`) as
defense in depth. The player already restricts assets to `data:` URIs, but a CSP bounds the whole page.

## Scope

These guarantees cover the published packages (`@flatkit/types`, `@flatkit/engine`, `@flatkit/compiler`,
`@flatkit/player`) and the `flatc` CLI. The separate visual editor is out of scope for this repository.
