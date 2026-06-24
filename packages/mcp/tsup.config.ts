import { defineConfig } from 'tsup'

// The MCP server is a single executable entry. Runtime deps (@modelcontextprotocol/sdk, zod) stay
// external -- declared in package.json and installed by the consumer (npx). The shebang banner makes
// dist/server.js directly runnable (and referenceable from an MCP client config).
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  dts: false,
  sourcemap: false,
})
