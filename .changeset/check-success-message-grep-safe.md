---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

`flatc --check` success message no longer contains the word "error".

The success line was `flatc: no errors` -- which contains "errors", so a tool or agent that greps the output for "error" to detect a failure gets a false positive (it reads success as failure). The line is now `flatc: check passed` (and surfaces a `N warning(s)` count when there are non-blocking warnings). The real failure signal stays the exit code (non-zero on error); on a failure the per-line report still prints "error" to stderr, so grepping for "error" now matches only genuine failures.
