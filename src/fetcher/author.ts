/**
 * Extract a search-usable handle from a VLM-extracted author string.
 *
 * VLM returns the author field in widely varying shapes depending on the
 * platform UI it saw — `"@dingyi"`, `"Ding @dingyi"`,
 * `"Berryxia.AI (@berryxia)"`, or just `"老番茄"` for platforms whose UI has
 * no separate handle. Search-side consumers (Twitter `from:` operator,
 * opencli keyword search, etc.) need the bare handle; passing the raw
 * `vlm.author` directly produced wrong queries (e.g. `from:Ding @dingyi`
 * matched the wrong user on Twitter).
 *
 * Rule: if the string contains `@<handle>`, return `<handle>`. Otherwise
 * return the trimmed string as-is — that covers platforms without
 * handles, where the visible name is the search key.
 *
 * Do NOT use this for display purposes; it discards the display name on
 * platforms where one exists.
 */
export function extractAuthorHandle(author: string | null): string | null {
  if (!author) {
    return null;
  }
  const trimmed = author.trim();
  if (!trimmed) {
    return null;
  }
  const handleMatch = trimmed.match(/@(\w+)/);
  return handleMatch ? handleMatch[1] : trimmed;
}
