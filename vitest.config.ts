import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // 让测试以"production-like"模式跑：auth 必须显式带 token，
    // 不会因为 dev-skip 静默放行；同时给 config 一个稳定的 API_KEY。
    env: {
      NODE_ENV: "production",
      API_KEY: "test-key",
    },
    include: [
      "src/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: [
        "text",
        "html",
      ],
      include: [
        "src/**",
      ],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts",
        "src/types/**",
      ],
    },
  },
});
