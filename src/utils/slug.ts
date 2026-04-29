import type { Platform } from "@/types/domain.js";

/**
 * Sanitize a title for use as an Obsidian-friendly filename.
 *
 * Preserves CJK characters, spaces, and readability.
 * Only strips characters that are unsafe for filesystems or Obsidian links.
 */
export function generateSlug(title: string, maxLength = 80): string {
  return Array.from(
    title
      // Remove filesystem-unsafe and Obsidian-unsafe chars: / \ : * ? " < > | # ^ [] |
      .replace(/[/\\:*?"<>|#^[\]]/g, "")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, maxLength)
    .join("");
}

const PLATFORM_FILENAME_SEGMENTS: Record<Platform, string> = {
  xiaohongshu: "XHS",
  twitter: "TWI",
  reddit: "RED",
  weibo: "WBO",
  zhihu: "ZHI",
  weixin: "WEX",
  bilibili: "BIL",
  douban: "DOU",
  hackernews: "HN",
  youtube: "YTB",
  medium: "MED",
  substack: "SUB",
  unknown: "UNK",
};

export function shortPlatformName(platform: Platform): string {
  return PLATFORM_FILENAME_SEGMENTS[platform];
}

export function shortDateStamp(isoTimestamp: string): string {
  return isoTimestamp.slice(2, 10).replace(/-/g, "");
}
