// ─────────────────────────────────────────────────────────────────────────────
//  drawingCard.ts — TERSE reference of the DRAWING half of FlatInk, "system-prompt" sized.
//
//  `languageCard` covers BEHAVIOR (events, channels, expressions) and not one word of the composition:
//  no shapes, no paints, no filters. An integrator handing that card to a model and asking for decor was
//  handing it a reference with nothing about drawing — so the model guessed, and what a model guesses in
//  a DSL does not compile. The two cards are complements: pair them (plus `docToManifest` for the names
//  of a particular scene) whenever a model has to produce a whole `.flatink`.
//
//  Every ```flatink example below is COMPILED by drawingCard.test.ts. A reference that is copied drifts;
//  one that is compiled cannot. When the grammar moves, that test goes red rather than this card going
//  quietly wrong.
// ─────────────────────────────────────────────────────────────────────────────

/** Drawing reference card (composition: shapes, paints, filters, text, clipping). */
export function drawingCard(): string {
  return `# FlatInk — drawing (the \`scene { … }\` half)

The unit is the LAYER: \`layer "name" { … }\`, stacked bottom to top. A layer holds shapes, text, images
and groups (which nest their own layers). Coordinates are PIXELS in the parent's frame — never percentages.

## Shapes
circle  <cx> <cy> <r>
ellipse <cx> <cy> <rx> <ry>
rect    <x> <y> <w> <h> [<r>]              // r = rounded corners (or <rx> <ry> for distinct)
path    "M0 0 C40 -20 80 20 120 0 Z"       // raw SVG path data — total freedom
circle 100 100 40 as "Ring"                // name it (right after the geometry) → addressable

## Paint
fill #rrggbb | #rrggbbaa · nofill
fill linear(<angle>, 0:#…, 1:#…)           // angle: 0 = →, 90 = ↓ ; stops are offset:color
fill radial(<cx>, <cy>, <r>, 0:#…, 1:#…)   // cx/cy/r as 0..1 of the box
stroke <paint> <width> [cap butt|round|square] [join miter|round|bevel] [miter <n>] [dash a,b]
opacity <0..1>                             // opacities MULTIPLY down the tree

## Filters — on any item, no wrapper group needed
filter glow <blur> <color> · filter shadow <dx> <dy> <blur> <color>
filter blur <radius> · filter adjust <brightness> <contrast> <saturate> <hue>

## Text
text "…" at <x>,<y> box <w> <h> font "sans-serif" size <n> align center line 1.2 color #… [bold] [italic] [wrap]
text "…" along "<shapeId>" align center start 0.5     // laid along a named shape's curve
Word-wrap is OPT-IN: without \`wrap\`, only an explicit \\n breaks a line.

## Images
image "<assetId>" <w> <h> at <x>,<y>       // the asset is declared at the top: asset "logo" "logo.svg" image

## Clipping
group "Name" at x,y clip <x> <y> <w> <h> { … }    // rectangular cut, in the group's LOCAL coordinates
mask layer "Name" { <shapes>  layer "c" { … } }   // arbitrary shape: the mask's matter clips its child layers

## The five rules that decide whether it compiles
1. WORD ORDER IS FIXED: content → \`as "…"\` → \`at …\` → style. So \`text "Hi" at 10,10 box 200 40\`,
   NEVER \`text "Hi" box 200 40 at 10,10\`. A shape names itself right after its geometry.
   Stroke options (\`cap\`/\`join\`/\`miter\`/\`dash\`) belong to the STROKE and follow it directly:
   \`nofill stroke #888 2 dash 6,5\`, not \`stroke #888 2 nofill dash 6,5\`.
2. A COMMENT STARTS WITH \`//\`. A \`#\` opens a COLOR.
3. ONE STATEMENT PER LINE.
4. Anything you intend to ANIMATE must be a \`group "Name" at x,y { layer "c" { … } }\`. An \`object\`
   block aimed at a shape or a layer is a compile ERROR — shapes are baked material and carry no pose.
5. A group's children are positioned RELATIVE to it. Draw them around 0,0 and place the group.

## Examples

A sky and a ground, in two gradients:

\`\`\`flatink
size 960 540
scene {
  layer "sky" {
    rect 0 0 960 540 fill linear(90, 0:#1b2a4a, 1:#4a6fa5)
    ellipse 780 90 70 70 fill radial(0.5, 0.5, 0.5, 0:#ffe9a8, 1:#ffe9a800)
  }
  layer "ground" {
    path "M0 430 C240 400 420 460 960 415 L960 540 L0 540 Z" fill #2e4b34 opacity 0.85
  }
}
\`\`\`

A line-art silhouette and a drop shadow:

\`\`\`flatink
size 200 400
scene {
  layer "tree" {
    path "M60 300 L60 180 M60 220 L20 170 M60 230 L100 180" nofill stroke #23301f 8 cap round
    circle 60 150 60 fill #3f6b3a filter shadow 0 6 12 #00000055
  }
}
\`\`\`

A group — the only shape a behavior block can animate:

\`\`\`flatink
size 480 320
scene {
  layer "life" {
    group "Cloud" at 240,120 {
      layer "c" {
        ellipse 0 0 70 26 fill #ffffff opacity 0.22
        ellipse 46 -10 44 22 fill #ffffff opacity 0.18
      }
    }
  }
}

object "Cloud" {
  dx = 30 * sin(clock)
}
\`\`\`

A panel, text, and a clipped porthole:

\`\`\`flatink
size 960 540
scene {
  layer "panel" {
    rect 40 40 300 90 24 fill #10141c99 stroke #ffffff33 2
    text "Workshop" at 60,66 box 260 40 font "sans-serif" size 26 color #f2f6ff
    group "Porthole" at 700,300 clip -60 -60 120 120 {
      layer "c" { circle 0 0 90 fill linear(0, 0:#0b3d5c, 1:#0f6f92) }
    }
  }
}
\`\`\``
}
