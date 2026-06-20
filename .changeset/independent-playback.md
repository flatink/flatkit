---
"@flatkit/types": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

Independent (MovieClip-style) playback per nested instance: `loop` / `once`.

A nested instance used to be a Flash "graphic symbol" only -- its local frame DERIVED from the ancestor's, so a sub-loop was truncated and snapped back to mid-cycle whenever an ancestor's timeline was shorter than (or not a multiple of) the sub-loop. The only way to keep a state-loop or idle clean was to pad every parent to the LCM of its sub-loops, which broke again the moment the asset was composed into a host with a different root length.

This adds the Flash "MovieClip" model: an instance with its OWN clock, driven by the runtime's monotone heartbeat (`mono`) on its OWN duration, immune to any ancestor's loop wrap.

- DSL: `instance "X" as "y" loop` (independent) / `... once` (play through, then HOLD the last frame) / `... synced` (the unchanged default). Round-trips through `flatFormat`.
- Engine: `resolveInstanceFrame` / `instanceFrames` take the mono clock; `independent` = `mono mod dur`, `once` = `clamp(mono, 0, dur-1)`. `synced` and `singleFrame` are byte-for-byte unchanged.
- Player: the render/hit paths carry the monotone beat down every scope; a non-playing `seek` anchors `mono` to the scrubbed frame, so headless `seek`+`render` and `--render --frame N` resolve MovieClip clips deterministically (phase = frame mod dur). During playback `mono` free-runs across loop wraps, so the phase is continuous.
- Compiler: `flatc --preview` now sizes the preview window to a common multiple of every `independent` descendant's duration (and past the longest `once` clip) so a nested MovieClip loops cleanly in the preview, without touching the previewed symbol's own authored duration.

Backward compatible: absent playback = `synced`, so every existing `.flat` renders identically. A static walk with no runtime clock falls back to synced.
