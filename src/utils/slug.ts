import slugify from "slugify";

/**
 * Convert a title to a URL-friendly slug.
 * CJK characters are preserved, max 50 chars.
 */
export function generateSlug(title: string): string {
  return slugify(title, {
    lower: true,
    strict: true,
  }).slice(0, 50);
}
