import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node20",
  bundle: true,
  clean: true,
  sourcemap: false,
  external: ["vscode"],
  noExternal: [/^@context-ray\//],
  outExtension: () => ({ js: ".cjs" }),
});
