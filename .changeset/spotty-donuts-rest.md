---
'@flatkit/types': patch
'@flatkit/engine': patch
'@flatkit/player': patch
'@flatkit/compiler': patch
---

Quality pass on `--fix`: one write, or none, and a position it cannot trust is skipped.

`--fix` writes to the AUTHOR'S file, so its failure modes matter more than its happy path. Three things
found reviewing it:

- It rewrote the file even when it had repaired NOTHING. Identical bytes, but a fresh mtime -- which wakes
  every watcher pointed at the folder, and fails outright on a read-only checkout it had no reason to
  touch. It now leaves such a file alone.
- It wrote each pass and reverted on failure, so the author's file transiently held a version already
  known to be unwanted -- and a process killed in that window left it there. The iteration is now
  `repairLoop`, a PURE function with no filesystem in it; the CLI writes once, at the end, a text the loop
  has already re-checked. The same is true of a source that does not parse at all, repaired in memory
  instead of one write per syntax error.
- `applyFixes` is public, so the diagnostics it is handed may be stored, replayed against a file that moved
  on, or built by a consumer. A non-positive column reached `slice` as an offset FROM THE END and silently
  truncated the line. Positions it cannot honour are now skipped.

`repairLoop` is exported: it is the loop worth not re-writing, including the part that is easy to get
wrong -- the error count RISES on the first pass of a source that did not parse, so the stopping condition
is "nothing applied", never "the count stopped dropping".
