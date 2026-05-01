import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Cascade-load env files (Vite / Next.js convention).
// Later files override earlier ones. Uses Node 22+ built-in
// process.loadEnvFile (no dotenv dependency).
const NODE_ENV = process.env.NODE_ENV ?? "development";
for (const file of [
  ".env",
  ".env.local",
  `.env.${NODE_ENV}`,
  `.env.${NODE_ENV}.local`,
]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

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
    /**
     * @fastify/rate-limit settings. Single-user / Tailscale-only deployment,
     * so this is mainly there to stop runaway scripts, not DDoS mitigation.
     */
    rateLimit: {
      max: Number(process.env.RATE_LIMIT_MAX) || 200,
      timeWindow: process.env.RATE_LIMIT_WINDOW || "1 minute",
    },
  },

  auth: {
    apiKey: process.env.API_KEY!,
    jwtSecret: process.env.JWT_SECRET!,
  },

  llm: {
    /**
     * Active provider for both VLM and processor calls. Single global switch —
     * `local` covers any OpenAI-compatible local server (LM Studio, vLLM,
     * Ollama, llama.cpp, …); the only requirement is that it speaks the
     * `/v1/chat/completions` shape the `openai` SDK uses.
     */
    target: (process.env.LLM_PROVIDER_TARGET || "openrouter") as
      | "openrouter"
      | "local",
    providers: {
      openrouter: {
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
        models: {
          vlm: process.env.OPENROUTER_VLM_MODEL || "moonshotai/kimi-k2.5",
          processor:
            process.env.OPENROUTER_PROCESSOR_MODEL || "moonshotai/kimi-k2.5",
        },
      },
      local: {
        /**
         * Default matches LM Studio's port (most common for desktop GPUs).
         * vLLM users typically override to `:8000/v1`, Ollama to `:11434/v1`.
         */
        baseUrl: process.env.LOCAL_BASE_URL || "http://localhost:1234/v1",
        /** Most local servers don't validate the key; OpenAI SDK requires non-empty. */
        apiKey: process.env.LOCAL_API_KEY || "local",
        models: {
          vlm: process.env.LOCAL_VLM_MODEL || "",
          processor: process.env.LOCAL_PROCESSOR_MODEL || "",
        },
      },
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
