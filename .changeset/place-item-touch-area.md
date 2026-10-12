---
'@flatkit/sugarflat': patch
---

`place`: an item is touched over its whole footprint.

Reported from a phone 375 px wide (flatkit#83): the draggable items of a `place` block measured about 34 px on screen, under the 44 px advised for a finger. An item declared no touch area: it was grabbed wherever its drawing reached, so the grip followed the theme -- smaller under a theme that draws smaller, and none at all under `BLANK` until a skin drew something.

- **An item now carries `hitbox` = its footprint** (92x92 under the stock themes), like targets and chips already did. On the 760 px board shown 375 px wide that is 45 px, whatever is drawn inside. Nothing moves: footprints, drawings and layouts are the same.
- The visible disc of `GREYBOX` is 84 units since 0.5.0 (41 px in that setting); it was 68 in 0.4.7, the version the report was measured on.
