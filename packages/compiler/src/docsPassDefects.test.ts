import { describe, it, expect } from 'vitest'
import { playHeadless } from '@flatkit/player/debug'
import { parseFlatLib } from '@flatkit/engine/flatFormat'
import { compileFlatpack } from './compile'
import { checkProgram, repairLoop } from './check'

// Defects found by the documentation pass of 2026-10-09: each example of the guides was compiled and each
// claim replayed, and these are the places where the CODE, not the page, was wrong.
const stage = 'size 300 300\nvar a = 0\nscene { layer "c" { group "X" at 20,20 { layer "a" { rect 0 0 10 10 fill #333333 } } } }\n'

describe('a statement written on the `object` line itself', () => {
  const src = stage + 'object "X" { when clicked { a = a + 1  send "ok", 1 } }\n'
  it('its diagnostic gives the column in the FILE, not in the block', () => {
    const d = checkProgram(src).diagnostics.find((x) => /two statements on one line/.test(x.message))!
    expect(d).toMatchObject({ line: 4, col: src.split('\n')[3]!.indexOf('a + 1') + 1 })
  })
  it('so `--fix` can split it: the repair lands where the second statement starts', () => {
    const { text, applied } = repairLoop(src, checkProgram(src).diagnostics, (t) => checkProgram(t).diagnostics)
    expect(applied).toBe(1)
    expect(checkProgram(text).errors).toBe(0)
    expect(playHeadless(compileFlatpack(text), [{ type: 'tap', target: 'X' }]).sends.map((s) => s.name)).toEqual(['ok'])
  })
  it('`feedback` on the `object` line is the same sugar as on its own line', () => {
    const one = checkProgram(stage + 'object "X" { feedback lift dim }\n')
    expect(one.errors).toBe(0)
    const item = (src: string) => (compileFlatpack(src).layers[0]!.items[0] as { expressions?: Record<string, string> }).expressions
    expect(item(stage + 'object "X" { feedback lift dim }\n')).toEqual(item(stage + 'object "X" {\n  feedback lift dim\n}\n'))
  })
  it('…and a `feedback` followed by the closing brace keeps the brace', () => {
    expect(checkProgram(stage + 'object "X" {\n  when pressed { }\n  feedback tilt }\n').errors).toBe(0)
  })
})

describe('warnings that said `1:1`, or pointed at the wrong shape', () => {
  const at = (src: string, re: RegExp) => checkProgram(src).diagnostics.find((d) => re.test(d.message))
  it('`draw` on a shape with no stroke: the line of that shape', () => {
    const src = 'size 300 300\nvar p = 0\nscene {\n  layer "c" {\n    rect 0 0 10 10 fill #333333\n    path "M0 0 L50 50" fill #ff0000 draw "p"\n  }\n}\nevery frame { p = p + 0.01 }\n'
    expect(at(src, /`draw` on a shape with no `stroke`/)).toMatchObject({ line: 6 })
  })
  it('a filter under a transform that never settles: the line of the item it names', () => {
    const src = 'size 300 300\nscene {\n  layer "c" {\n    rect 0 0 10 10 fill #333333\n    group "G" at 20,20 filter blur 4 { layer "a" { rect 0 0 10 10 fill #333333 } }\n  }\n}\nobject "G" { x = 20 + 5 * sin(clock) }\n'
    expect(at(src, /filter under a transform/)).toMatchObject({ line: 5 })
  })
  it('two paths that START alike: the overlap warning names the one that overlaps, and lands on it', () => {
    const plain = '    path "M0 0 L40 0 L40 40 L0 40 Z" fill #333333'
    const holed = '    path "M0 0 L40 0 L40 40 L0 40 Z M20 20 L60 20 L60 60 L20 60 Z" fill #333333'
    const src = `size 300 300\nscene {\n  layer "c" {\n${plain}\n${holed}\n  }\n}\n`
    const d = at(src, /two of its contours run the same way/)!
    expect(d).toMatchObject({ line: 5 })
    // …and whichever comes first in the file.
    expect(at(`size 300 300\nscene {\n  layer "c" {\n${holed}\n${plain}\n  }\n}\n`, /two of its contours/)).toMatchObject({ line: 4 })
  })
})

describe('a text addressed by its `as "<id>"` is an object like another', () => {
  const texts = 'size 300 300\nscene {\n  layer "c" {\n    text "chat" as "Word1" at 20,20 size 20 color #000000 box 80 30\n    text "dort" as "Word2" at 120,20 size 20 color #000000 box 80 30\n    group "Good" at 40,200 hitbox 80 80 { layer "a" { rect -40 -40 80 80 fill #33aa33 } }\n    group "Bad" at 160,200 hitbox 80 80 { layer "a" { rect -40 -40 80 80 fill #aa3333 } }\n  }\n}\n'
  it('a variable written by its handlers is known to the rest of the program', () => {
    const src = texts + 'object "Word1" {\n  drag tx, ty\n  when clicked { v = 1 }\n}\nobject "Good" { opacity = 1 - 0.5 * v + 0 * tx }\n'
    expect(checkProgram(src).report).toBe('')
  })
  it('a gesture script names it by that id', () => {
    const src = texts + 'object "Word1" { when clicked { send "hit" } }\n'
    expect(playHeadless(compileFlatpack(src), [{ type: 'tap', target: 'Word1' }]).sends.map((s) => s.name)).toEqual(['hit'])
  })
  it('`match` over texts checks clean, and `text(it)` sends what the item shows', () => {
    const src = texts + 'match Word1, Word2 onto Good, Bad {\n  correct Word1 -> Good, Word2 -> Bad\n  on correct as it { send "found", text(it) }\n  on done { send "win" }\n}\n'
    expect(checkProgram(src).report).toBe('')
    const r = playHeadless(compileFlatpack(src), [{ type: 'drag', source: 'Word1', target: 'Good' }, { type: 'drag', source: 'Word2', target: 'Bad' }])
    expect(r.sends).toEqual([{ name: 'found', value: 'chat' }, { name: 'found', value: 'dort' }, { name: 'win' }])
  })
})

describe('writes that did nothing, in silence', () => {
  const warn = (src: string, re: RegExp) => checkProgram(src).diagnostics.find((d) => re.test(d.message))
  it('`hx[2] = 1` on a name that is not an array: a warning on that line, with the declaration to write', () => {
    const src = stage + 'object "X" {\n  when clicked {\n    hx[2] = 1\n  }\n}\n'
    expect(warn(src, /"hx" is not an array/)).toMatchObject({ severity: 'warning', line: 6 })
    expect(warn(src, /"hx" is not an array/)!.message).toContain('var hx = fill(<n>, 0)')
  })
  it('…also when the name is a plain number variable', () => {
    expect(warn(stage + 'object "X" { when clicked { a[0] = 1 } }\n', /"a" is not an array/)).toBeDefined()
  })
  it('a declared array, or one made by `fill` somewhere, says nothing', () => {
    expect(warn(stage.replace('var a = 0', 'var a = 0\nvar hx = fill(4, 0)') + 'object "X" { when clicked { hx[2] = 1 } }\n', /is not an array/)).toBeUndefined()
    expect(warn(stage + 'when loaded { hx = fill(4, 0) }\nobject "X" { when clicked { hx[2] = 1 } }\n', /is not an array/)).toBeUndefined()
  })
  const door = 'size 200 200\nvar score = 9\nsymbol "Door" {\n  timeline 24 24\n  states door { closed at 0   open at 24   initial closed   transition 12 }\n  layer "c" { group "P" at 0,0 { layer "x" { rect 0 0 20 40 fill #885500 } } }\n}\nscene { layer "l" { instance "Door" as "FrontDoor" at 50,50 } }\n'
  it('a state name inside an expression (`cond ? open : closed`): a warning that says how to write it', () => {
    const d = warn(door + 'object "FrontDoor" { when clicked { FrontDoor.door = score > 5 ? open : closed } }\n', /a state name is only read when it is the WHOLE value/)
    expect(d).toMatchObject({ severity: 'warning', line: 9 })
    expect(d!.message).toMatch(/"closed" is an unknown name, read as 0/)
  })
  it('a bare state, a number, and an expression that names no state say nothing', () => {
    for (const v of ['open', '0.5', 'score / 10', 'open from closed'])
      expect(checkProgram(door + `object "FrontDoor" { when clicked { FrontDoor.door = ${v} } }\n`).report).not.toMatch(/state|FrontDoor\.door/)
  })
})

describe('a `spring` / `smooth` on a channel that has none', () => {
  const lib = (mod: string) => `symbol "S" {\n  params { number a = 0 }\n  layer "c" { group "G" at 0,0 ${mod} { layer "x" { circle 0 0 5 fill #ff0000 } } }\n}\n`
  it('`spring dx` in a library is a compile error, as it is in an `object` block — it compiled and did nothing', () => {
    expect(() => parseFlatLib(lib('spring dx "a" stiffness 0.1 damping 0.8'))).toThrow(/unknown channel "dx" in a `spring`/)
    expect(() => parseFlatLib(lib('smooth dy "a" k 0.2'))).toThrow(/unknown channel "dy" in a `smooth`/)
    expect(() => parseFlatLib(lib('smooth colour "a" k 0.2'))).toThrow(/unknown channel "colour"/)
  })
  it('the channels that do have one still go through, `rotationDeg` included', () => {
    for (const ch of ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'rotationDeg', 'opacity'])
      expect(() => parseFlatLib(lib(`smooth ${ch} "a" k 0.2`))).not.toThrow()
  })
})

describe('an object that follows a guide layer', () => {
  const src = (orient: string) => `size 300 200\ntimeline 60 120\nvar gx = 0\nvar gy = 0\nvar gr = 0\nvar sy = 0\nscene {\n  guide layer "Track" {\n    path "M0 0 C50 100 150 100 200 0" nofill stroke #000000 1\n    layer "c"${orient} {\n      group "G" at 0,0 { layer "x" { circle 0 0 5 fill #ff0000 } }\n      cel 0 tween { pose "G" at 0,0 }\n      cel 60 { pose "G" at 200,0 }\n    }\n  }\n}\nevery frame {\n  gx = G.x\n  gy = G.y\n  gr = G.rotation\n}\nobject "G" { when clicked { sy = self.y } }\n`
  it('`G.x` / `G.y` read where it is DRAWN, on the curve — not on the straight line between its two poses', () => {
    const v = playHeadless(compileFlatpack(src('')), [{ type: 'wait', frames: 30 }]).vars
    expect(v.gx as number).toBeCloseTo(100, 0)
    expect(v.gy as number).toBeCloseTo(75, 0) // the curve's lowest point; the straight line would read 0
  })
  it('`orient` shows in its rotation: along the tangent, downhill then uphill', () => {
    const at = (frames: number) => playHeadless(compileFlatpack(src(' orient')), [{ type: 'wait', frames }]).vars.gr as number
    expect(at(10)).toBeGreaterThan(0.3)
    expect(at(50)).toBeLessThan(-0.3)
  })
  it('`self` in its own handler agrees', () => {
    const v = playHeadless(compileFlatpack(src('')), [{ type: 'wait', frames: 30 }, { type: 'tap', target: 'G', settle: 0 }], { settle: 0 }).vars
    expect(v.sy as number).toBeCloseTo(75, 0)
  })
})

// Review pass on the fixes above.
describe('review pass', () => {
  it('`feedback` used as a NAME is left alone: `feedback = lift` assigns, `{ feedback = lift }` is a record field', () => {
    const src = 'size 300 300\nvar feedback = 0\nvar lift = 2\nscene { layer "c" { group "X" at 20,20 { layer "a" { rect 0 0 10 10 fill #333333 } } } }\nobject "X" {\n  when clicked {\n    feedback = lift\n    send "evt", { feedback = lift }\n  }\n}\n'
    expect(checkProgram(src).errors).toBe(0)
    const r = playHeadless(compileFlatpack(src), [{ type: 'tap', target: 'X' }])
    expect(r.vars.feedback).toBe(2)
    expect(r.sends).toEqual([{ name: 'evt', fields: { feedback: 2 } }])
  })
  it('a state whose name is not a plain word (a document no compiler wrote) does not break the check', async () => {
    const { lintDoc } = await import('./programDoc')
    const doc = compileFlatpack('size 200 200\nvar score = 9\nsymbol "Door" {\n  timeline 24 24\n  states door { closed at 0   open at 24   initial closed }\n  layer "c" { group "P" at 0,0 { layer "x" { rect 0 0 20 40 fill #885500 } } }\n}\nscene { layer "l" { instance "Door" as "FrontDoor" at 50,50 } }\nobject "FrontDoor" { when clicked { FrontDoor.door = score > 5 ? open : closed } }\n')
    const sm = (doc.symbols[0] as unknown as { states: { states: { name: string }[] }[] }).states[0]!
    sm.states[0]!.name = 'a(+'
    expect(() => lintDoc(doc)).not.toThrow()
  })
  it('many paths that start alike: naming one stays cheap', () => {
    const paths = Array.from({ length: 1500 }, (_, i) => `    path "M0 0 L40 0 L40 40 L0 40 Z M20 20 L60 20 L60 60 L20 ${60 + i} Z" fill #333333`).join('\n')
    const t0 = performance.now()
    const r = checkProgram(`size 300 300\nscene {\n  layer "c" {\n${paths}\n  }\n}\n`)
    expect(r.warnings).toBeGreaterThan(1000)
    expect(performance.now() - t0).toBeLessThan(4000)
  })
})
