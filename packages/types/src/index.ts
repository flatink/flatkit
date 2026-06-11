// FlatInk data model + ALL shared engine types.
//
// TYPE ARCHITECTURE: this file is the single owner of both the "model" types AND the engine types
// (Path, Paint, Transform, Timeline, Cel, Actions…). It imports ONLY from `geom.ts` (the leaf). Engine
// modules import their types from HERE and export only VALUES (functions/consts). The result is an
// acyclic type graph (verified by `madge --circular`).
//
// A Region = ONE connected piece of material, stored as a Bezier path (`path`). Subpath convention:
// subpaths[0] = outer contour, subpaths[1..n] = holes (even-odd rule at render). Material produced by
// drawing has CLOSED subpaths with no handles (rendered smoothed, like the legacy polygons).

import type { Point, BBox } from './geom'
export type { Point, Polygon, BBox } from './geom'

// ═══════════════════════════════════════════════════════════════════════════
//  Engine types (moved out of the engine modules to break type cycles).
// ═══════════════════════════════════════════════════════════════════════════

// ── Expressions ──────────────────────────────────────────────────────────────
export type ExprContext = Record<string, number | number[] | ((...a: number[]) => number) | Record<string, number>>

// ── 2×3 affine transform ─────────────────────────────────────────────────────
export type Transform = { a: number; b: number; c: number; d: number; e: number; f: number }

// ── Bezier path ──────────────────────────────────────────────────────────────
/** A segment: an anchor point plus optional tangent handles (absolute coordinates). */
export type Seg = { anchor: Point; inHandle?: Point; outHandle?: Point }
/** A subpath: a sequence of segments, open or closed. */
export type Subpath = { closed: boolean; segments: Seg[] }
/** A path: a set of subpaths (contour + holes, multi-piece). */
export type Path = { subpaths: Subpath[] }

// ── Material / clipping ──────────────────────────────────────────────────────
// Pure types (no clipping engine): they live here so that read-side consumers (bbox → drawScene →
// player) can reference the shape WITHOUT pulling the boolean-ops module (and thus the Clipper2/WASM
// engine) into their graph.
/** A closed ring, closing point not duplicated. */
export type Ring = Point[]
/** A connected polygon: [contour, ...holes]. */
export type PolyGroup = Ring[]
/** A "material": a set of disjoint polygons (multipolygon). */
export type Shape = PolyGroup[]

// ── Paint ────────────────────────────────────────────────────────────────────
export type Stop = { offset: number; color: string }

/** A Flash-style "tint" color effect: recolors a container toward `color` by `amount` (0..1). */
export type Tint = { color: string; amount: number }

/** Blend mode (Flash / After Effects style). `add`/`screen` = additive light (glow, mixing); `multiply` = shadow. */
export type BlendMode = 'add' | 'screen' | 'multiply'

// `box` = absolute reference box (document space) the gradient geometry is anchored to → the gradient
// stays CONTINUOUS across cuts (Flash's "gradient transform").
export type Paint =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: Stop[]; box?: BBox } // angle in degrees (0 = →, 90 = ↓)
  | { type: 'radial'; cx: number; cy: number; r: number; stops: Stop[]; box?: BBox } // cx,cy,r normalized 0..1

/** A region stroke: width + paint (solid OR gradient), cap/join style, dashes. */
export type Stroke = {
  width: number
  paint: Paint
  cap?: 'butt' | 'round' | 'square' // default 'round'
  join?: 'miter' | 'round' | 'bevel' // default 'round'
  miterLimit?: number
  dash?: number[] // dash pattern (empty/absent = solid line)
}

// ── Filters ──────────────────────────────────────────────────────────────────
export type Filter =
  | { type: 'blur'; radius: number } // Gaussian blur (px)
  | { type: 'shadow'; dx: number; dy: number; blur: number; color: string } // drop shadow
  | { type: 'glow'; blur: number; color: string } // glow (offset-less shadow, all around)
  | { type: 'adjust'; brightness?: number; contrast?: number; saturate?: number; hue?: number } // brightness/contrast/saturation (×, 1=neutral), hue (deg)

// ── Timeline model ───────────────────────────────────────────────────────────
/** Easing curve. `cubic` = control points, CSS cubic-bezier style. */
export type Easing =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | { cubic: [number, number, number, number] }

/** Spin direction of a tween (absent = shortest arc). */
export type SpinDir = 'cw' | 'ccw'

export type Keyframe = {
  frame: number // position (may be fractional at playback, integer when authored)
  transform?: Transform // absolute pose (container) / relative to identity (region)
  opacity?: number // 0..1
  color?: string // solid fill (hex #rrggbb[aa]) — solid-fill regions
  paint?: Paint // animated gradient fill — gradient regions
  tint?: Tint // Flash-style "tint" color effect — containers
  visible?: boolean
  easing?: Easing // curve TOWARD the next keyframe (default 'linear')
  rotate?: SpinDir // spin direction TOWARD the next keyframe (absent = shortest arc)
  turns?: number // extra full turns (with rotate; default 0)
}

/** Channels animatable by expression (= the decomposed components + opacity). */
export type ExprChannel = 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity'

export type TimelineTrack = {
  id: string
  targetId: string // id of an Item in the timeline's scope
  keyframes: Keyframe[] // sorted by frame (invariant kept by the store)
  /** Per-channel expressions (`rotation = sin(time)*20`); take priority over interpolation. */
  expressions?: Partial<Record<ExprChannel, string>>
}

/** Audio clip placed on the timeline: references an asset, starts at `startFrame`. */
export type SoundClip = { id: string; assetId: string; startFrame: number; gain?: number; loop?: boolean; name?: string }

/** A CONTENT (material) keyframe — frame-by-frame / stop-motion: a snapshot of the drawing. */
export type ContentKey = { frame: number; items: Region[] }
/** Content track of a material layer (frame-by-frame animation, no interpolation). */
export type ContentTrack = { layerId: string; keyframes: ContentKey[] }

export type Timeline = {
  fps: number // default 24
  durationFrames: number // total length (frames)
  tracks: TimelineTrack[]
  /** Frame-by-frame material animation (per layer); HOLD, never tweened. */
  contentTracks?: ContentTrack[]

  sounds?: SoundClip[] // placed audio tracks (read by the player/editor)

  // ── interaction (Layer B) ──
  labels?: FrameLabel[] // named markers
  frameActions?: FrameAction[] // actions triggered at a frame (stop, gotoFrame…)
  onLoad?: Action[] // actions on load (once)
  onEnterFrame?: Action[] // actions every frame (during playback)
  binds?: InstanceBind[] // collective bindings: `each "Symbol" as i { channel = expr }`
}

/** Collective binding rule: binds ALL instances of a symbol, with a per-instance index.
 *  `each "<symbol>" as <as> { opacity = data[i] … }` — the player expands it on load. */
export type InstanceBind = {
  symbol: string // name of the targeted symbol
  as: string // name of the index variable (per instance, document order)
  expr: Partial<Record<ExprChannel, string>> // bound channels
}

export type PlaybackMode = 'synced' | 'singleFrame' | 'independent'
export type InstancePlayback = {
  mode: PlaybackMode
  frame?: number // for singleFrame
  speed?: number // reserved (independent)
  loop?: boolean // reserved (independent)
}

// ── Actions / interaction ────────────────────────────────────────────────────
/**
 * Payload of a `send`: numeric (DSL expression) or textual (`text("itemId")`, the live content of a
 * Text item). Discriminated for an exact parse/print round-trip.
 */
export type SendPayload =
  | { kind: 'expr'; expr: string } // send "x", <numeric expr>
  | { kind: 'text'; itemId: string } // send "x", text("itemId")

export type Action =
  | { do: 'play' }
  | { do: 'pause' }
  | { do: 'gotoFrame'; frame: number; play?: boolean } // play absent = does not change the state
  | { do: 'gotoLabel'; label: string; play?: boolean }
  | { do: 'setVar'; name: string; value: string } // value = expression evaluated by the host
  | { do: 'setIndex'; name: string; index: string; value: string } // arr[index] = value (array)
  | { do: 'if'; cond: string; then: Action[]; else?: Action[] } // cond = expression; runs `then` if ≠ 0
  | { do: 'repeat'; count: string; body: Action[] } // count = expression; BOUNDED repeats (anti-loop)
  | { do: 'repeatRange'; var: string; from: string; to: string; body: Action[] } // repeat i from <from> to <to> (inclusive, bounded)
  | { do: 'call'; name: string; args: string[] } // procedure call: name(args) — args = expressions
  | { do: 'send'; event: string; payload?: SendPayload } // emit a named event to the host (Moiki)
  | { do: 'sound'; assetId: string } // play an audio clip (asset) one-shot — triggered by a handler

/** Reusable function: pure value (usable in an expression) or procedure (action block). */
export type FuncDef = { name: string; params: string[] } & (
  | { kind: 'value'; expr: string } // fn dist(a, b) = …
  | { kind: 'proc'; body: Action[] } // fn launch() { … }
)

/** Actions triggered when the playhead reaches `frame`. */
export type FrameAction = { frame: number; actions: Action[] }
/** Named marker on the timeline (target of gotoLabel). */
export type FrameLabel = { frame: number; name: string }
/** Item event: click, hover enter/leave, pointer (press/release/drag/longpress), and `drop`
 *  (released over a named zone; requires `over`). */
export type ItemEvent = 'click' | 'enter' | 'leave' | 'press' | 'release' | 'drag' | 'longpress' | 'drop'
/** Interaction: an event on an item triggers actions (Layer B). `over` = named zone (event `drop`). */
export type Interaction = { id: string; targetId: string; event: ItemEvent; over?: string; atPointer?: boolean; actions: Action[] }

/**
 * "drag" interactor: moves an item with the mouse and writes its position into EXPLICIT variables. A
 * declarative front-end → produces the same mutations as a hand-written handler. `axis`: 'xy' (both),
 * 'x' (dragX), 'y' (dragY). `confine` = name of a zone (clamp to its bbox). `grid` = snap.
 */
export type Interactor = {
  targetId: string
  // 'turn' = rotation→angle (varX); 'trace' = follow a path→progress 0..1 (varX);
  // 'reveal' = scratch/wipe→revealed fraction 0..1 (varX); 'link' = drag a thread→endX/endY (varX/varY) + target index (varT).
  axis: 'xy' | 'x' | 'y' | 'turn' | 'trace' | 'reveal' | 'link'
  varX?: string // X output (axes 'xy'/'x'), ANGLE in degrees ('turn'), PROGRESS 0..1 ('trace'), revealed FRACTION 0..1 ('reveal'), or the thread's endX ('link')
  varY?: string // Y output variable (axes 'xy' and 'y') or the thread's endY (axis 'link')
  varT?: string // axis 'link': INDEX (1..n) of the target reached on release, 0 if none
  confine?: string // clamp zone (drag); name of the GROUP-path to follow ('trace'); name of the GROUP of targets ('link')
  grid?: number // snap: grid step (drag, px), angle step (turn, degrees), TOLERANCE (trace, px), or BRUSH radius (reveal, px)
  enabled?: string // expression: the drag is active only when it is true (≠ 0); absent = always active (dynamic lock, no ternary pattern)
  pivot?: Point // WORLD rotation center for axis 'turn' (the object points toward the cursor)
}

// ── "cel" model ──────────────────────────────────────────────────────────────
/** Presence + pose of a container at a keyframe (matched by `id` across cels). */
export type Pose = {
  id: string // id of a container in the roster (`layer.items`)
  transform?: Transform // absolute pose (absent = identity)
  opacity?: number // 0..1 (absent = 1)
  tint?: Tint // Flash-style tint (absent = none)
  spin?: SpinDir // spin direction TOWARD the next cel (absent = shortest arc)
  turns?: number // extra full turns (with `spin`)
  filters?: Filter[] // filter stack at this key (interpolated across the tween)
}

/** Layer-wide keyframe: the full content of the layer at `frame`. */
export type Cel = {
  frame: number
  poses: Pose[] // present containers (empty = no symbol)
  matter?: Region[] // drawing at this key. OMITTED = HOLD from the last key that defines it; `[]` = empty.
  tween?: boolean // interpolate THIS cel → the next (containers present in both). default: HOLD.
  shapeTween?: boolean // interpolate the SHAPE of the material from this cel → the next (morph). default: HOLD.
  ease?: Easing // span curve (default linear)
}

/** Per-object interaction state exposed to channel expressions as `self.hovered`/`self.grabbed`/`self.pressed` (0/1). */
export type ItemInteractionState = { hovered: number; grabbed: number; pressed: number }

/** Resolution context (container expressions + guide layer). `itemState` lets channel expressions read the
 *  object's own interaction state (`self.hovered`…); the PLAYER provides it, absent elsewhere (flags → 0). */
export type ResolveOpts = { fps?: number; ctx?: ExprContext; guide?: Path; orient?: boolean; parent?: Transform; itemState?: (id: string) => ItemInteractionState | undefined }

// ═══════════════════════════════════════════════════════════════════════════
//  Document model
// ═══════════════════════════════════════════════════════════════════════════

export type Region = {
  id: string
  color: string // representative color (solid fallback / compat)
  path: Path // Bezier path (migrated material = closed subpaths without handles)
  paint?: Paint // optional rich paint (gradient); absent = solid `color`
  stroke?: Stroke // stroke; absent = none
  noFill?: boolean // true = no fill (path/stroke only, e.g. a pen line)
  xform?: Transform // accumulated display orientation (transform frame) — geometry stays baked; present = "oriented object" (no re-merge)
  opacity?: number // object opacity 0..1 (absent = 1)
  filters?: Filter[] // filter stack (blur/shadow/glow/adjust) — rendered via offscreen composition (cf. group/leaf)
  hidden?: boolean // hidden in the outliner (absent = visible)
  noHit?: boolean // non-interactive: ignored by the player's hit-test (clicks/hover pass through), still VISIBLE (absent = interactive)
}

/**
 * GROUP (Ctrl+G, Flash style): a TRANSIENT container — a transform plus its own layers, edited in place
 * (double-click), movable/tweenable as an object on its parent's track. NOT in the library, not reusable,
 * and WITHOUT its own internal timeline: to animate the content, turn it into a SYMBOL (F8 → SymbolDef +
 * Instance). `timeline?` is LEGACY (no longer produced by the editor): kept for reading/rendering old
 * docs, MIGRATED to a symbol on open (cf. liftAnimatedGroups).
 */
export type Group = {
  id: string
  kind: 'group'
  name: string
  transform: Transform
  layers: Layer[]
  timeline?: Timeline // LEGACY (internal animation) — migrated to a library symbol on open
  opacity?: number // 0..1 (absent = 1)
  tint?: Tint // Flash-style "tint" color effect (absent = none)
  hidden?: boolean // hidden in the outliner (absent = visible)
  noHit?: boolean // non-interactive: ignored by the player's hit-test (clicks/hover pass through), still VISIBLE
  pivot?: Point // transform point in LOCAL coords (center of rotation/scale AND interpolation); absent = origin {0,0}
  filters?: Filter[] // filter stack (blur/shadow/glow/adjust) — animatable
  blend?: BlendMode // blend mode (add/screen = additive light, multiply = shadow); absent = normal
  hitbox?: { w: number; h: number } // EXPLICIT drop zone (local rect centered on the origin, ±w/2 × ±h/2): used as the `when dropped on` target instead of the content bbox; avoids invisible paths
  expressions?: Partial<Record<ExprChannel, string>> // expression animation (cel model) — takes priority over the tween
}

/** Instance of a reusable symbol: a transform + a reference to the symbol. */
export type Instance = {
  id: string
  kind: 'instance'
  name: string
  transform: Transform
  symbolId: string
  opacity?: number // 0..1 (absent = 1)
  tint?: Tint // Flash-style "tint" color effect (absent = none)
  hidden?: boolean // hidden in the outliner (absent = visible)
  noHit?: boolean // non-interactive: ignored by the player's hit-test (clicks/hover pass through), still VISIBLE
  pivot?: Point // transform point in LOCAL coords (center of rotation/scale AND interpolation); absent = origin {0,0}
  playback?: InstancePlayback // playback mode of the symbol's timeline (absent = synced)
  filters?: Filter[] // filter stack (blur/shadow/glow/adjust) — animatable
  blend?: BlendMode // blend mode (add/screen = additive light, multiply = shadow); absent = normal
  expressions?: Partial<Record<ExprChannel, string>> // expression animation (cel model) — takes priority over the tween
}

/**
 * Library folder (pure organization, Flash style): a tree by `parent`. SYMBOLS stay FLAT (referenced by
 * name/id) — a folder does not nest them, it just files them away.
 */
export type Folder = {
  id: string
  name: string
  parent?: string // id of the parent folder (absent = library root)
  collapsed?: boolean // collapsed in the symbol list
}

/** Reusable definition (Flash MovieClip-style symbol) stored in the library. */
export type SymbolDef = {
  id: string
  name: string
  layers: Layer[]
  timeline?: Timeline // the symbol's own animation (absent = static)
  folderId?: string // owning library folder (absent = root)
}

/**
 * "live" (editable) text: a leaf item animatable like a container (transform/opacity/tint, pivot). LOCAL
 * origin = top-left corner; text flows toward (box.w, box.h). `box` = measured extent (updated by the
 * editor via measureText) → pure bbox/hit without a canvas.
 */
export type Text = {
  id: string
  kind: 'text'
  name: string
  transform: Transform
  content: string
  font: string // CSS font stack (e.g. "Geist, sans-serif")
  size: number // px in local coords
  align: 'left' | 'center' | 'right'
  lineHeight: number // multiplier (e.g. 1.25)
  color: string // fill (solid) — `#rrggbb(aa)`
  weight?: number // 400 / 700 (absent = 400)
  italic?: boolean
  box: { w: number; h: number } // measured local extent (max line width × total height)
  wrap?: boolean // automatic line wrapping within `box.w` (absent = no wrap; honors explicit \n)
  bind?: string // numeric expression evaluated each frame → injected into `content` at the `{}` slot (read-only dynamic text; without `{}`, shows the value alone)
  decimals?: number // fixed decimals for the `bind` value (absent = integer if round, otherwise rounded to 3)
  /** `id` explicitly set by the author via `text "…" as "<id>"` (≠ auto-generated id). Drives the
   *  printing of `as` in the flatFormat DSL. */
  idExplicit?: boolean
  opacity?: number
  tint?: Tint
  hidden?: boolean
  noHit?: boolean // non-interactive: ignored by the player's hit-test (clicks/hover pass through), still VISIBLE
  pivot?: Point
  filters?: Filter[] // filter stack — animatable
  blend?: BlendMode // blend mode (add/screen = additive light, multiply = shadow); absent = normal
  expressions?: Partial<Record<ExprChannel, string>> // expression (channel) animation — takes priority over the pose
}

/** Bitmap image: a leaf item animatable like text. References an asset; `w`/`h` = intrinsic size in px
 * (local coords, origin = top-left corner). */
export type Image = {
  id: string
  kind: 'image'
  name: string
  transform: Transform
  assetId: string
  w: number
  h: number
  opacity?: number
  tint?: Tint
  hidden?: boolean
  noHit?: boolean // non-interactive: ignored by the player's hit-test (clicks/hover pass through), still VISIBLE
  pivot?: Point
  filters?: Filter[] // filter stack — animatable
  blend?: BlendMode // blend mode (add/screen = additive light, multiply = shadow); absent = normal
  expressions?: Partial<Record<ExprChannel, string>> // expression (channel) animation — takes priority over the pose
}

/** Layer content: material, one-off group, symbol instance, text, or image. */
export type Item = Region | Group | Instance | Text | Image

/** Embedded asset (media) — the `Doc.assets` registry. `data` = base64 data-URI (media) or raw SVG text ('svg'). */
export type Asset = {
  id: string
  kind: 'image' | 'audio' | 'video' | 'font' | 'svg'
  name: string
  mime: string
  data: string // data:URI (base64)
}

export type Layer = {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number // 0..1
  items: Item[] // static content; with `cels`, = the ROSTER of containers (material lives in the cels)
  cels?: Cel[] // layer-wide keyframes (cel model); absent = static layer
  // ── Folder organization (flat model) ──
  isFolder?: boolean // true = folder (organization, no material); absent = content layer
  parent?: string // id of the parent folder (absent = scope root)
  collapsed?: boolean // folder collapsed in the outliner
  isMask?: boolean // true = CONTAINER mask layer: its material clips its CHILD layers (parent=it)
  maskOff?: boolean // clipping disabled (icon toggle) — children stay visible, unclipped
  isGuide?: boolean // true = guide layer: its material = motion path (not rendered); its CHILDREN (parent=it) follow it
  orientToGuide?: boolean // on a GUIDED layer: orient its containers along the guide tangent
}

export type Doc = {
  width: number
  height: number
  background?: string // page background color (absent = white)
  layers: Layer[]
  symbols: SymbolDef[]
  folders?: Folder[] // library folders (symbol organization) — absent = no folder
  assets?: Asset[] // embedded media (images/sounds/fonts/videos) — referenced by id
  timeline?: Timeline // root scene animation (absent = static)
  variables?: Record<string, number | number[]> // named state (Layer B) — scalar or array; read by expressions (arr[i]), mutated by actions
  imports?: string[] // imported packages (use "…") — functions from the embedded stdlib
  functions?: FuncDef[] // reusable functions (fn …) — value (expr) or procedure (actions)
  interactions?: Interaction[] // events (onClick) → actions
  interactors?: Interactor[] // direct-manipulation behaviors (drag …) → write variables
}

/** Edit-navigation step (breadcrumb): a one-off group or an entry into a symbol. */
export type EditFrame =
  | { kind: 'group'; id: string; name: string }
  | { kind: 'symbol'; symbolId: string; name: string }

export type Tool = 'brush' | 'rect' | 'ellipse' | 'eraser' | 'fill' | 'select' | 'transform' | 'text' | 'pan' | 'pen' | 'pathselect' | 'ink'
