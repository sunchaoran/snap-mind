import slugify from "slugify";

/**
 * Convert a title to a URL-friendly slug.
 * CJK characters are preserved, max 50 chars.
 * Uses strict=false to keep CJK, then manually strips problematic characters.
 */
export function generateSlug(title: string): string {
  const base = slugify(title, {
    lower: true,
    strict: false,
    trim: true,
  });

  // Remove characters that are problematic in filenames but keep CJK
  const cleaned = base
    .replace(/['"!@#$%^&*()+=[\]{}<>|\\/?;:,~`]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return (cleaned || "untitled").slice(0, 50);
}
