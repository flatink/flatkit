import { describe, it, expect } from 'vitest'
import { splitScopeProgram, joinScopeProgram, formatObjectBlock } from './scopeProgram'

describe('scopeProgram — unified scope file (text)', () => {
  const text = `var score = 0

every frame {
  bx = bx + vx
}

object "Paddle" {
  x = mouse.x
}

object "Bricks" {
  when clicked { score = score + 10 }
}
`

  it('splits the object blocks from the rest (var + lifecycle)', () => {
    const { rest, objects } = splitScopeProgram(text)
    expect(rest).toContain('var score = 0')
    expect(rest).toContain('every frame')
    expect(rest).not.toContain('object "')
    expect(objects.map((o) => o.name)).toEqual(['Paddle', 'Bricks'])
    expect(objects[0].body).toContain('x = mouse.x')
    expect(objects[1].body).toContain('when clicked')
  })

  it('split → join is stable (same blocks, same rest)', () => {
    const { rest, objects } = splitScopeProgram(text)
    const round = splitScopeProgram(joinScopeProgram(rest, objects))
    expect(round.rest.trim()).toBe(rest.trim())
    expect(round.objects).toEqual(objects)
  })

  it('handles nested braces and empty blocks', () => {
    const t = `object "A" {\n  when clicked {\n    if score { play }\n  }\n}\nobject "B" {}\n`
    const { objects } = splitScopeProgram(t)
    expect(objects.map((o) => o.name)).toEqual(['A', 'B'])
    expect(objects[0].body).toContain('if score { play }') // inner brace respected
    expect(formatObjectBlock('B', objects[1].body)).toBe('object "B" {\n}')
  })
})
