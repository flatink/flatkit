// Pure geometric primitives — the LEAF of the type graph (imports nothing).
// Everything else in the model and the engine depends on these; nothing depends on them in
// return → this guarantees an acyclic type graph.

export type Point = {
  x: number
  y: number
}

/** A closed ring (the closing point is not duplicated). */
export type Polygon = Point[]

/** Axis-aligned bounding box (alignment, snapping, marquee hit-test). */
export type BBox = { minX: number; minY: number; maxX: number; maxY: number }
