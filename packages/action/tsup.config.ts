import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node20",
  bundle: true,
  clean: true,
  sourcemap: false,
  noExternal: [/.*/],
  outExtension: () => ({ js: ".cjs" }),
});
