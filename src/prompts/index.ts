import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Platform } from "@/types/index.js";

function loadPrompt(filename: string): string {
  return readFileSync(resolve(import.meta.dirname, filename), "utf-8");
}

export const VLM_IDENTIFY_PROMPT = loadPrompt("vlm-identify.md");
export const PROCESSOR_SYSTEM_PROMPT = loadPrompt("processor.md");

const extractTemplate = loadPrompt("vlm-extract.md");

export function buildExtractPrompt(platform: Platform): string {
  const rulesPath = resolve(import.meta.dirname, "platforms", `${platform}.md`);
  const rules = existsSync(rulesPath)
    ? readFileSync(rulesPath, "utf-8")
    : loadPrompt("platforms/unknown.md");

  return extractTemplate
    .replaceAll("{{PLATFORM}}", platform)
    .replace("{{PLATFORM_RULES}}", rules);
}
