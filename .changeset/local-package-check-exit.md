---
"@flatkit/compiler": patch
---

Fix `--check` on any program that imports a LOCAL package (`use "physics"` -> physics.flatink): it
reported one phantom `"(" expected after "fn <pkg>"` error per package function and exited 1, so a
healthy program failed its own lint. A local package is inlined twice into `doc.functions` (the bare
name plus the qualified alias `physics.tick`, so both call forms resolve); the alias has no `fn` syntax,
and re-emitting it into the reconstructed scope program made that text unparseable. The alias is no
longer printed - it stays in the Doc and stays a known callable name, so qualified calls still lint and
run. The shipped `examples/cli/scene.flatink` now passes `--check`.
