import "dotenv/config";

export const config = {
  server: {
    port: Number(process.env.PORT) || 3210,
    host: process.env.HOST || "0.0.0.0",
  },

  auth: {
    apiKey: process.env.API_KEY!,
    jwtSecret: process.env.JWT_SECRET!,
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseUrl: "https://openrouter.ai/api/v1",
    models: {
      vlm: (process.env.VLM_MODELS || "moonshotai/kimi-k2.5").split(","),
      processor: process.env.PROCESSOR_MODEL || "moonshotai/kimi-k2.5",
    },
  },

  opencli: {
    binaryPath: process.env.OPENCLI_PATH || "opencli",
    timeout: 120_000,
  },

  playwright: {
    cdpUrl: process.env.CDP_URL || "http://localhost:9222",
  },

  vault: {
    basePath: process.env.OBSIDIAN_VAULT_PATH!,
    clippingsDir: "Clippings",
    assetsDir: "Clippings/assets",
  },

  processing: {
    overallTimeout: 180_000,
    fetchTimeouts: {
      l1: 80_000,
      l2: 35_000,
      l3: 20_000,
    },
    vlmTimeout: 35_000,
    similarityThreshold: 0.85,
    /** Max fetch level to attempt (1-4). Levels beyond this will not run; if the max level fails, pipeline errors instead of falling through. */
    maxFetchLevel: Number(process.env.MAX_FETCH_LEVEL) || 4,
  },

  searchEngine: {
    provider: (process.env.SEARCH_PROVIDER || "google") as "google" | "bing",
    apiKey: process.env.SEARCH_API_KEY,
    cx: process.env.GOOGLE_CX,
  },
} as const;
