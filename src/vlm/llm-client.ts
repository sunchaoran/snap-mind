import OpenAI from "openai";
import { config } from "@/config.js";

const target = config.llm.target;
const provider = config.llm.providers[target];

if (!provider) {
  throw new Error(
    `Unknown LLM_PROVIDER_TARGET=${target}. Expected one of: ${Object.keys(config.llm.providers).join(", ")}`,
  );
}

if (!provider.apiKey) {
  throw new Error(
    `Active LLM provider "${target}" is missing apiKey. Set the corresponding env var.`,
  );
}

if (!provider.models.vlm) {
  throw new Error(
    `Active LLM provider "${target}" is missing VLM model. Set the corresponding env var.`,
  );
}

if (!provider.models.processor) {
  throw new Error(
    `Active LLM provider "${target}" is missing processor model. Set the corresponding env var.`,
  );
}

export const llmClient = new OpenAI({
  apiKey: provider.apiKey,
  baseURL: provider.baseUrl,
});

export const activeModels = provider.models;
