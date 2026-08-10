---
'@flatkit/types': patch
'@flatkit/engine': patch
'@flatkit/player': patch
'@flatkit/compiler': patch
---

Three layout false positives, measured on a 174-file corpus: 53 warnings -> 22.

Reported from the deckgen decks, where NONE of the 53 warnings matched a defect visible on screen. A
warning nobody believes is worse than no warning, and all three causes were ours -- each was measuring a
DECLARATION instead of what gets drawn.

**A `box` is a layout frame, not ink** (36 -> 10). `text "Accepter" align center box 780 40` is eight
glyphs in the middle of 780 px, and the clipped-at-the-edge pass measured the box: every centred text with
a comfortable box tripped it. It now measures the estimated ink, positioned by `align`. A WRAPPED text
keeps its box, where the ink really can fill the width.

**A container inherits its children's motion** (the last one standing). A group whose own position is
static but that CONTAINS an item a binding moves has no meaningful static bbox: its bounds are the union
of its children, measured where they are parked rather than where they play. The `dynamic` flag was
inherited downward and never upward, which is the other half of the same fact.

**One line of slack on the wrapped-height warning** (7 -> 3). The estimator has no canvas: it wraps on a
mean glyph advance, breaks early, and lands one line long -- measured against skia on five decks.

And an ergonomic fix that came with them: `— add "wrap"` is advice that cannot be followed for a single
word, since `wrap` breaks at spaces and nowhere else. A giant single word bleeding off frame is a
deliberate gesture in every corpus measured; the message now says so instead of prescribing.
