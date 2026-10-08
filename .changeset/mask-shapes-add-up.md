---
"@flatkit/player": minor
---

The shapes of a `mask layer` add up: the mask is their union, each one filled by its own rule. Two shapes that overlapped used to cancel where they overlapped (the picture had a hole there, while the touch test already counted it in), so patching a mask with a second shape removed what it was meant to add. A single shape, or shapes that stay apart, still clip as before, pixel for pixel; shapes that overlap are composed off-screen.
