import type { ClipRecord } from "../types/index.js";

export interface ClipWriter {
  write(record: ClipRecord): Promise<void>;
  exists(id: string): Promise<boolean>;
  findSimilar(
    platform: string,
    author: string | null,
    title: string | null,
  ): Promise<string | null>;
}
