---
"@flatkit/types": minor
"@flatkit/engine": minor
"@flatkit/player": minor
---

`valign top|middle|bottom` on a text places its lines in the height of its box. `top` is the default and changes nothing. `middle` centres what the eye reads, from the top of the first line's capitals to the baseline of the last line, so a label sits in the middle of its frame whatever the font: no more nudging `at` by eye. `bottom` brings the last line down until its descenders touch the bottom of the box. Both count the lines actually drawn (`wrap`, line breaks); with no box height, `middle` centres the text on its `at` line.
