---
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
"@flatkit/mcp": patch
---

A security / correctness / performance pass before release. Security: an untrusted document could write to
the host page's Object.prototype through an instance named `__proto__` (by-name param reads, unreleased),
freeze the player with a param name used as a regex, allocate gigabytes per tick with a huge `fps` (the
`at frame` walk of 0.41), or stall on a long `from` value; `--check` crashed on an object named `toString`.
Correctness: `text()` of a bound text inside a symbol reads its instance's params; a `pause` on a
stepped-over frame holds that frame; `load()` of a shorter document no longer fires a burst of frame scripts;
an instance playing on its own keeps a held scene alive; a range-loop variable read after its loop is an
error; fewer false warnings (text named with `as`, quoted `from`, gated `time` motions); a trailing comma in
a `var` array is allowed again. Performance: `--check` stays linear on large programs (12k located warnings:
8.2 s to 0.7 s). `@flatkit/mcp` moves to `@modelcontextprotocol/sdk` 1.31+ (advisory).
