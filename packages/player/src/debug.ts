// -----------------------------------------------------------------------------
//  @flatkit/player/debug -- authoring & CI tools, NOT needed for plain playback.
//
//  Headless replay (Node, no canvas), trace output, and the gesture types. Kept out of the standard
//  `@flatkit/player` entry so a third-party page embedding the player never ships this. The live
//  gesture-recording API stays on `FlatPlayer` itself (startRecording/stopRecording).
// -----------------------------------------------------------------------------
export { playHeadless, type PlayResult, type TraceStep } from './headless'
export type { Gesture } from './player'
