# @flatkit/sugarflat

## 0.4.6

### Patch Changes

- Updated dependencies [[`0110e0a`](https://github.com/flatink/flatkit/commit/0110e0a0dc1d71fc37c58efe6eeb46af170d82e9)]:
  - @flatkit/compiler@0.39.1

## 0.4.5

### Patch Changes

- Updated dependencies [[`30605db`](https://github.com/flatink/flatkit/commit/30605db0fd1feb3334e72f89f6a404f44c0437e2)]:
  - @flatkit/compiler@0.39.0

## 0.4.4

### Patch Changes

- Updated dependencies [[`59bd47f`](https://github.com/flatink/flatkit/commit/59bd47f16d049874f9973dd0abd5e0ae86440729)]:
  - @flatkit/compiler@0.38.0

## 0.4.3

### Patch Changes

- Updated dependencies [[`7611bc8`](https://github.com/flatink/flatkit/commit/7611bc847ffb83d3328dceac8e8418a96ea75880)]:
  - @flatkit/compiler@0.37.1

## 0.4.2

### Patch Changes

- Updated dependencies [[`ebeb796`](https://github.com/flatink/flatkit/commit/ebeb796f2d03954c5955b798296f87216a592473)]:
  - @flatkit/compiler@0.37.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`9673b96`](https://github.com/flatink/flatkit/commit/9673b96063f6068d6fa85875ca81529b4fa73920), [`9ba1877`](https://github.com/flatink/flatkit/commit/9ba187778ca41d14aae99bfc2055dc4badb2cd39)]:
  - @flatkit/compiler@0.36.1

## 0.4.0

### Minor Changes

- [`b29bb4e`](https://github.com/flatink/flatkit/commit/b29bb4e482be3ffbb1242c68081e067278ff9e94) Thanks [@kaelhem](https://github.com/kaelhem)! - Keyboard access is built in: `focusable` objects are reached with Tab, clicked with Enter or Space, and
  ringed by the player.
  
  - **`focusable [order <n>] [noring]`** in an `object` block. Tab and Shift+Tab walk the focusable objects
    (ranked ones first, then document order; an object that is not shown is skipped), Enter and Space fire
    the focused object's `when clicked`, and `self.focused` is 1 on it.
  - **The player draws the focus ring** (around the object's `hitbox` when it has one). `noring` on an
    object, or the `focusRing: false` option, leave the drawing to the scene.
  - **A stop, not a trap.** The canvas joins the page's tab order (`tabindex="0"` when the scene has
    focusable objects); Tab is handled only while the canvas has the page's focus, and past either end it is
    left to the page. Using the pointer drops the keyboard focus.
  - **Host API**: `player.focused`, `player.focusNext(1 | -1)`, and the `focusRing` option.
  - **Testable**: under `flatc --play`, a `key` gesture named `Tab` moves the focus and `Enter` clicks.
  - **sugarflat**: every element of `place`, `compose` and `steps` is focusable. `place` gains a second way
    in besides dragging: pick an item (Enter, or a tap), then pick its target. A picked item is scaled up
    a little; `<block>_sel` holds its 1-based index.

- [`8bf60de`](https://github.com/flatink/flatkit/commit/8bf60dedcefc3332d280c5147543346a3dd8f3cd) Thanks [@kaelhem](https://github.com/kaelhem)! - `random()` can be reproduced, and sugar gestures can shuffle.
  
  - **`seed` option of the player.** `random()` (in `[0, 1[`, now documented) draws from a seeded generator
    when the host passes `seed`, and from `Math.random` otherwise. `load()` starts the sequence again.
  - **A headless replay is always seeded.** `flatc --play` and `playHeadless` use seed `1`, so the same
    script gives the same result twice and an `expect` can assert on a draw; `--seed N` picks another.
    `flatc --render --steps` is seeded too.
  - **sugarflat: `shuffle`.** A `shuffle` line in a `place`, `compose` or `steps` block swaps the places of
    the elements the learner picks from when the activity loads. Targets stay put, and the order of a
    `steps` sequence is unchanged. `meta[].shuffle` reports it.
  - A semantic gesture by name (`tap`, `drag`) aims at where the object stands now: it used to read a
    per-frame snapshot that a `when loaded` could have made stale.

### Patch Changes

- [`ecd419e`](https://github.com/flatink/flatkit/commit/ecd419e136906bbcd28c8740169adf71db9a8934) Thanks [@kaelhem](https://github.com/kaelhem)! - Fifteen reports from a team writing real activities, most of one family: the program compiled, `--check`
  passed, and the behavior was simply not there.
  
  **Language**
  - Several `every frame` (or `when loaded`) blocks all run, in source order. Only the last one used to.
  - `var z = 10 / 3` is evaluated like a `def` (a constant expression). It used to keep the `10` and drop the
    rest of the line. An initialiser that is not a constant is now an error.
  - `size` is read anywhere in the header. After an `asset` line it was skipped and the scene stayed 800x600.
  - Scientific notation (`1.5e2`, `2.7e-06`) is accepted in an expression, as it already was in a `var`.
  - In a `.flat`, `expr rotationDeg "a"` is the degree twin of `expr rotation`, and an unknown channel name is
    a compile error. It used to compile and animate nothing.
  
  **Checks**
  - New warning: a variable (or a function parameter) hidden by a math function, a constant, a reserved name
    or a value function of the same name -- `var angle = 40` read 0 under `use "gesture"`.
  - A variable read only inside a value function (`fn f() = G + 1`) is no longer reported "never used".
  - "overlapping hitboxes" fires only when both zones are drop targets.
  
  **Player**
  - Writing a state it is already heading to no longer restarts its transition. Mirroring a variable into a
    state from `every frame` froze an `easeInOut` transition at its origin.
  - A zero-length stroked subpath draws its cap (a disc for `round`, a square for `square`), as SVG does.
    Current Chrome follows the Canvas spec and drew nothing, so the "dot" idiom vanished.
  - Word-wrap never breaks at a no-break space (U+00A0, U+202F, U+2007).
  - A `sound` action is a silent no-op where there is no WebAudio, instead of a crash.
  
  **flatc**
  - `--play` and `--render` take the `.flat` libraries passed as arguments, like `--check` and the compile.
  - `--play`: audio is off, and `tap` accepts a point (`"x"`, `"y"`) as well as a `"target"`.
  
  **sugarflat**
  - `place`: labels that fold to the same identifier (`-1` / `+1`, `< 1` / `= 1` / `> 1`) each get their own
    object -- the first keeps the plain name, the next ones take `_2`, `_3`. Two targets with the SAME label
    are an error.
- Updated dependencies [[`357137e`](https://github.com/flatink/flatkit/commit/357137ea70e9064d6ecea56e93be827351ef2e03), [`b29bb4e`](https://github.com/flatink/flatkit/commit/b29bb4e482be3ffbb1242c68081e067278ff9e94), [`a6a462c`](https://github.com/flatink/flatkit/commit/a6a462c101c710147c279f2ea2424ebf35aa0e34), [`e6eca55`](https://github.com/flatink/flatkit/commit/e6eca55c5bc56a1506aabd6cd9c0849cff152548), [`ecd419e`](https://github.com/flatink/flatkit/commit/ecd419e136906bbcd28c8740169adf71db9a8934), [`8bf60de`](https://github.com/flatink/flatkit/commit/8bf60dedcefc3332d280c5147543346a3dd8f3cd), [`aac2a80`](https://github.com/flatink/flatkit/commit/aac2a809e926333168426538646227f4af6e2cd9)]:
  - @flatkit/compiler@0.36.0

## 0.3.21

### Patch Changes

- Updated dependencies []:
  - @flatkit/compiler@0.35.3

## 0.3.20

### Patch Changes

- Updated dependencies [[`6e51f77`](https://github.com/flatink/flatkit/commit/6e51f774f3bb138163972d48ad7c99d32dfbdc7f)]:
  - @flatkit/compiler@0.35.2

## 0.3.19

### Patch Changes

- Updated dependencies [[`ea7f916`](https://github.com/flatink/flatkit/commit/ea7f9163e88bfc53f10a502344013fb06eb2ec1e)]:
  - @flatkit/compiler@0.35.1

## 0.3.18

### Patch Changes

- Updated dependencies [[`bbd43c0`](https://github.com/flatink/flatkit/commit/bbd43c070dd77767253d2a0df697446eb3953472)]:
  - @flatkit/compiler@0.35.0

## 0.3.17

### Patch Changes

- Updated dependencies [[`71295ca`](https://github.com/flatink/flatkit/commit/71295caa82b73ff6af3ab263c6ce441f4770e291)]:
  - @flatkit/compiler@0.34.2

## 0.3.16

### Patch Changes

- Updated dependencies []:
  - @flatkit/compiler@0.34.1

## 0.3.15

### Patch Changes

- Updated dependencies [[`f4069b0`](https://github.com/flatink/flatkit/commit/f4069b076c3dd4149439fa039a7e02446e83e3ca)]:
  - @flatkit/compiler@0.34.0

## 0.3.14

### Patch Changes

- Updated dependencies [[`cf624b3`](https://github.com/flatink/flatkit/commit/cf624b30715da754fe4204251ea10291de35afa7)]:
  - @flatkit/compiler@0.33.1

## 0.3.13

### Patch Changes

- Updated dependencies [[`15bc1f0`](https://github.com/flatink/flatkit/commit/15bc1f0f433b948ed5c993b0d0131ce89d934580)]:
  - @flatkit/compiler@0.33.0

## 0.3.12

### Patch Changes

- Updated dependencies [[`dfdb538`](https://github.com/flatink/flatkit/commit/dfdb5389fd7aca3b248b26c3e2c8c53ccbe0e6d4)]:
  - @flatkit/compiler@0.32.0

## 0.3.11

### Patch Changes

- Updated dependencies [[`fda522f`](https://github.com/flatink/flatkit/commit/fda522ff266d62877539b88abaa63ab24b894a82)]:
  - @flatkit/compiler@0.31.1

## 0.3.10

### Patch Changes

- Updated dependencies [[`dd832fe`](https://github.com/flatink/flatkit/commit/dd832fe9aa6b0edd62ab58d9e76bba46081dde8e)]:
  - @flatkit/compiler@0.31.0

## 0.3.9

### Patch Changes

- Updated dependencies [[`9371b38`](https://github.com/flatink/flatkit/commit/9371b387b67b6f26dc4058bcd366dd3125013506)]:
  - @flatkit/compiler@0.30.2

## 0.3.8

### Patch Changes

- Updated dependencies [[`85781eb`](https://github.com/flatink/flatkit/commit/85781eb40378d4d7413f291e46ea7c0773b66866)]:
  - @flatkit/compiler@0.30.1

## 0.3.7

### Patch Changes

- Updated dependencies [[`ba7878a`](https://github.com/flatink/flatkit/commit/ba7878a9f2117268f44549a254b9202957a83cf9)]:
  - @flatkit/compiler@0.30.0

## 0.3.6

### Patch Changes

- Updated dependencies [[`307c60e`](https://github.com/flatink/flatkit/commit/307c60e34ab9022981ffc7f533bf87ba4f790364), [`6bb9674`](https://github.com/flatink/flatkit/commit/6bb9674e354a1b47b7590adc01e0280b63ffbc9f), [`9f6eba5`](https://github.com/flatink/flatkit/commit/9f6eba54be796ee24a6eb83b15a7b113176724cc)]:
  - @flatkit/compiler@0.29.2

## 0.3.5

### Patch Changes

- Updated dependencies [[`83bea35`](https://github.com/flatink/flatkit/commit/83bea35551dd84ab48cba834df815502a9766664), [`8f9837e`](https://github.com/flatink/flatkit/commit/8f9837ee38755d4e1cf1836f021d3089a115b710)]:
  - @flatkit/compiler@0.29.1

## 0.3.4

### Patch Changes

- Updated dependencies [[`96c4f4e`](https://github.com/flatink/flatkit/commit/96c4f4e2d4871ed398e5551bd13e423ec8ce93e3)]:
  - @flatkit/compiler@0.29.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`1d72dd7`](https://github.com/flatink/flatkit/commit/1d72dd7f0ee3bda7222209d80f142b2087654912)]:
  - @flatkit/compiler@0.28.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`7b14d89`](https://github.com/flatink/flatkit/commit/7b14d894b8e101a411851811b129950488602d93)]:
  - @flatkit/compiler@0.27.0

## 0.3.1

### Patch Changes

- [`eefb7d6`](https://github.com/flatink/flatkit/commit/eefb7d674c624914136d1f251aa246e058b8bc12) Thanks [@kaelhem](https://github.com/kaelhem)! - Make the documentation a test, because three times it promised a form the parser rejected.

  `raw { ... }` on one line (the README wrote it that way), decor in a plain `raw` (the card taught it),
  and now a block written inline (the compound example showed it). Each was found by a consumer rather
  than by us, and the class of defect is always the same: the docs and the code disagree. Every sugar
  example in the README and every escape-hatch form in `sugarCard()` is now desugared and compiled by a
  test - which immediately found two more in our own README: an object id left unprefixed after the
  compound change, and a full-canvas backdrop written as `raw scene` (drawn ON TOP, hiding the activity)
  where it needed `raw scene under`.

  A block written on one line now names the rule and shows the block laid out, instead of reporting
  `unrecognised line`.

## 0.3.0

### Minor Changes

- [`943eef4`](https://github.com/flatink/flatkit/commit/943eef4031006b0090d0c1bbdaf9f7f1191970ba) Thanks [@kaelhem](https://github.com/kaelhem)! - A document may hold several blocks.

  Composing gestures was never a matter of concatenating their output: a program has exactly one `scene`,
  one header and one behavior half, so two whole programs cannot be merged after the fact. A gesture now
  returns PARTS - its `var` lines, its layers, its behavior - and the assembly puts them in the three
  places the format has. `MultipleGesturesError` is gone.

  Two decisions the assembly makes, both testable rather than promised:

  - **Names are prefixed by the block's name, ALWAYS**, including when a document holds one block
    (`words_TNouns`, `coins_C0`). Prefixing only on collision would mean the same source compiles to
    different names depending on whether a sibling exists, so a skin written against one block would break
    the day a second arrived. Every id is now in `meta[].objects`, so nothing has to be guessed.
  - **`completed` belongs to the DOCUMENT.** Each block emits `part` with its own index when its portion is
    finished; `completed` fires once, when every block is done. With a single block the two coincide, which
    is what `completed` always meant. Payloads carry `{ block = i, item = j }`, so a host can tell two
    blocks apart without depending on what a theme drew.

  BREAKING: `meta` is now an array, one entry per block, in document order. Object ids and variables carry
  the block prefix. Two blocks with the same name raise `DuplicateBlockError`.

## 0.2.2

### Patch Changes

- [`e90cf8d`](https://github.com/flatink/flatkit/commit/e90cf8d4e05790ac7cd0fa38fad2d5223e27d17b) Thanks [@kaelhem](https://github.com/kaelhem)! - Put top-level `raw { ... }` content where its statements are legal.

  `var` (like `asset`, `use`, `def`) is a HEADER declaration and a parse error after `scene`, and a `raw`
  block written below the gesture landed exactly there: the documented example in the README compiled to
  an error. `object` and `fn` are accepted on either side, so the header position is the only one where
  all of it works - everything top-level now goes before the expansion, wherever the author wrote it.
  Moving an `object` up changes nothing, since behavior binds by name and not by position.

  Also: the one-line form no longer carries the spaces that hugged its braces into the output.

## 0.2.1

### Patch Changes

- Updated dependencies [[`3d3e34b`](https://github.com/flatink/flatkit/commit/3d3e34b9b37e59068992d422924d112c573ce832)]:
  - @flatkit/compiler@0.26.0

## 0.2.0

### Minor Changes

- [`c87c115`](https://github.com/flatink/flatkit/commit/c87c1158af4ccedd0a8c6139a4bdafa9beaa10f8) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix the escape hatch, and give the host what the gesture parsed.

  - **`raw { ... }` beside a gesture was dropped in SILENCE.** Only the block's body was read; everything
    outside it - before or after - never travelled. Since a gesture emits no appearance by design, the
    escape hatch is the only route to an activity that is not a greybox, and it was closed: an author
    wrote decor, the expansion compiled, `checkProgram` said ok, and nothing was there. Anything written
    beside the block now travels with it, `raw` or plain FlatInk.
  - **New `raw scene { ... }`** splices verbatim INSIDE the generated scene. A program may only have one
    `scene` block, so this is the one place decor can go, and no hatch reached it.
  - **A second gesture block raises `MultipleGesturesError`** instead of being quietly ignored. Each
    gesture emits its own scene, so two cannot be merged; say so rather than drop one.
  - **`desugar()` returns `meta`**: the prompt the gesture parsed, and the labels behind the payload
    indices (`{ item = 2 }` is `meta.items[2]`). `place` parsed its prompt and threw it away, so the one
    text a host must display was recoverable only by re-parsing the block - a second parser waiting to
    drift. All three gestures now also write the prompt into the expansion as a comment.
  - **Footprints are in the reference a model is prompted with.** Each `summary` states the size of what
    it places, and the new `sugarCard()` assembles grammar, canvas and footprints in one pasteable block.
    Measured: a prompt without the numbers produced overlapping hitboxes in 4 of 10 activities, 0 of 10
    with them. The sizes were public all along; nothing said to go and read them.

## 0.1.1

### Patch Changes

- Updated dependencies [[`c60b730`](https://github.com/flatink/flatkit/commit/c60b7302466c7643824335a28b0f9c1743cc3604)]:
  - @flatkit/compiler@0.25.0
