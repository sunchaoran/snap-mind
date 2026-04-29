import type { ClipRecord } from "@/types/domain.js";

export interface ClipWriter {
  /** Write a clip record and return the vault-relative file path. */
  write(record: ClipRecord): Promise<string>;
  exists(id: string): Promise<boolean>;
  findSimilar(
    platform: string,
    author: string | null,
    title: string | null,
  ): Promise<string | null>;
}
