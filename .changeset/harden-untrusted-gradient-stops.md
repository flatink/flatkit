---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

Harden the renderer against a crafted gradient in an untrusted `.flatpack` (security pass).

The player renders untrusted `.flatpack` JSON and `sanitizeDoc` does not validate paint stops, so a crafted gradient could CRASH the render: a stop `param: "__proto__"` made the per-instance color lookup return `Object.prototype`, which the color helpers (`splitAlpha`/`withAlpha`) then threw on; a non-string color or a non-finite `offset`/`alpha` (e.g. `offset: "x"` -> NaN) made `addColorStop` throw. `resolveColorRef` now uses an OWN string value only (a prototype hit or non-string falls back to the literal hex) and ignores a non-finite alpha; the stop loop clamps a non-finite offset. A malformed gradient now degrades to a valid color instead of throwing. No effect on well-formed gradients (literal or param).
