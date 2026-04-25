import { homedir } from "node:os";
import { join } from "node:path";

// iCloud Drive
const defaultObsidianVaultPath = join(
  homedir(),
  "Library",
  "Mobile Documents",
  "com~apple~CloudDocs",
  "Obsidian",
);

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
    basePath: process.env.OBSIDIAN_VAULT_PATH || defaultObsidianVaultPath,
    clippingsDir: "snap-mind",
    assetsDir: "snap-mind/assets",
    screenshotDisplayWidth:
      Number(process.env.OBSIDIAN_SCREENSHOT_WIDTH) || 360,
  },

  processing: {
    overallTimeout: 300_000,
    fetchTimeouts: {
      l1: 100_000,
      l2: 50_000,
      l3: 50_000,
    },
    vlmTimeout: 80_000,
    /** Re-run VLM with all configured models only when the primary result is low-confidence or missing critical fields. */
    vlmEscalationThreshold: Number(process.env.VLM_ESCALATION_THRESHOLD) || 0.8,
    similarityThreshold: 0.85,
    /** Max fetch level to attempt (1-4). Levels beyond this will not run; if the max level fails, pipeline errors instead of falling through. */
    maxFetchLevel: Number(process.env.MAX_FETCH_LEVEL) || 4,
    /** Max images per batch upload (1-20). */
    maxBatchSize: Math.min(Number(process.env.MAX_BATCH_SIZE) || 20, 20),
    /** Max pipelines running concurrently within a batch. Controls resource usage. */
    maxConcurrentPipelines: Number(process.env.MAX_CONCURRENT_PIPELINES) || 5,
  },

  searchEngine: {
    provider: (process.env.SEARCH_PROVIDER || "google") as "google" | "bing",
    apiKey: process.env.SEARCH_API_KEY,
    cx: process.env.GOOGLE_CX,
  },
} as const;
