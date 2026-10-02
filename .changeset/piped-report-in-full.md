---
'@flatkit/compiler': patch
---

`flatc` prints its whole report when its output is piped. The binary exited right after writing, and a
write to a pipe is asynchronous on macOS and Windows: a report longer than the pipe's buffer (64 KB) was
cut off mid-line -- `flatc ... --check | grep -c warning`, or a script capturing the output, saw only the
beginning. Output sent to a file or a terminal was complete.
