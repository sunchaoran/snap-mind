/**
 * Sanitize a title for use as an Obsidian-friendly filename.
 *
 * Preserves CJK characters, spaces, and readability.
 * Only strips characters that are unsafe for filesystems or Obsidian links.
 */
export function generateSlug(title: string): string {
  return (
    title
      // Remove filesystem-unsafe and Obsidian-unsafe chars: / \ : * ? " < > | # ^ [] |
      .replace(/[/\\:*?"<>|#^[\]]/g, "")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80)
  );
}
