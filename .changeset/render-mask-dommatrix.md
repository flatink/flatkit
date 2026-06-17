---
"@flatkit/compiler": patch
---

Fix: `flatc --render` no longer crashes with `DOMMatrix is not defined` on scenes that contain a `mask`
layer. The mask/clip path builder does `new DOMMatrix([...])` (a browser global absent under Node); the
headless render entry now injects skia-canvas's `DOMMatrix` export as a global alongside `Path2D`. `--check`
and flatpack compilation were unaffected — only the PNG render path. Also: `flatc --render` prints the full
stack on failure when `FLATC_DEBUG` is set, to ease diagnosing such headless-only errors.
