---
"@flatkit/engine": patch
"@flatkit/compiler": patch
---

A group no longer loses its animation to a text that shows its name. A text without `as "<id>"` is named by what it shows, so a caption reading "Titre" and a `group "Titre"` bore the same name, and the text took it: for a `pose` when it was declared after the group, for an `object` block when it was declared before. The group was then never animated, without a warning. The name now always goes to the group (or instance, or image) - in cel poses, `object` blocks, `Titre.x` and drop zones alike, whatever the order. A text alone with its name is still addressed by it; `text "Titre" as "<id>"` addresses the text by its id.
