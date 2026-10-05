---
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

flatink/flatink#62: a `.flatpack` may leave out the fields at their default value. Loading a document
(`sanitizeDoc`, which the player runs) now puts back the ones some readers did not default (layer
`visible` / `locked` / `opacity`, an identity `transform`); before, a missing `visible` read as a hidden
layer. `compactDoc(doc)` (engine), `packToJSON(doc, { compact: true })` and `flatc --compact` write the
lighter form, which needs a player on this version or later. Measured on our corpora: about 3% of the
document without media, every render identical.
