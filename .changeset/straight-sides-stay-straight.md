---
'@flatkit/engine': patch
---

A straight segment next to a curve is drawn straight. In a path that mixes lines and curves -- every
rounded `rect`, a pill written with `L` and `A`, a line between two `C` -- the vertex where a line meets a
curve was given a smoothing tangent, and the straight sides bulged by a few pixels. A subpath that carries
any explicit handle now renders literally: a missing handle is a straight line. A subpath with no handle
at all is still free-hand material, and still smoothed.
