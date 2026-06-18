---
"@flatkit/player": patch
---

Perf: a container/leaf whose resolved `opacity` is `<= 0.01` is now skipped at render — its whole subtree
is pruned (no draw, no child expression eval), mirroring the hit-test predicate (which already lets
`opacity <= 0.01` click through). Previously only an opacity of EXACTLY `0` was skipped, so the common
gating idiom `opacity = phase == X ? 1 : 0` cost nothing when off-phase reached exactly 0, but a value
SMOOTHED toward ~0 (e.g. 0.005) still drew and evaluated the entire hidden subtree every frame. Scenes that
stack several phases gated this way (a card with many off-phase layers) get a large speedup with no authoring
change, and draw/hit stay aligned (an alpha≈0 item was already non-interactive; now it's also free to render).
