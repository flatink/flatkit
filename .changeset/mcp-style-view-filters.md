---
"@flatkit/mcp": minor
---

search_assets: add optional `view` and `style` filters

The `search_assets` tool now forwards `view` (orientation: front, side, three-quarter, top, back, flat) and `style` (graphic collection, e.g. "engraving" antique monochrome vs "paper-theater" flat color clipart) to the forge's `/v1/library/search`. This lets clients narrow results to a single visual look so an illustrated deck stays stylistically consistent.
