import { defineConfig, type Plugin } from 'vitest/config';
import { spacetimedbModuleTestPlugin } from 'spacetimedb/server/test-utils/vitest';

// Runs reducers against an in-memory datastore: no server, no publish.
export default defineConfig({
  plugins: [spacetimedbModuleTestPlugin() as unknown as Plugin],
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
