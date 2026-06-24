# @flatkit/mcp

FlatInk MCP server. Exposes the FlatInk **asset library** + the forge's **compile / preview / publish** as
**MCP tools** for LLM agents (Claude Desktop/Code, agents). The server is a thin **stdio adapter** over the
forge's public `/v1/*` API -- the forge stays the source of truth.

## Tools

| Tool | Does | Forge |
|---|---|---|
| `search_assets` | search turnkey assets (natural language) -> ready-to-paste recipes | `GET /v1/library/search` |
| `get_asset` | detail an asset by `name` | `GET /v1/library/:id` |
| `check_scene` | validate a DSL source (without rendering) | `POST /v1/check` |
| `preview_scene` | compile + render a source -> PNG image (visual iteration) | `POST /v1/preview` |
| `preview_symbol` | render N frames of one `.flat` symbol -> images (ephemeral); `engine:"player"` animates spring/velocity | `POST /v1/preview-symbol-frames` |
| `publish_scene` | publish -> public URL `/p/:id` | `POST /v1/publish` |

Library assets referenced in the source (`image "<name>" <w> <h> at x,y`) are passed via the `library:[...]`
parameter of `preview_scene`/`publish_scene` and inlined server-side (base64). An unknown name returns an
error with the closest matching names (auto-correction).

## Install (recommended: `npx`)

In your MCP client config (e.g. `claude_desktop_config.json` / `.mcp.json`):

```jsonc
{
  "mcpServers": {
    "flatink": {
      "command": "npx",
      "args": ["-y", "@flatkit/mcp"],
      "env": {
        "FORGE_URL": "https://forge.flatink.zwyk-studio.com",
        "FORGE_API_KEY": "fk_..."
      }
    }
  }
}
```

## Config

Environment variables:
- `FORGE_URL` -- forge base URL (default `http://localhost:7712`).
- `FORGE_API_KEY` -- your user API key (created on the "My account" page of the auth service); sent as `X-API-Key`.

## Build from source

```sh
pnpm -C packages/mcp build   # -> packages/mcp/dist/server.js
```

Then point the MCP client at the built file instead of `npx`:

```jsonc
{
  "mcpServers": {
    "flatink": {
      "command": "node",
      "args": ["/absolute/path/flatkit/packages/mcp/dist/server.js"],
      "env": { "FORGE_URL": "https://forge.flatink.zwyk-studio.com", "FORGE_API_KEY": "fk_..." }
    }
  }
}
```

Dev (run from source, no build): `pnpm -C packages/mcp dev` (loads TS via `tsx`).
