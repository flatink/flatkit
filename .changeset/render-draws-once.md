---
"@flatkit/compiler": patch
---

`flatc --render` and `renderDocToPng` draw a plain frame once again. Since 0.38.0 the renderer drew it twice before capturing, and a second draw goes through the filter cache: scenes with `filter blur`, masks or `blend` came out one to three levels in 255 away from 0.37.1. Invisible, but found by a pixel comparison on a consumer's slides (2 in 61). A frame rendered after a gesture script is still drawn again, so that what the script changed is in the picture.
