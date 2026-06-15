// ─────────────────────────────────────────────────────────────────────────────
//  stdlib.sources.ts — the SOURCE OF TRUTH for the embedded stdlib packages, as DSL text.
//
//  This module contains ONLY strings: it does not import the parser. It feeds the GENERATION
//  (scripts/gen-stdlib.ts → stdlib.generated.ts) and the TESTS. The runtime consumes the
//  pre-compiled AST (stdlib.generated.ts) and therefore does NOT depend on the DSL parser
//  (the player plays already-compiled .flatpack).
//
//  NB: after any change here, regenerate: `pnpm --filter @flatkit/engine gen:stdlib`.
// ─────────────────────────────────────────────────────────────────────────────

/** DSL sources of the embedded packages (name → `fn` definitions). */
export const PACKAGE_SOURCES: Record<string, string> = {
  // Collision detection (boxes & circles). Return 1/0 (≠0 = "true" for `if`).
  collision: `
fn boxHit(ax, ay, bx, by, hw, hh) = abs(ax - bx) < hw && abs(ay - by) < hh
fn dist(ax, ay, bx, by) = hypot(ax - bx, ay - by)
fn near(ax, ay, bx, by, r) = hypot(ax - bx, ay - by) < r
`,
  // Easing curves (t ∈ 0..1 → eased t).
  easing: `
fn easeIn(t) = t * t
fn easeOut(t) = 1 - (1 - t) * (1 - t)
fn easeInOut(t) = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
fn smooth(t) = t * t * (3 - 2 * t)
`,
  // Gestures: PURE helpers to constrain/snap a drag position (use them inside `when dragged`).
  // The axis is constrained by binding a single channel (`x = px` without `y =`); here we cover grid,
  // rail (segment AB), angle (a knob to turn) and a drop zone. railX/railY reuse railT.
  // NB: `angle` returns RADIANS — the `rotation` channel is in radians (like sin/cos/atan2).
  gesture: `
fn snap(v, step) = round(v / step) * step
fn snapTo(v, target, r) = abs(v - target) < r ? target : v
fn railT(px, py, ax, ay, bx, by) = clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)), 0, 1)
fn railX(px, py, ax, ay, bx, by) = ax + (bx - ax) * railT(px, py, ax, ay, bx, by)
fn railY(px, py, ax, ay, bx, by) = ay + (by - ay) * railT(px, py, ax, ay, bx, by)
fn angle(cx, cy, px, py) = atan2(py - cy, px - cx)
fn inZone(px, py, x, y, w, h) = px >= x && px <= x + w && py >= y && py <= y + h
`,
  // Feedback: stateless reactions for interactive elements, driven by self.hovered/self.grabbed (0/1).
  // Use as channel bindings: scaleX = lift(self.hovered), opacity = dim(self.hovered),
  // scaleY = tilt(self.grabbed), y = sink(self.grabbed), rotation = shake(wrong, time). The `feedback …`
  // DSL sugar generates these lines for you. (settle-bounce needs a release timestamp → not stateless.)
  // `pulse(since, dur)` = a 1→0 linear ramp over `dur` seconds since the instant `since` (so a feedback
  // text/flash stays readable, vs a too-fast multiplicative decay). Capture the instant in a handler:
  // `var shown = -999` + `when wrong { shown = time }`, then `opacity = pulse(shown, 4)`. Stateless: the
  // author supplies the timestamp, nothing hidden.
  feedback: `
fn lift(h) = h ? 1.06 : 1
fn dim(h) = h ? 0.85 : 1
fn tilt(g) = g ? 0.94 : 1
fn sink(g) = g ? 2 : 0
fn shake(bad, t) = bad ? sin(t * 40) * 4 : 0
fn pulse(since, dur) = clamp(1 - (time - since) / dur, 0, 1)
`,
}
