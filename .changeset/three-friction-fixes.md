---
"@flatkit/engine": minor
"@flatkit/compiler": minor
---

DSL footgun fixes (three "accepted at --check, silently no-op at runtime" traps reported from the field):

- **`scale` is now authoring sugar** for `scaleX = e` + `scaleY = e` (uniform scale), both at top level and inside `each` blocks — mirroring the `.flat` pose format. Before, `object "X" { scale = k }` parsed but was dropped, so the object never scaled.
- **A bare `text "…" as "id"` leaf is addressable by `object "id"`.** The text `as` id (the namespace `text("id")` reads) was disjoint from the `object` name namespace (= the text content), so `object "id" { opacity = 0 }` silently no-op'd. `object` now resolves an explicit text id too.
- **`flatc --check` surfaces behavior parse errors inside `object` blocks** (unknown channels, malformed statements) instead of dropping them. These never reached the Doc-based linter, so typos like `scaleZ = 1` or `opacty = 0` passed silently; they now error with the `object "name"` scope and line.
