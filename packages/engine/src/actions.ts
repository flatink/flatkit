// ─────────────────────────────────────────────────────────────────────────────
//  actions.ts — the declarative interaction model (Layer B of the "scripts").
//
//  ACTIONS (play, pause, go to a frame/label, mutate a variable) are triggered by EVENTS:
//  frame-actions (at a timeline frame) and item handlers (onClick…). Everything is pure data;
//  execution goes through a HOST (the player) → testable without a player, and reusable. No `eval`.
// ─────────────────────────────────────────────────────────────────────────────

import type { Action } from '@flatkit/types'
export type { SendPayload, Action, FuncDef, FrameAction, FrameLabel, ItemEvent, Interaction } from '@flatkit/types'

/** `send` event name: a letter/"_" then letters/digits/"_"/"-" (64 max). */
export const SEND_EVENT_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/
/** Max length of a text payload (`text(…)`); truncated beyond it (defense in depth). */
export const MAX_SEND_TEXT = 4096

/**
 * Cap on the number of repetitions of a SINGLE `repeat` block. The language has NO infinite loop
 * ("forever" is done via the onEnterFrame event).
 */
export const MAX_REPEAT = 100_000

/**
 * Global cap on the TOTAL number of actions executed in one `runActions()` invocation (i.e. one event /
 * one tick). A per-block clamp is NOT enough: nested `repeat`s MULTIPLY (100k × 100k = 10^10), which would
 * freeze the tab for an untrusted `.flatpack`. This shared budget bounds the whole action tree regardless
 * of nesting depth, so a tick is always a finite, bounded computation.
 */
export const MAX_ACTIONS_PER_TICK = 200_000

type Budget = { n: number }

/** The surface the player exposes to the action interpreter. */
export interface ActionHost {
  play(): void
  pause(): void
  seek(frame: number): void
  labelFrame(name: string): number | undefined
  setVar(name: string, v: number): void
  /** Writes `arr[i] = v` (array variable). */
  setIndex(name: string, i: number, v: number): void
  /** Calls a procedure defined by `fn name(params) { … }` (params already evaluated). */
  callProc(name: string, args: number[]): void
  /** Evaluates an expression in the current runtime context (variables, time…). */
  evalNumber(src: string): number
  /** Emits a named event to the host (`send`). No-op if the host is not listening. */
  emit(name: string, value?: number | string): void
  /** Live content of a Text item resolved by id (`text("…")`). `''` if not found. */
  textContent(itemId: string): string
  /** Plays an audio clip (asset) one-shot (`sound "id"`). No-op if audio is off / asset is missing. */
  playSound(assetId: string): void
}

function runAction(a: Action, host: ActionHost, budget: Budget): void {
  if (budget.n++ >= MAX_ACTIONS_PER_TICK) return // tick budget exhausted → bail (anti-freeze)
  switch (a.do) {
    case 'play':
      host.play()
      break
    case 'pause':
      host.pause()
      break
    case 'gotoFrame':
      host.seek(a.frame)
      if (a.play === true) host.play()
      else if (a.play === false) host.pause()
      break
    case 'gotoLabel': {
      const f = host.labelFrame(a.label)
      if (f !== undefined) {
        host.seek(f)
        if (a.play === true) host.play()
        else if (a.play === false) host.pause()
      }
      break
    }
    case 'setVar':
      host.setVar(a.name, host.evalNumber(a.value))
      break
    case 'setIndex':
      host.setIndex(a.name, Math.round(host.evalNumber(a.index)), host.evalNumber(a.value))
      break
    case 'if':
      // Language convention: a value ≠ 0 is "true" (cf. expr.ts).
      if (host.evalNumber(a.cond) !== 0) runList(a.then, host, budget)
      else if (a.else) runList(a.else, host, budget)
      break
    case 'repeat': {
      // `count` rounded, clamped to [0, MAX_REPEAT] → finite, never blocking (NaN → 0).
      const n = Math.min(MAX_REPEAT, Math.max(0, Math.floor(host.evalNumber(a.count))))
      for (let i = 0; i < n && budget.n < MAX_ACTIONS_PER_TICK; i++) runList(a.body, host, budget)
      break
    }
    case 'repeatRange': {
      // `repeat i from A to B`, inclusive. The loop variable is set in the context (setVar) at each step.
      // Clamped to MAX_REPEAT steps (anti-freeze; NaN/inverted bounds → 0 iterations).
      const from = Math.floor(host.evalNumber(a.from))
      const to = Math.floor(host.evalNumber(a.to))
      const n = Math.min(MAX_REPEAT, Math.max(0, to - from + 1))
      for (let k = 0; k < n && budget.n < MAX_ACTIONS_PER_TICK; k++) {
        host.setVar(a.var, from + k)
        runList(a.body, host, budget)
      }
      break
    }
    case 'call':
      host.callProc(a.name, a.args.map((e) => host.evalNumber(e)))
      break
    case 'send':
      // Synchronous, return ignored, no queue: an event channel to the host (cf. ActionHost.emit).
      if (!a.payload) host.emit(a.event)
      else if (a.payload.kind === 'expr') host.emit(a.event, host.evalNumber(a.payload.expr))
      else host.emit(a.event, host.textContent(a.payload.itemId))
      break
    case 'sound':
      host.playSound(a.assetId)
      break
  }
}

function runList(actions: Action[], host: ActionHost, budget: Budget): void {
  for (const a of actions) {
    if (budget.n >= MAX_ACTIONS_PER_TICK) return
    runAction(a, host, budget)
  }
}

/** Run a list of actions in order. Each call is one event/tick with its own bounded execution budget. */
export function runActions(actions: Action[], host: ActionHost): void {
  runList(actions, host, { n: 0 })
}
