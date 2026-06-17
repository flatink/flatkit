---
"@flatkit/engine": patch
---

Fix: `object` channel expressions (`scaleX`/`scaleY`/`rotation`) now transform around the group's declared
**`pivot`**, consistent with cel poses — instead of always around the local origin `(0,0)`. Before, a group
`at 0,0 pivot 376,246` driven by `object { scaleX = s }` shrank toward the top-left corner and `rotation`
swung it in an arc; now it scales/spins **in place** around the pivot. With no `pivot` (default `{0,0}`) the
behavior is byte-identical to before (origin-based). When a pivot is set, the `x`/`y` channels position the
pivot (the object's anchor). (Friction X.)
