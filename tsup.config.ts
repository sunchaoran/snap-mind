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
    // Copy prompt assets next to the bundled entry, NOT into a `prompts/`
    // subdir. The bundled `loadPrompt()` reads via
    // `resolve(import.meta.dirname, filename)`, where `import.meta.dirname`
    // is `dist/` post-bundle — so files must sit at `dist/<name>.md` and
    // `dist/platforms/<name>.md`, not under `dist/prompts/`.
    cpSync("src/prompts", "dist", {
      recursive: true,
      // Skip src/prompts/index.ts — it's already inlined into dist/index.js
      // by tsup; copying would just dump a stray .ts into dist/.
      filter: (src) => !src.endsWith(".ts"),
    });
    const cliPath = join("dist", "cli.js");
    if (existsSync(cliPath)) {
      chmodSync(cliPath, 0o755);
    }
  },
});
