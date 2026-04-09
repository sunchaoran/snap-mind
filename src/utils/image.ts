import sharp from "sharp";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("image");

/** Max pixel dimension (longest side). Screenshots beyond this are downscaled. */
const MAX_DIMENSION = 2560;

/** WebP quality for lossy compression (0-100). */
const WEBP_QUALITY = 80;

export interface PreprocessedImage {
  /** Compressed image buffer (WebP format) */
  buffer: Buffer;
  /** Always "webp" after preprocessing */
  ext: "webp";
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize: number;
}

/**
 * Preprocess an uploaded screenshot:
 * 1. Downscale if either dimension exceeds MAX_DIMENSION (preserve aspect ratio)
 * 2. Convert to WebP with lossy compression
 *
 * Returns a smaller buffer suitable for both VLM analysis and vault storage.
 */
export async function preprocessImage(
  imageBuffer: Buffer,
): Promise<PreprocessedImage> {
  const originalSize = imageBuffer.length;

  const compressed = await sharp(imageBuffer)
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({
      quality: WEBP_QUALITY,
    })
    .toBuffer();

  const ratio = ((1 - compressed.length / originalSize) * 100).toFixed(1);
  log.info(
    {
      originalSize: `${(originalSize / 1024).toFixed(0)}KB`,
      compressedSize: `${(compressed.length / 1024).toFixed(0)}KB`,
      saved: `${ratio}%`,
    },
    "image preprocessed",
  );

  return {
    buffer: compressed,
    ext: "webp",
    originalSize,
    compressedSize: compressed.length,
  };
}
