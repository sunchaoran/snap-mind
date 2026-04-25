import { chmodSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "cli/snap-mind-cli/main.ts",
  },
  format: [
    "esm",
  ],
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: {
    entry: "src/index.ts",
  },
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
  banner: ({ format: _format }) => ({
    js: "#!/usr/bin/env node",
  }),
  onSuccess() {
    cpSync("src/prompts", "dist/prompts", {
      recursive: true,
    });
    const cliPath = join("dist", "cli.js");
    if (existsSync(cliPath)) {
      chmodSync(cliPath, 0o755);
    }
  },
});
