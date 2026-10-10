// ─────────────────────────────────────────────────────────────────────────────
//  actions.ts — the declarative interaction model (Layer B of the "scripts").
//
//  ACTIONS (play, pause, go to a frame/label, mutate a variable) are triggered by EVENTS:
//  frame-actions (at a timeline frame) and item handlers (onClick…). Everything is pure data;
//  execution goes through a HOST (the player) → testable without a player, and reusable. No `eval`.
// ─────────────────────────────────────────────────────────────────────────────

import type { Action } from '@flatkit/types'
import { DANGEROUS_KEYS } from './validateDoc'
export type { SendPayload, Action, FuncDef, FrameAction, FrameLabel, ItemEvent, Interaction } from '@flatkit/types'

/** `send` event name: a letter/"_" then letters/digits/"_"/"-" (64 max). */
export const SEND_EVENT_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/
/** Max length of a text payload (`text(…)`); truncated beyond it (defense in depth). */
export const MAX_SEND_TEXT = 4096
/** `send` record field name (`send "e", { a = … }`): a DSL identifier, 64 max. Stricter than an event
 *  name (no "-") because a field is also a bare variable in the shorthand form `{ a }`. */
export const SEND_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
/** Max number of fields in a `send` record payload → the host always receives a BOUNDED patch. */
export const MAX_SEND_FIELDS = 32
/** Is `name` usable as a `send` record field? Its name becomes a KEY in the object handed to the host,
 *  so a prototype-pollution key is rejected on top of the shape (cf. validateDoc.DANGEROUS_KEYS). */
export const isSendField = (name: string): boolean => SEND_FIELD_NAME.test(name) && !DANGEROUS_KEYS.has(name)

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

export type Budget = { n: number }

/** The surface the player exposes to the action interpreter. */
export interface ActionHost {
  play(): void
  pause(): void
  seek(frame: number): void
  labelFrame(name: string): number | undefined
  setVar(name: string, v: number): void
  /** Writes `arr[i] = v` (array variable). */
  setIndex(name: string, i: number, v: number): void
  /** `arr = fill(count, value)` — replaces the whole array (the host bounds the count). */
  fillVar(name: string, count: number, value: number): void
  /** Sets an instanced symbol's exposed param by instance name (`Door.door = open`). `value` is RAW: a
   *  state NAME (resolved against the symbol's state machine) or an expression (evaluated). No-op if
   *  the instance/param is unknown. */
  setParam(target: string, param: string, value: string): void
  /** Calls a procedure defined by `fn name(params) { … }` (params already evaluated). */
  callProc(name: string, args: number[]): void
  /** Evaluates an expression in the current runtime context (variables, time…). */
  evalNumber(src: string): number
  /** Emits a named event to the host (`send`). `fields` carries a record payload (named numeric
   *  values, a state patch). No-op if the host is not listening. */
  emit(name: string, value?: number | string, fields?: Record<string, number>): void
  /** Live content of a Text item resolved by id (`text("…")`). `''` if not found. */
  textContent(itemId: string): string
  /** Plays an audio clip (asset) one-shot (`sound "id"`). No-op if audio is off / asset is missing. */
  playSound(assetId: string): void
  /** Runs `body` with `names` as LOCAL variables: their previous values (or absence) come back after it. */
  withLocals?(names: string[], body: () => void): void
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
    case 'gotoFrame': {
      // A computed frame is read now. One that is not a number (0 / 0, a typo read as nothing) moves nothing.
      const frame = a.expr === undefined ? a.frame : host.evalNumber(a.expr)
      if (!Number.isFinite(frame)) break
      host.seek(frame)
      if (a.play === true) host.play()
      else if (a.play === false) host.pause()
      break
    }
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
    case 'fillVar': {
      // The tick budget counts ACTIONS, on the assumption each costs about the same. This one does not: it
      // writes up to a hundred thousand slots. Charge it what it writes, so a `repeat` full of them is
      // bounded by the same ceiling as everything else instead of allocating for a whole second.
      const n = Math.round(host.evalNumber(a.count))
      budget.n += Math.max(0, Math.min(n, MAX_ACTIONS_PER_TICK))
      host.fillVar(a.name, n, host.evalNumber(a.value))
      break
    }
    case 'setParam':
      host.setParam(a.target, a.param, a.value) // value RAW (state name or expr) → resolved by the host
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
      const loop = () => {
        for (let k = 0; k < n && budget.n < MAX_ACTIONS_PER_TICK; k++) {
          host.setVar(a.var, from + k)
          runList(a.body, host, budget)
        }
      }
      // The loop variable is the loop's own: a same-named global gets its value back after it.
      if (host.withLocals) host.withLocals([a.var], loop)
      else loop()
      break
    }
    case 'call':
      host.callProc(a.name, a.args.map((e) => host.evalNumber(e)))
      break
    case 'send':
      // Synchronous, return ignored, no queue: an event channel to the host (cf. ActionHost.emit).
      if (!a.payload) host.emit(a.event)
      else if (a.payload.kind === 'expr') host.emit(a.event, host.evalNumber(a.payload.expr))
      else if (a.payload.kind === 'text') host.emit(a.event, host.textContent(a.payload.itemId))
      else {
        // Record payload: the field NAMES become keys of an object handed to the host. The parser rejects
        // a malformed/dangerous name and caps the count, but a hand-written `.flatpack` never went through
        // it → re-check here (defense in depth, like MAX_SEND_TEXT for `text(…)`). Non-conforming fields
        // are dropped silently: an untrusted doc must not be able to shape the host's state patch.
        const fields: Record<string, number> = {}
        let n = 0
        for (const f of a.payload.fields) {
          if (n >= MAX_SEND_FIELDS) break
          if (!isSendField(f.name)) continue
          fields[f.name] = host.evalNumber(f.expr)
          n++
        }
        host.emit(a.event, undefined, fields)
      }
      break
    case 'sound':
      host.playSound(a.assetId)
      break
    // `wait` / `waitUntil`: nothing here. This is the run-at-once interpreter — a handler that waits goes
    // through `startTask`; a `wait` reached any other way (a procedure body, `every frame` in a pack no
    // compiler wrote) has nothing to suspend.
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

// ── Tasks: a handler that WAITS ─────────────────────────────────────────────────
//  `wait <seconds>` / `wait until <cond>` suspend the handler they are written in. Such a handler runs as
//  a TASK: the same actions, walked with an explicit stack instead of the JavaScript one, so it can stop at
//  a `wait` and go on at a later step. A list that holds no `wait` never comes here (`canWait`), and a block
//  that holds none is handed to `runAction` whole: nothing changes for a program that does not wait.

/** Simulation steps per second — a `wait` is counted in steps, never in real time, so a replay is exact. */
const STEPS_PER_SECOND = 60

type Frame = { list: Action[]; i: number; turn?: number; turns?: number; from?: number; name?: string }
/** A suspended handler: where it stopped (`stack`), and what it waits for (`steps` left, or `until`). */
export type Task = { stack: Frame[]; steps: number; until?: string }

const waits = new WeakMap<Action[], boolean>()
/** Does this list hold a `wait`, at any depth? Read once per list. */
export function canWait(actions: Action[]): boolean {
  let w = waits.get(actions)
  if (w === undefined) {
    w = actions.some((a) => a.do === 'wait' || a.do === 'waitUntil' || (a.do === 'if' && ifWaits(a)) || ((a.do === 'repeat' || a.do === 'repeatRange') && canWait(a.body)))
    waits.set(actions, w)
  }
  return w
}

const ifWaits = (a: Extract<Action, { do: 'if' }>): boolean => canWait(a.then) || (!!a.else && canWait(a.else))

/** Handlers that may wait at once. With "a handler triggered again starts over" there is at most one per
 *  handler, so this bounds a hostile document, not a real one (the largest measured holds 163). */
export const MAX_TASKS = 256

/** Runs the task until it waits (true) or ends (false). A tick budget run dry ends it, like any handler. */
function advance(task: Task, host: ActionHost, budget: Budget): boolean {
  const { stack } = task
  while (stack.length) {
    if (budget.n >= MAX_ACTIONS_PER_TICK) return false
    const f = stack[stack.length - 1]!
    if (f.i >= f.list.length) { // end of a block: another turn of its loop, or back to what holds it
      if (f.turns !== undefined && ++f.turn! < f.turns) { f.i = 0; if (f.name) host.setVar(f.name, f.from! + f.turn!) }
      else stack.pop()
      continue
    }
    const a = f.list[f.i++]!
    if (a.do === 'wait') {
      budget.n++
      const s = Math.round(host.evalNumber(a.seconds) * STEPS_PER_SECOND)
      task.steps = s >= 1 ? s : 1 // one step at least (NaN included): a wait always hands the step back
      return true
    }
    if (a.do === 'waitUntil') {
      budget.n++
      if (host.evalNumber(a.cond) !== 0) continue
      task.until = a.cond
      return true
    }
    if (a.do === 'if' && ifWaits(a)) {
      budget.n++
      const branch = host.evalNumber(a.cond) !== 0 ? a.then : a.else
      if (branch) stack.push({ list: branch, i: 0 })
    } else if (a.do === 'repeat' && canWait(a.body)) {
      budget.n++
      const turns = Math.min(MAX_REPEAT, Math.max(0, Math.floor(host.evalNumber(a.count))))
      if (turns) stack.push({ list: a.body, i: 0, turn: 0, turns })
    } else if (a.do === 'repeatRange' && canWait(a.body)) {
      budget.n++
      const from = Math.floor(host.evalNumber(a.from))
      const turns = Math.min(MAX_REPEAT, Math.max(0, Math.floor(host.evalNumber(a.to)) - from + 1))
      // A loop that waits keeps its variable in the open: it is not given back afterwards, since other
      // scripts run between two of its turns.
      if (turns) { host.setVar(a.var, from); stack.push({ list: a.body, i: 0, turn: 0, turns, from, name: a.var }) }
    } else runAction(a, host, budget)
  }
  return false
}

/** Starts a handler that may wait: runs it up to its first `wait`. Returns the task to resume at the next
 *  steps, or `null` when it ran to its end. */
export function startTask(actions: Action[], host: ActionHost): Task | null {
  const task: Task = { stack: [{ list: actions, i: 0 }], steps: 0 }
  return advance(task, host, { n: 0 }) ? task : null
}

/** One simulation step for a waiting task. Returns `true` while it still waits, `false` once it has ended.
 *  `budget` is shared by every task resumed in the step. */
export function resumeTask(task: Task, host: ActionHost, budget: Budget): boolean {
  if (task.until !== undefined) {
    if (host.evalNumber(task.until) === 0) return true
    task.until = undefined
  } else if (--task.steps > 0) return true
  // Its range loops get their variable back: another script may have written the name meanwhile.
  for (const f of task.stack) if (f.name) host.setVar(f.name, f.from! + f.turn!)
  return advance(task, host, budget)
}
