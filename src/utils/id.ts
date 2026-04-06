import dayjs from "dayjs";
import { nanoid } from "nanoid";

/**
 * Generate a unique clip ID.
 * Format: clip_{yyyyMMdd}_{HHmmss}_{nanoid}
 */
export function generateClipId(): string {
  const ts = dayjs().format("YYYYMMDD_HHmmss");
  return `clip_${ts}_${nanoid(6)}`;
}
