// ─────────────────────────────────────────────────────────────────────────────
//  contracts.ts — what each gesture must DO, independently of the DSL it writes.
//
//  These are the safety net for the rewrite, and they are deliberately NOT text goldens. The gestures
//  were stripped of their composition (no coordinate invented, no colour, no font), so the `.flatink`
//  they emit changed completely — a golden comparing text would have gone red on every line without
//  telling us whether the activity still worked.
//
//  A contract instead says: play these gestures, and these events must come out in this order with the
//  state in this shape. It survived the rewrite, which is the whole property we needed. It also earned
//  its keep before the rewrite began — see the note on the flash overlay below.
// ─────────────────────────────────────────────────────────────────────────────
import type { Gesture as PlayGesture } from '@flatkit/player/debug'

export type Contract = {
  /** The gesture keyword this exercises. */
  keyword: string
  /** The source, as an author (or a model) writes it. */
  source: string
  /** What a learner does. Semantic gestures (by NAME) — they survive a change of layout. */
  script: PlayGesture[]
  /** The events the run must emit, in order. */
  sends: string[]
  /** State that must hold at the end. */
  vars: Record<string, number>
}

/**
 * ⚠️ Found by this net, in the sugar as it shipped, before a line was rewritten.
 *
 * Every gesture used to paint a full-canvas red `Flash` rect on the topmost layer, bound to a decaying
 * `ko`. It carried no `nohit`, so for the ~40 frames the decay took it swallowed every pointer event:
 * the learner made a mistake and the activity stopped responding — at the exact moment they retried.
 *
 * The rewrite does not emit it at all. Feedback of that kind is appearance, so it belongs to a theme or
 * to a skin — and whoever adds it back must mark it `nohit`. The scripts below need no wait any more,
 * which is the cleanest possible proof the defect is gone.
 */
export const FLASH_OVERLAY_WAS_HIT_TESTABLE = 'fixed by the rewrite: no overlay is emitted'

export const CONTRACTS: Contract[] = [
  {
    keyword: 'place',
    source: `place natures {
  prompt "Put each word under its part of speech"
  target Nouns at 230,470
  target Verbs at 530,470
  item cat  -> Nouns at 150,150
  item run  -> Verbs at 310,150
  item house -> Nouns at 470,150
  item jump -> Verbs at 630,150
}
`,
    script: [
      { type: 'drag', source: 'natures_Icat', target: 'natures_TVerbs' }, // wrong on purpose: it must go back and stay live
      // Two gestures on the SAME object need a frame between them: the pointer has to be seen up before
      // it can be seen down again. Without it the second drag is a silent no-op — `--play` reports a
      // gesture that did nothing exactly as it reports one that worked, which is worth knowing.
      { type: 'wait', frames: 1 },
      { type: 'drag', source: 'natures_Icat', target: 'natures_TNouns' },
      { type: 'drag', source: 'natures_Irun', target: 'natures_TVerbs' },
      { type: 'drag', source: 'natures_Ihouse', target: 'natures_TNouns' },
      { type: 'drag', source: 'natures_Ijump', target: 'natures_TVerbs' },
      { type: 'wait', frames: 1 },
    ],
    sends: ['incorrect', 'correct', 'correct', 'correct', 'correct', 'part', 'completed'],
    vars: { natures_progress: 4, natures_done: 1 },
  },
  {
    keyword: 'place',
    source: `place placed_once {
  prompt "Each item lands once"
  target Home at 200,400
  item only -> Home at 100,100
}
`,
    script: [
      { type: 'drag', source: 'placed_once_Ionly', target: 'placed_once_THome' },
      { type: 'wait', frames: 1 },
      { type: 'drag', source: 'placed_once_Ionly', target: 'placed_once_THome' }, // already placed: the drag is gated off
      { type: 'wait', frames: 1 },
    ],
    sends: ['correct', 'part', 'completed'],
    vars: { placed_once_progress: 1, placed_once_done: 1 },
  },
  {
    keyword: 'steps',
    source: `steps escape {
  prompt "Solve the three riddles in order"
  step "Rewire the circuit" at 180,330
  step "Enter the code" at 380,330
  step "Open the airlock" at 580,330
}
`,
    script: [
      { type: 'tap', target: 'escape_S1' }, // out of order: gated, must do nothing at all
      { type: 'tap', target: 'escape_S0' },
      { type: 'tap', target: 'escape_S1' },
      { type: 'tap', target: 'escape_S2' },
      { type: 'wait', frames: 1 },
    ],
    sends: ['step', 'step', 'step', 'part', 'completed'],
    vars: { escape_step: 3 },
  },
  {
    keyword: 'compose',
    source: `compose coins {
  prompt "Make exactly 250"
  total 250
  chip 50  at 250,440
  chip 100 at 510,440
}
`,
    script: [
      { type: 'tap', target: 'coins_C1' },
      { type: 'tap', target: 'coins_C1' },
      { type: 'tap', target: 'coins_C1' }, // 300 > 250: overshoot resets the total
      { type: 'tap', target: 'coins_C1' },
      { type: 'tap', target: 'coins_C1' },
      { type: 'tap', target: 'coins_C0' },
      { type: 'wait', frames: 1 },
    ],
    sends: ['correct', 'correct', 'incorrect', 'correct', 'correct', 'correct', 'part', 'completed'],
    vars: { coins_total: 250, coins_done: 1 },
  },
]
