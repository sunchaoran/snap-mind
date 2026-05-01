import levenshtein from "js-levenshtein";

/**
 * Calculate text similarity (0-1) using normalized Levenshtein distance.
 *
 * Suited for comparing strings of similar length (e.g. handle vs handle).
 * For "is short string A contained in long string B" use {@link bigramOverlap}
 * — Levenshtein normalizes by the longer length and tanks to ~0 when one
 * input is much longer than the other, even if the short one is a perfect
 * substring of the long one.
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

/**
 * Bigram-overlap coefficient (0-1): proportion of `a`'s character bigrams
 * that also appear in `b`, normalized by the smaller bigram set.
 *
 * Robust to length asymmetry — the score reflects "how much of the shorter
 * string is present in the longer string". Use when comparing a short
 * reference (e.g. a VLM-extracted post title) against a longer candidate
 * (e.g. an opencli search hit's full text body).
 *
 * Both inputs are lowercased; non-ASCII (e.g. CJK) characters are bigrammed
 * directly without word segmentation, which is good enough for the matching
 * use case.
 */
export function bigramOverlap(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  const aBigrams = bigrams(a.toLowerCase());
  const bBigrams = bigrams(b.toLowerCase());
  if (aBigrams.size === 0 || bBigrams.size === 0) {
    // Single-char inputs have no bigrams; fall back to substring containment.
    return b.toLowerCase().includes(a.toLowerCase()) ? 1 : 0;
  }
  let intersection = 0;
  for (const bg of aBigrams) {
    if (bBigrams.has(bg)) {
      intersection++;
    }
  }
  return intersection / Math.min(aBigrams.size, bBigrams.size);
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2));
  }
  return set;
}
