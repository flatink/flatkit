---
'@flatkit/engine': patch
'@flatkit/compiler': patch
---

The `--check` warning about a path that "looks like free-hand material" and does not say `smooth` only
fires when rounding the path would visibly move its outline. 0.36.0 fired it on any long run of points
with gentle turns: 4431 times on a corpus of 546 slides of vectorised artwork, where the two renderings
differed by a fraction of a percent of the pixels. It now measures how far the smoothed outline would
stand from the straight segments (across each segment, and relative to the size of the shape), and stays
quiet for points in a row and for curves already sampled finely. Same corpus: 14 warnings.
