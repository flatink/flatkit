import { describe, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildServer } from './server.ts'
import type { ForgeClient } from './forgeClient.ts'

// FAKE forge client -> we test the MCP wiring (handshake, tools, routing), not the real forge.
const fake: ForgeClient = {
  base: 'http://forge.test',
  hasKey: true,
  searchAssets: async (q) => ({ ok: true, query: q, assets: [{ name: 'soap', use: { dsl: 'image "soap" 64 64 at 0,0' } }] }),
  getAsset: async (name) => ({ ok: true, asset: { name } }),
  check: async () => ({ ok: true }),
  preview: async () => ({ ok: true, png: 'data:image/png;base64,QQ==', width: 50, height: 50 }),
  publish: async () => ({ ok: true, url: 'http://forge.test/p/abc' }),
  previewSymbolFrames: async () => ({ ok: true, engine: 'player', width: 64, height: 64, frames: ['data:image/png;base64,QQ==', 'data:image/png;base64,QQ=='] }),
}

describe('MCP server (in-memory transport)', () => {
  it('handshake + 6 tools; search/preview route to the client', async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '0' })
    await Promise.all([buildServer(fake).connect(st), client.connect(ct)])

    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['check_scene', 'get_asset', 'preview_scene', 'preview_symbol', 'publish_scene', 'search_assets'])

    const s = await client.callTool({ name: 'search_assets', arguments: { query: 'soap' } })
    expect(JSON.stringify(s.content)).toContain('soap')

    // preview -> PNG image block (visual iteration)
    const p = await client.callTool({ name: 'preview_scene', arguments: { source: 'size 50 50', library: ['soap'] } })
    const blocks = p.content as Array<{ type: string; mimeType?: string }>
    expect(blocks.some((b) => b.type === 'image' && b.mimeType === 'image/png')).toBe(true)

    // preview_symbol -> one image block PER requested frame (iterating on a symbol asset)
    const ps = await client.callTool({ name: 'preview_symbol', arguments: { lib: 'symbol "X" {}', frames: [0, 4], engine: 'player' } })
    const psBlocks = ps.content as Array<{ type: string; mimeType?: string }>
    expect(psBlocks.filter((b) => b.type === 'image').length).toBe(2)

    await client.close()
  })
})
