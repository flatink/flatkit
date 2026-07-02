---
"@flatkit/player": patch
---

fix(hit): a mask shaped by text/image no longer crashes selection

`pointInMask` read `(it as Region).path` for any non-container mask material. A mask shaped by a **text** or **image** (e.g. `mask layer { text "…" }`) has no `.path`, so the hit test threw `Cannot read properties of undefined (reading 'subpaths')`. Because a masked layer is point-tested before any position check, **every click** on such a scene crashed. Text/image mask material now clips by its box (like the rest of the hit test); containers stay non-blocking.
