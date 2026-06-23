---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

compiler: a `font` asset declared without an explicit family (`asset "Archivo" "a.woff2" font`) now bakes
an explicit `family` equal to its declared id. That id is exactly what the text targets via `font "<id>"`,
so registration is now consistent everywhere instead of relying on a `family || id` fallback:

  - browser (`loadEmbeddedFonts`) already used `family || id`, so no behavior change there;
  - headless (`flatc --render` / skia `FontLibrary`) previously fell back to the font FILE's intrinsic
    name-table family when no alias was set, which only matched `font "<id>"` when the file's own name
    happened to equal the id. Forcing `family = id` makes headless text resolve to the authored face
    regardless of what the file's name table says.

An explicit family alias (`asset "slug" "a.woff2" font "Real Family"`) is preserved untouched.
