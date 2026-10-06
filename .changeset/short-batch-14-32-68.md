---
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

flatink/flatink#14: `Inst.state = B from A` replays a state transition from its start (jump to `A`, play to
`B`, even when already at `B`); `--check` checks both states. flatink/flatink#32: `bind ... locale fr`
spells the bound number the French way (minus sign U+2212, decimal comma, narrow no-break space between
thousands); `text()` sends that spelling. flatink/flatink#68: the expressions written on scene items
(`bind`, `draw`, `from`, `count`, text-on-path `start` / `spacing`, an `expr` attribute) are linted by
`--check`.
