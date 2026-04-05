/**
 * Convert a title to a URL-friendly slug.
 * Non-alphanumeric chars (including CJK) replaced with hyphens, max 50 chars.
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
