// FlatInk MCP server (stdio transport): exposes the asset library + the forge's compile/preview/publish
// as TOOLS for LLM agents. Configured via env: FORGE_URL (default localhost:7712), FORGE_API_KEY.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createForgeClient } from './forgeClient.ts'

const client = createForgeClient(process.env.FORGE_URL ?? 'http://localhost:7712', process.env.FORGE_API_KEY ?? '')

const text = (o: unknown) => ({ content: [{ type: 'text' as const, text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] })
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true })

export function buildServer(c: typeof client = client): McpServer {
  const server = new McpServer({ name: 'flatink', version: '0.1.0' })

  server.registerTool('search_assets', {
    description:
      'Search the FlatInk library for turnkey assets (clipart) by natural-language query. ' +
      'Returns, per asset: `name`, dimensions, tags, and a ready-to-paste RECIPE -- `use.dsl` (the `image "<name>" <w> <h> at <x>,<y>` line) ' +
      'and `use.publish.library` (the name to pass in `library:[...]` when previewing/publishing).',
    inputSchema: {
      query: z.string().describe('natural-language query, e.g. "musical instrument", "renewable energy"'),
      category: z.string().optional().describe('category filter (animals, objects, nature, buildings, ...)'),
      view: z.string().optional().describe('orientation filter (front, side, three-quarter, top, back, flat)'),
      style: z.string().optional().describe('graphic-style / collection filter, e.g. "engraving" (antique monochrome) or "paper-theater" (flat color clipart)'),
      limit: z.number().int().min(1).max(50).optional(),
    },
  }, async ({ query, category, view, style, limit }) => text(await c.searchAssets(query, { category, view, style, limit })))

  server.registerTool('get_asset', {
    description: 'Look up a library asset by its exact `name` (dimensions, tags, description, recipe).',
    inputSchema: { name: z.string() },
  }, async ({ name }) => text(await c.getAsset(name)))

  server.registerTool('check_scene', {
    description: 'Validate a `.flatink` DSL source (compile without rendering) -> { ok, errors, warnings }.',
    inputSchema: {
      source: z.string().describe('.flatink DSL source'),
      library: z.array(z.string()).optional().describe('names of library assets referenced by `image "<name>"` in the source'),
    },
  }, async ({ source, library }) => text(await c.check(source, library)))

  server.registerTool('preview_scene', {
    description: 'Compile + RENDER a DSL source to PNG and return the image (to iterate visually). `library` assets are inlined server-side.',
    inputSchema: {
      source: z.string(),
      library: z.array(z.string()).optional(),
      frame: z.number().int().optional().describe('timeline frame to render (default 0)'),
      scale: z.number().optional(),
    },
  }, async ({ source, library, frame, scale }) => {
    const r = (await c.preview(source, library, { frame, scale })) as { ok?: boolean; png?: string; width?: number; height?: number; errors?: unknown; error?: unknown }
    if (!r.ok || !r.png) return fail('preview failed: ' + JSON.stringify(r.errors ?? r.error ?? r))
    return {
      content: [
        { type: 'image' as const, data: r.png.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' },
        { type: 'text' as const, text: `rendered ${r.width}x${r.height}` },
      ],
    }
  })

  server.registerTool('preview_symbol', {
    description:
      'Render N frames of ONE symbol from a `.flat` library and return the images -- to ITERATE on a symbol ' +
      'asset WITHOUT storing anything. `engine:"player"` animates reactive modifiers (spring/velocity) and ' +
      'sub-loops; `"flatc"` (default) freezes those modifiers but honors `scale`. Set states / params / ' +
      'colors via `set` (e.g. { "state": "spin", "body": "#E94F4F" }).',
    inputSchema: {
      lib: z.string().describe('contents of the .flat file (symbol library)'),
      symbol: z.string().optional().describe('symbol name (default: the first in the lib)'),
      frames: z.array(z.number().int().min(0)).min(1).describe('frame numbers to render (<= 24)'),
      set: z.record(z.union([z.string(), z.number()])).optional().describe('states / params / recolor to apply'),
      engine: z.enum(['flatc', 'player']).optional().describe('"player" to animate spring/velocity; "flatc" by default'),
      scale: z.number().optional().describe('resolution factor (engine "flatc" only)'),
    },
  }, async ({ lib, symbol, frames, set, engine, scale }) => {
    const r = (await c.previewSymbolFrames(lib, { symbol, frames, set, engine, scale })) as
      { ok?: boolean; engine?: string; width?: number; height?: number; frames?: string[]; errors?: unknown; error?: unknown }
    if (!r.ok || !r.frames?.length) return fail('preview-symbol failed: ' + JSON.stringify(r.errors ?? r.error ?? r))
    return {
      content: [
        ...r.frames.map((f) => ({ type: 'image' as const, data: f.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' as const })),
        { type: 'text' as const, text: `${r.frames.length} frame(s) - ${r.width}x${r.height} - engine ${r.engine}` },
      ],
    }
  })

  server.registerTool('publish_scene', {
    description: 'Publish a scene (compile + store) and return its public URL (/p/:id). `library` assets are inlined.',
    inputSchema: {
      source: z.string(),
      library: z.array(z.string()).optional(),
      title: z.string().optional(),
    },
  }, async ({ source, library, title }) => {
    const r = (await c.publish(source, { library, title })) as { ok?: boolean; url?: string; errors?: unknown; error?: unknown }
    if (!r.ok || !r.url) return fail('publish failed: ' + JSON.stringify(r.errors ?? r.error ?? r))
    return text(r)
  })

  return server
}

// stdio startup (except in tests, where we import buildServer directly).
if (process.env.NODE_ENV !== 'test') {
  const server = buildServer()
  await server.connect(new StdioServerTransport())
}
