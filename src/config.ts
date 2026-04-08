import { existsSync } from "node:fs";
import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env file.`,
    );
  }
  return value;
}

function requireEnvOrWarn(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value) {
    console.warn(
      `⚠ Environment variable ${name} not set, using fallback: "${fallback}"`,
    );
    return fallback;
  }
  return value;
}

// Validate vault path exists at startup
function validateVaultPath(path: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `OBSIDIAN_VAULT_PATH does not exist: ${path}. Create the directory or update your .env file.`,
    );
  }
  return path;
}

export const config = {
  server: {
    port: Number(process.env.PORT) || 3210,
    host: process.env.HOST || "0.0.0.0",
  },

  auth: {
    apiKey: requireEnvOrWarn("API_KEY", "dev-key"),
    jwtSecret: process.env.JWT_SECRET || "dev-jwt-secret",
  },

  llm: {
    apiKey: requireEnv("LLM_API_KEY"),
    baseUrl: process.env.LLM_BASE_URL || "https://api.minimaxi.com/v1",
    models: {
      vlm: (process.env.VLM_MODELS || "MiniMax-M2.7").split(","),
      processor: process.env.PROCESSOR_MODEL || "MiniMax-M2.7",
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
    basePath: validateVaultPath(requireEnv("OBSIDIAN_VAULT_PATH")),
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
