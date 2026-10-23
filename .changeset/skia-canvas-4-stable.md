---
'@flatkit/compiler': patch
---

`flatc --render`: skia-canvas 4.0.0 is out, and npm's `latest` tag now points at it.

- The messages of `flatc` and the tooling guide said `skia-canvas@next`, and warned that a bare install gives 3.x. They now say `skia-canvas@4`: a bare install gives 4.0.0, and a project pinned to 3 still has to name the major.
- The release candidates of version 4 (from `4.0.0-rc7`) are still accepted, the peer range is unchanged. The test suite now runs on 4.0.0.
