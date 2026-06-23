---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

docs: each published package now ships a README, so its npm page is no longer blank -- a short pitch,
install line, and a minimal usage snippet (player: FlatPlayer + loadEmbeddedFonts; compiler: flatc + the
compileFlatpack programmatic entry; engine: the per-module subpath imports; types: typing a Doc). This
release also publishes the package metadata that moved to the flatink GitHub org (the `repository` link on
the npm page), which had only been committed, not yet published.
