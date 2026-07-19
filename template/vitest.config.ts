import { defineConfig } from "vitest/config";

// The complementary half of `src/vscripts/tsconfig.json`'s
// `"exclude": ["**/__tests__/**"]`. tstl never turns these files into Lua;
// vitest runs exactly (and only) these files on Node. Together they let pure
// decision logic be unit-tested on a machine with no Dota installed.
export default defineConfig({
  test: {
    include: ["src/vscripts/**/__tests__/**/*.test.ts"],
  },
});
