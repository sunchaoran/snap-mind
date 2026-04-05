import { config } from "../config.js";
import type { MergedVLMResult, VLMResult } from "../types/index.js";
import { mergeVLMResults } from "./merger.js";
import { openrouter } from "./openrouter.js";
import { VLM_SYSTEM_PROMPT } from "./prompt.js";

export async function analyzeScreenshot(
  imageBuffer: Buffer,
): Promise<MergedVLMResult> {
  const models = config.openrouter.models.vlm;

  if (models.length % 2 === 0) {
    throw new Error(
      `VLM model count must be odd for voting, got ${models.length}`,
    );
  }

  const base64Image = imageBuffer.toString("base64");
  const dataUrl = `data:image/png;base64,${base64Image}`;

  // Call all models concurrently
  const settled = await Promise.allSettled(
    models.map((model) => callVLM(model, dataUrl)),
  );

  const results: Record<string, VLMResult> = {};
  for (let i = 0; i < models.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      results[models[i]] = result.value;
    }
  }

  if (Object.keys(results).length === 0) {
    throw new Error("All VLM models failed");
  }

  return mergeVLMResults(results);
}

async function callVLM(model: string, dataUrl: string): Promise<VLMResult> {
  const response = await openrouter.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: VLM_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: "请分析这张截图。" },
          ],
        },
      ],
      temperature: 0,
    },
    {
      timeout: config.processing.vlmTimeout,
    },
  );

  const text = response.choices[0]?.message?.content ?? "";
  return JSON.parse(text) as VLMResult;
}
