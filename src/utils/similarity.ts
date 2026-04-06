import levenshtein from "js-levenshtein";

/**
 * Calculate text similarity (0-1) using normalized Levenshtein distance.
 */
export function textSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (!a || !b) {
    return 0;
  }

  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}
