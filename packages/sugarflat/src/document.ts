// ─────────────────────────────────────────────────────────────────────────────
//  document.ts — the document a sugar block expands into.
//
//  Two things a sugar MUST know and an author MUST be able to read: the canvas the gesture is laid out
//  for, and the timeline it rides. Both were literals buried inside an expander, which cost twice:
//    • the expansion never emitted `size` at all, so it fell back on the compiler's 800x600 default
//      while the board was painted for 760x620 -- everything past x=760 was clipped in silence, on the
//      whole corpus, for months (nothing says so: a missing `size` still compiles);
//    • prompting a model for the right coordinates meant reading the generator's source.
//  Exposed here, overridable per call, and stamped onto every expansion by `ensureHeader`.
// ─────────────────────────────────────────────────────────────────────────────

/** The canvas + timeline a sugar block expands into. */
export type DocumentSpec = {
  width: number
  height: number
  fps: number
  /** Timeline length. Long enough that `time` does not wrap mid-activity (the compiler warns under 120). */
  durationFrames: number
}

/** The board the gestures are laid out for. Override per call when a host uses another canvas. */
export const DEFAULT_DOCUMENT: DocumentSpec = { width: 760, height: 620, fps: 24, durationFrames: 120 }

/** `true` if the source already declares its canvas — `size` must be the FIRST statement of a program. */
export const hasSizeHeader = (src: string): boolean => /^[ \t]*size\s+-?[\d.]+\s+-?[\d.]+/m.test(src)

/** `true` if the source already declares a root timeline. */
export const hasTimelineHeader = (src: string): boolean => /^[ \t]*timeline\s+\d+/m.test(src)

/**
 * Prepend whatever header the expansion is missing. `size` is REQUIRED by the format and silently
 * defaulted by the compiler when absent, so emitting it is not a nicety: it is the difference between
 * the document the author designed and the one that gets drawn.
 */
export function ensureHeader(flatink: string, doc: DocumentSpec = DEFAULT_DOCUMENT): string {
  const head: string[] = []
  if (!hasSizeHeader(flatink)) head.push(`size ${doc.width} ${doc.height}`)
  if (!hasTimelineHeader(flatink)) head.push(`timeline ${doc.fps} ${doc.durationFrames}`)
  return head.length ? `${head.join('\n')}\n${flatink}` : flatink
}
