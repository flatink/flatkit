---
'@flatkit/compiler': minor
---

A warning when two `.flat` libraries declare the same symbol name. The last library read is the one instanced, and `flatc` reads every `.flat` of the program's folder, so which one wins was a matter of file names, with the other shadowed without a word. `flatc` (with or without `--check`, and `--check a.flat b.flat`) now names both files and says which one is instanced. `checkProgram` reports it too; the new `assetNames` option names the libraries in the message (without it: `library 1`, `library 2`), and `libraryNameDiagnostics` is exported. No warning when the program declares that name itself: its own symbol is the one instanced, as documented.
