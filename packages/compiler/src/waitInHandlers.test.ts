import { describe, it, expect } from 'vitest'
import { playHeadless } from '@flatkit/player/debug'
import { parseUnits, printUnits } from '@flatkit/engine/dsl'
import { compileFlatpack } from './compile'
import { checkProgram } from './check'

// `wait` in a handler (RFC "wait in handlers", step 1): "do this, wait, do that" without a hand-written
// state machine in `every frame`. A handler that waits becomes a TASK, resumed at the start of each
// simulation step (60 Hz), before `every frame`. Everything is counted in steps, so a replay is exact.
const scene = 'size 200 100\nscene { layer "l" {\n  group "Btn" at 20,20 { layer "c" { rect 0 0 40 40 fill #cc3333 } }\n  group "Other" at 120,20 { layer "c" { rect 0 0 40 40 fill #3333cc } }\n} }\n'
const prog = (vars: string, behavior: string) => `${vars}\n${scene}${behavior}\n`
const play = (src: string, gestures: Parameters<typeof playHeadless>[1]) => playHeadless(compileFlatpack(src), gestures, { settle: 0 }).vars
const tap = (target: string) => ({ type: 'tap' as const, target })
const steps = (frames: number) => ({ type: 'wait' as const, frames })

describe('wait <seconds>', () => {
  const src = prog('var a = 0\nvar b = 0', 'object "Btn" { when clicked {\n  a = a + 1\n  wait 0.5\n  b = b + 1\n} }')
  it('compiles and checks clean', () => {
    expect(checkProgram(src).report).toBe('')
  })
  it('what comes before the wait runs at once, what comes after runs 30 steps later — not 29', () => {
    expect(play(src, [tap('Btn')])).toMatchObject({ a: 1, b: 0 })
    expect(play(src, [tap('Btn'), steps(29)])).toMatchObject({ a: 1, b: 0 })
    expect(play(src, [tap('Btn'), steps(30)])).toMatchObject({ a: 1, b: 1 })
  })
  it('the duration is an expression, read when the wait is reached', () => {
    const s = prog('var d = 1\nvar b = 0', 'object "Btn" { when clicked {\n  d = 0.1\n  wait d\n  b = 1\n} }')
    expect(play(s, [tap('Btn'), steps(5)]).b).toBe(0)
    expect(play(s, [tap('Btn'), steps(6)]).b).toBe(1)
  })
  it('a wait of zero, or of nonsense, still yields one step: it never runs on in the same step', () => {
    const s = prog('var b = 0', 'object "Btn" { when clicked {\n  wait 0\n  b = 1\n} }')
    expect(play(s, [tap('Btn')]).b).toBe(0)
    expect(play(s, [tap('Btn'), steps(1)]).b).toBe(1)
  })
  it('resumes BEFORE `every frame` of the same step', () => {
    const s = prog('var b = 0\nvar seen = -1', 'object "Btn" { when clicked {\n  wait 0\n  b = 7\n} }\nevery frame { if seen < 0 { if b > 0 { seen = b } } }')
    expect(play(s, [tap('Btn'), steps(1)]).seen).toBe(7)
  })
})

describe('wait until <condition>', () => {
  const src = prog('var ready = 0\nvar b = 0', 'object "Btn" { when clicked {\n  wait until ready > 0\n  b = b + 1\n} }\nobject "Other" { when clicked { ready = 1 } }')
  it('holds while the condition is false, whatever the time', () => {
    expect(play(src, [tap('Btn'), steps(600)]).b).toBe(0)
  })
  it('goes on at the first step that finds it true', () => {
    expect(play(src, [tap('Btn'), steps(10), tap('Other')]).b).toBe(0)
    expect(play(src, [tap('Btn'), steps(10), tap('Other'), steps(1)]).b).toBe(1)
  })
  it('already true when reached: no pause at all', () => {
    expect(play(src, [tap('Other'), tap('Btn')]).b).toBe(1)
  })
})

describe('inside blocks', () => {
  it('in an `if`: the rest of the branch, then the rest of the handler', () => {
    const s = prog('var n = 0', 'object "Btn" { when clicked {\n  if n == 0 {\n    n = 1\n    wait 0.1\n    n = n + 10\n  }\n  n = n + 100\n} }')
    expect(play(s, [tap('Btn')]).n).toBe(1)
    expect(play(s, [tap('Btn'), steps(6)]).n).toBe(111)
  })
  it('in a `repeat n times`: one pause per turn', () => {
    const s = prog('var n = 0', 'object "Btn" { when clicked {\n  repeat 3 times {\n    n = n + 1\n    wait 0.1\n  }\n  n = n + 100\n} }')
    expect(play(s, [tap('Btn')]).n).toBe(1)
    expect(play(s, [tap('Btn'), steps(6)]).n).toBe(2)
    expect(play(s, [tap('Btn'), steps(12)]).n).toBe(3)
    expect(play(s, [tap('Btn'), steps(18)]).n).toBe(103)
  })
  it('in a `repeat i from a to b`: the loop variable is right after each pause, even if another script wrote it', () => {
    const s = prog('var sum = 0', 'object "Btn" { when clicked {\n  repeat i from 1 to 3 {\n    wait 0.1\n    sum = sum + i\n  }\n} }\nobject "Other" { when clicked { i = 50 } }')
    expect(play(s, [tap('Btn'), steps(3), tap('Other'), steps(15)]).sum).toBe(6)
  })
  it('a `repeat` that does not wait still runs all at once', () => {
    const s = prog('var n = 0', 'object "Btn" { when clicked {\n  repeat 5 times { n = n + 1 }\n  wait 1\n  n = 0\n} }')
    expect(play(s, [tap('Btn')]).n).toBe(5)
  })
})

describe('re-entrance: a handler triggered again while it waits starts over', () => {
  const src = prog('var a = 0\nvar b = 0', 'object "Btn" { when clicked {\n  a = a + 1\n  wait 0.5\n  b = b + 1\n} }')
  it('the waiting run is dropped: its end never happens', () => {
    const v = play(src, [tap('Btn'), steps(20), tap('Btn'), steps(20)])
    expect(v).toMatchObject({ a: 2, b: 0 }) // 40 steps after the first tap, which would have been due at 30
  })
  it('…and the new one runs to its own end', () => {
    expect(play(src, [tap('Btn'), steps(20), tap('Btn'), steps(30)])).toMatchObject({ a: 2, b: 1 })
  })
  it('two different handlers wait side by side', () => {
    const s = prog('var b = 0\nvar c = 0', 'object "Btn" { when clicked {\n  wait 0.5\n  b = 1\n} }\nobject "Other" { when clicked {\n  wait 0.1\n  c = 1\n} }')
    expect(play(s, [tap('Btn'), tap('Other'), steps(6)])).toMatchObject({ b: 0, c: 1 })
    expect(play(s, [tap('Btn'), tap('Other'), steps(30)])).toMatchObject({ b: 1, c: 1 })
  })
})

describe('other places a handler lives', () => {
  it('`when loaded`', () => {
    const s = prog('var b = 0', 'when loaded {\n  wait 0.1\n  b = 1\n}')
    expect(play(s, [steps(5)]).b).toBe(0)
    expect(play(s, [steps(6)]).b).toBe(1)
  })
  it('`at frame n`', () => {
    const s = prog('timeline 60 600\nvar b = 0', 'at frame 2 {\n  wait 0.1\n  b = 1\n}')
    expect(play(s, [steps(2), steps(5)]).b).toBe(0)
    expect(play(s, [steps(2), steps(6)]).b).toBe(1)
  })
  it('`self` is still the handler\'s object after the pause', () => {
    const s = prog('var x = 0', 'object "Btn" { when clicked {\n  wait 0.1\n  x = self.x\n} }')
    expect(play(s, [tap('Btn'), steps(6)]).x).toBe(20)
  })
  it('a `go to` run by a waiting handler does not drop it', () => {
    const s = prog('timeline 60 600\nvar b = 0', 'object "Btn" { when clicked {\n  go to frame 100 and play\n  wait 0.1\n  b = 1\n} }')
    expect(play(s, [tap('Btn'), steps(6)]).b).toBe(1)
  })
})

describe('where `wait` is refused', () => {
  it('in `every frame`: a compile error that says what to write instead', () => {
    const r = checkProgram(prog('var b = 0', 'every frame {\n  wait 1\n  b = 1\n}'))
    expect(r.ok).toBe(false)
    expect(r.report).toContain('`wait` cannot be used in `every frame`')
  })
  it('in a `fn`', () => {
    const r = checkProgram(prog('var b = 0', 'fn later() {\n  wait 1\n  b = 1\n}\nobject "Btn" { when clicked { later() } }'))
    expect(r.ok).toBe(false)
    expect(r.report).toContain('`wait` cannot be used in a `fn`')
  })
  it('a missing duration', () => {
    expect(checkProgram(prog('var b = 0', 'object "Btn" { when clicked {\n  wait\n  b = 1\n} }')).report).toContain('`wait <seconds>` or `wait until <condition>`')
  })
  it('an unknown name in the duration or the condition is reported like in any expression', () => {
    expect(checkProgram(prog('var b = 0', 'object "Btn" { when clicked {\n  wait until nope > 0\n  b = 1\n} }')).report).toContain('nope')
  })
})

describe('more handlers that wait than the player keeps', () => {
  const many = (n: number) => prog('timeline 60 600\nvar b = 0', Array.from({ length: n }, (_, i) => `at frame ${i + 1} {\n  wait 1\n  b = b + 1\n}`).join('\n'))
  it('--check warns past 256, and says what happens then', () => {
    expect(checkProgram(many(256)).report).toBe('')
    const r = checkProgram(many(257))
    expect(r.ok).toBe(true)
    expect(r.report).toContain('257 handlers hold a `wait`: the player keeps at most 256')
  })
})

describe('the example of the documentation', () => {
  it('compiles, checks clean and plays as told', () => {
    const src = 'size 800 200\nvar opened = 0\nvar px = 100\nasset "creak" "creak.mp3" sound\nscene { layer "l" {\n  group "Door" at 20,20 { layer "c" { rect 0 0 40 40 fill #cc3333 } }\n  group "Player" at 100,20 { layer "c" { rect 0 0 10 10 fill #3333cc } }\n} }\nobject "Player" { x = px }\nobject "Door" {\n  when clicked {\n    opened = 1\n    wait 1.5\n    sound "creak"\n    wait until Player.x > 400\n    opened = 0\n  }\n}\nevery frame { px = px + 2 }\n'
    expect(checkProgram(src).errors).toBe(0)
    expect(play(src, [tap('Door'), steps(151)]).opened).toBe(1) // 90 steps of wait, then Player.x is read at the start of each step
    expect(play(src, [tap('Door'), steps(152)]).opened).toBe(0) // …and is past 400 once 151 steps have moved it
  })
})

describe('what does not change', () => {
  it('`wait` is still a fine name for a variable', () => {
    const s = prog('var wait = 0', 'object "Btn" { when clicked { wait = 3 } }')
    expect(checkProgram(s).report).toBe('')
    expect(play(s, [tap('Btn')]).wait).toBe(3)
  })
  it('the text round-trips', () => {
    const text = 'when loaded {\n  wait 1.5\n  wait until score > 3\n}\n'
    expect(printUnits(parseUnits(text).units)).toBe(text)
  })
})
