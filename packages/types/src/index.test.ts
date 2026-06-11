import { expect, test } from 'vitest'
import type { Doc, Region, Layer } from './index'

// Type-level smoke test: a minimal Doc must type-check and behave like plain data.
test('a minimal Doc type-checks and is plain data', () => {
  const region: Region = { id: 'r1', color: '#000000', path: { subpaths: [] } }
  const layer: Layer = { id: 'L', name: 'Layer 1', visible: true, locked: false, opacity: 1, items: [region] }
  const doc: Doc = { width: 100, height: 100, layers: [layer], symbols: [] }

  expect(doc.width).toBe(100)
  expect(doc.layers[0].items).toHaveLength(1)
  expect((doc.layers[0].items[0] as Region).color).toBe('#000000')
})
