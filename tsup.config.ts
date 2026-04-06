import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
  ],
  format: [
    "esm",
  ],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: true,
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
  onSuccess() {
    cpSync("src/prompts", "dist/prompts", {
      recursive: true,
    });
  },
});
