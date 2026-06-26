# @flatkit/mcp

## 0.2.0

### Minor Changes

- [`f36005b`](https://github.com/flatink/flatkit/commit/f36005b4557ad1393d184319b77b40630b1c1787) Thanks [@kaelhem](https://github.com/kaelhem)! - search_assets: add optional `view` and `style` filters

  The `search_assets` tool now forwards `view` (orientation: front, side, three-quarter, top, back, flat) and `style` (graphic collection, e.g. "engraving" antique monochrome vs "paper-theater" flat color clipart) to the forge's `/v1/library/search`. This lets clients narrow results to a single visual look so an illustrated deck stays stylistically consistent.
