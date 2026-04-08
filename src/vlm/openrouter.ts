import OpenAI from "openai";
import { config } from "@/config.js";

export const llmClient = new OpenAI({
  apiKey: config.llm.apiKey,
  baseURL: config.llm.baseUrl,
});
