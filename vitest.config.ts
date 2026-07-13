import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@context-ray/schema": `${root}packages/schema/src/index.ts`,
      "@context-ray/core": `${root}packages/core/src/index.ts`,
      "@context-ray/reporters": `${root}packages/reporters/src/index.ts`,
    },
  },
  test: {
    include: [
      "apps/**/test/**/*.test.{js,ts}",
      "packages/**/test/**/*.test.ts",
      "extensions/**/test/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
  },
});
