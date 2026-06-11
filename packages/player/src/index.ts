// -----------------------------------------------------------------------------
//  runtime/index.ts -- public surface of the FlatInk runtime (player + drawing core).
//  Importable on its own, without anything from the editor. The played format = the FlatInk `Doc` JSON.
// -----------------------------------------------------------------------------
export { FlatPlayer, sameOriginAssetResolver, type PlayerOptions } from './player'
export { playHeadless, type PlayResult, type TraceStep, type Gesture } from './headless'
export { renderLayers, renderItems, regionPath, applyTransform } from './drawScene'
export { evaluateTimeline, resolveInstanceFrame } from '@flatkit/engine/timeline'
export { resolveLayerAt } from '@flatkit/engine/cel'
export { polygonsToPath, pathToPolygons, pathToBezier, transformPath, translatePath, pathBBox, clonePath } from '@flatkit/engine/path'
export type { Doc, Timeline, TimelineTrack, Keyframe, Easing, Item, Layer, Region, Cel, Pose, Path, Subpath, Seg } from '@flatkit/types'
