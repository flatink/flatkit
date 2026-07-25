---
'@flatkit/compiler': minor
'@flatkit/engine': minor
'@flatkit/player': minor
'@flatkit/types': minor
---

`send` record payload + keyboard fix (host integration)

- **`send "event", { a = expr, b }`** — a fourth payload form carrying several NAMED numbers in one
  event (a state patch), instead of one positional value. `{ b }` is shorthand for `{ b = b }`. The
  host receives them on a new `fields` key: `onEvent({ name, value?, fields? })`.
  Bounded and vetted at both ends: at most 32 fields, identifier-shaped names, never `__proto__` /
  `constructor` / `prototype`, values coerced to finite numbers (NaN -> 0). A malformed or duplicate
  field name is a parse error; a hand-written `.flatpack` that bypasses the parser has its
  non-conforming fields dropped by the runtime.
- **Fix: `keys.<Key>` always read 0.** The `keys` object is a Proxy over the held-keys set, but the
  expression sandbox resolves members with `Object.hasOwn` (own properties only), which a get-trap-only
  Proxy always answers false -> every key read collapsed to NaN -> 0. Keyboard input in expressions
  (`if keys.Space`, `x = x + keys.ArrowRight * 4`) now works.
- **The keyboard now behaves inside a host page.** The listeners stay global (no click-to-focus), but a
  keystroke aimed at a host `<input>`/`<textarea>`/`<select>`/`contenteditable` is ignored by the scene;
  `preventDefault` is applied ONLY to the keys the document declares via `keys.<Name>` (mirroring the
  existing `mouse.wheel` rule), never to a `Ctrl`/`Cmd`/`Alt` combination, `Tab` or a function key; and
  losing the window releases the held keys (alt-tab delivers no `keyup`).
- **`player.setKey(name, down)`** drives a key programmatically — for an on-screen D-pad (no keyboard on
  a phone) and for headless replay.
- **New `key` gesture** in the headless scripts: `{ "type": "key", "name": "ArrowRight", "frames": 10 }`
  holds a key for N simulation steps then releases it, so a keyboard-driven scene is testable in CI
  (`flatc --play`). Key presses are still not captured by `--record`.
- `@flatkit/player` now exports the **`SendEvent`** type, so a host can type its `onEvent` callback
  without restating the shape.
- `flatc --play --trace` prints record payloads as `event{a=1, b=2}`.
- New guide: **docs/host-integration.md** — receiving `send` events, driving state variables from the
  page, keyboard caveats, teardown and the security contract.
