// english-check-ignore-file — intentionally contains accented fixtures (testing accent sanitization).
import { describe, it, expect } from 'vitest'
import { isIdentifier, toIdentifier } from './ident'

describe('ident — isIdentifier', () => {
  it('accepts identifiers, rejects the rest', () => {
    for (const ok of ['Hero', '_x', 'a1', 'Brick_0', 'self']) expect(isIdentifier(ok)).toBe(true)
    for (const ko of ['Brick 0', '1st', 'a.b', 'a-b', 'x(', 'arr[i]', '', 'é']) expect(isIdentifier(ko)).toBe(false)
  })
})

describe('ident — toIdentifier', () => {
  it('replaces forbidden characters with "_"', () => {
    expect(toIdentifier('Brick 0')).toBe('Brick_0')
    expect(toIdentifier('Pièce A')).toBe('Pi_ce_A') // accent stripped too (outside [A-Za-z0-9_])
    expect(toIdentifier('a.b')).toBe('a_b')
    expect(toIdentifier('main (copy)')).toBe('main_copy_')
  })
  it('never starts with a digit', () => {
    expect(toIdentifier('2nd')).toBe('_2nd')
  })
  it('preserves an already-valid identifier', () => {
    expect(toIdentifier('Hero')).toBe('Hero')
    expect(toIdentifier('_private')).toBe('_private')
  })
  it('falls back when nothing usable remains', () => {
    expect(toIdentifier('   ')).toBe('X')
    expect(toIdentifier('()[]')).toBe('X')
    expect(toIdentifier('', 'Hero')).toBe('Hero')
  })
  it('suffixes reserved words with "_" (built-ins + keywords)', () => {
    for (const r of ['self', 'mouse', 'keys', 'time', 'value', 'PI', 'sin', 'between', 'if', 'repeat', 'play']) {
      expect(toIdentifier(r)).toBe(`${r}_`)
    }
    expect(toIdentifier('Self')).toBe('Self') // case-sensitive → not reserved
  })
})
