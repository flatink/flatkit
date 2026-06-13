# FlatInk DSL — documentation

FlatInk is a small text language for **animations and interactive scenes** that compile to a single
self-contained `.flatpack` and play in any `<canvas>`. You can write it by hand, generate it from a
script or an LLM, or export it from the [FlatInk editor](http://flatink.zwyk-studio.com/).

## The mental model

A `.flatink` file has **two halves**:

```
size 480 320

scene {                     ← THE SCENE: what you see (shapes, text, images, groups)
  layer "game" {
    circle 240 160 40 fill #ffcc00
  }
}

object "Star" {             ← THE BEHAVIOR: how it moves and reacts
  when clicked { score = score + 1 }
  rotation = time * 30
}
```

The **scene** is composition; the **behavior** (everything after `scene { … }`) is logic — events,
expressions, drag/drop, interactors. They don't share the same grammar.

## Guides

Read in order if you're new, or jump to a topic:

1. **[Getting started](getting-started.md)** — your first `.flatink`, compiled and played.
2. **[Scene & drawing](scene-and-drawing.md)** — layers, shapes, text, images, paints, filters, transforms.
3. **[Animating a symbol](animating-symbols.md)** — the timeline/cel/pose model, `rotate`/`scale`/`spin`, pivots, tweens, easing.
4. **[Behavior & interactions](behavior-and-interactions.md)** — events, actions, drag/drop, interactors, feedback.
5. **[Expressions & stdlib](expressions-and-stdlib.md)** — the expression language, math, `self`/`mouse`/`time`, and the `use "…"` packages.
6. **[Tooling](tooling.md)** — the `flatc` CLI: compile, render, headless play, gesture scripts, CI.

**Appendix — [Gotchas & best practices](dsl-gotchas.md)**: hard-won pitfalls from real production. Skim
it once you know the basics.

## Two layers, one format

- **Layer A — composition & animation**: the timeline, tweens, motion paths, the scene tree.
- **Layer B — interaction & state**: `var`s, events, expressions, the declarative interactors.

You can use just Layer A (a pure animation) or both (an interactive activity). Either way the output is
one `.flatpack` that `@flatkit/player` plays.
