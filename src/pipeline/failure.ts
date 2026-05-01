import { saveScreenshot } from "@/store/screenshot.js";
import type { ClipRecord } from "@/types/domain.js";
import type { ClipResponse } from "@/types/wire.js";
import { preprocessImage } from "@/utils/image.js";
import { writeClip } from "@/writer/markdown.js";

export async function handleFailure(
  clipId: string,
  imageBuffer: Buffer,
): Promise<ClipResponse> {
  let savedExt = "webp";
  try {
    const pp = await preprocessImage(imageBuffer);
    await saveScreenshot(clipId, pp.buffer, pp.ext);
    savedExt = pp.ext;
  } catch {
    try {
      await saveScreenshot(clipId, imageBuffer);
      savedExt = "png";
    } catch {
      // Screenshot save itself failed
    }
  }

  try {
    const failRecord: ClipRecord = {
      id: clipId,
      title: "处理失败 - 待重试",
      platform: "unknown",
      author: "unknown",
      originalUrl: null,
      contentType: "post",
      contentFull: null,
      contentSummary: "处理过程中发生错误，请稍后重试。",
      tags: [],
      category: "other",
      language: "zh",
      screenshotPath: `assets/${clipId}.${savedExt}`,
      fetchLevel: 4,
      sourceConfidence: 0,
      createdAt: new Date().toISOString(),
      rawVlmResult: {
        platform: "unknown",
        author: null,
        title: null,
        keywords: [],
        publishTime: null,
        visibleUrl: null,
        contentSnippet: null,
        contentType: "post",
        confidence: 0,
        rawResult: {
          platform: null,
          confidence: 0,
          author: null,
          title: null,
          keywords: [],
          publishTime: null,
          visibleUrl: null,
          contentSnippet: null,
          contentType: null,
        },
      },
    };
    await writeClip(failRecord);
  } catch {
    // Failure record write itself failed
  }

  return {
    success: false,
    clipId,
    error: "Pipeline processing failed",
    screenshotSaved: true,
    message: "处理失败，已保存原始截图，请稍后重试",
  };
}
