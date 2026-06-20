---
"@flatkit/player": patch
---

fix(player): two pointer-input edge cases (from the security/quality review)

- **Wheel while paused.** The `mouse.wheel` delta banked while the player is PAUSED is now discarded on
  `play()`, so scrolling a paused scene no longer applies as a sudden jump on resume (it accumulated with
  nothing integrating it).
- **Pointer capture.** `onPointerUp`/`onPointerCancel` now always release the pointer capture (guarded by
  `hasPointerCapture`), including when a click-only press turned into a drag — previously the explicit
  release was skipped on that path (the browser auto-released, but the state was inconsistent).
