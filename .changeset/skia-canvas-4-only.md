---
"@flatkit/compiler": minor
"@flatkit/player": minor
---

`skia-canvas` 4 (from `4.0.0-rc7`) is now required to render in Node; version 3 is no longer accepted. Version 3 drops what lies behind a shape larger than the frame once its group moves it (half the picture comes out transparent), and the player carried a workaround for it in every browser bundle, where it never ran. That workaround is gone, with other duplicated code: the browser player is about 1.2 KB lighter (minified) than 0.46 although it gained the `nonzero` rule and the union of mask shapes. Coming from version 3, expect the text differences described in `docs/tooling.md` (a line of text may sit one device pixel higher or lower).
