// -----------------------------------------------------------------------------
//  runtime/index.ts -- public surface of the FlatInk runtime (player + drawing core).
//  Importable on its own, without anything from the editor. The played format = the FlatInk `Doc` JSON.
// -----------------------------------------------------------------------------
export { FlatPlayer, sameOriginAssetResolver, type PlayerOptions } from './player'
// `Gesture` stays here (FlatPlayer.stopRecording returns Gesture[]). The headless replay tools
// (playHeadless, trace) live under `@flatkit/player/debug` — not needed for plain playback.
export type { Gesture } from './player'
export { renderLayers, renderItems, regionPath, applyTransform } from './drawScene'
export { evaluateTimeline, resolveInstanceFrame } from '@flatkit/engine/timeline'
export { resolveLayerAt } from '@flatkit/engine/cel'
export { polygonsToPath, pathToPolygons, pathToBezier, transformPath, translatePath, pathBBox, clonePath } from '@flatkit/engine/path'
export type { Doc, Timeline, TimelineTrack, Keyframe, Easing, Item, Layer, Region, Cel, Pose, Path, Subpath, Seg } from '@flatkit/types'
