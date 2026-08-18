import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/global-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Measured by spawning the built CLI, which v8 coverage in this process
      // cannot see. Covered by test/cli.test.ts and test/pool.test.ts instead.
      exclude: ["src/cli.ts", "src/worker.ts", "src/types.ts"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
