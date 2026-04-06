import OpenAI from "openai";
import { config } from "@/config.js";

export const openrouter = new OpenAI({
  apiKey: config.openrouter.apiKey,
  baseURL: config.openrouter.baseUrl,
});
