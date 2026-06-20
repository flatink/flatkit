---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

Fix pointer-move lag: the player rendered a full frame synchronously on every `pointermove` (which fire at 125–1000 Hz), on top of the 60 fps playback loop, saturating the main thread. Now the move render is coalesced — while a render loop (playback or a transition) is already running it repaints the next frame instead of per-event, and a static scene still renders synchronously so the cursor follows immediately. Also skip the per-move expression-cache invalidation when nothing reads `mouse.x`/`mouse.y` (a drag self-invalidates, so this is safe). Active-drag latency is unchanged (still synchronous).
