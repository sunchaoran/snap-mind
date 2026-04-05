import { randomBytes } from "node:crypto";

/**
 * Generate a unique clip ID.
 * Format: clip_{yyyyMMdd}_{HHmmss}_{4-char hex hash}
 */
export function generateClipId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const hash = randomBytes(2).toString("hex");
  return `clip_${date}_${time}_${hash}`;
}
