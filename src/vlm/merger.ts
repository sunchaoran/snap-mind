import type {
  ContentType,
  MergedVLMResult,
  Platform,
  VLMResult,
} from "../types/index.js";
import { textSimilarity } from "../utils/similarity.js";

/**
 * Merge N VLM results using majority voting.
 * Single model: direct return. Multiple models: vote on each field.
 */
export function mergeVLMResults(
  results: Record<string, VLMResult>,
): MergedVLMResult {
  const entries = Object.values(results);

  if (entries.length === 1) {
    const r = entries[0];
    return {
      platform: r.platform ?? "unknown",
      author: r.author,
      title: r.title,
      keywords: r.keywords,
      publishTime: r.publishTime,
      visibleUrl: r.visibleUrl,
      contentSnippet: r.contentSnippet,
      contentType: r.contentType ?? "post",
      confidence: r.confidence,
      rawResults: results,
    };
  }

  const best = entries.reduce((a, b) => (a.confidence >= b.confidence ? a : b));

  const platform = votePlatform(entries);
  const author = textConsensus(
    entries.map((r) => r.author),
    0.8,
  );
  const title = textConsensus(
    entries.map((r) => r.title),
    0.7,
  );
  const keywords = uniqueKeywords(entries.flatMap((r) => r.keywords));
  const contentType = voteContentType(entries) ?? best.contentType ?? "post";

  const publishTime =
    pickNonNull(entries.map((r) => r.publishTime)) ?? best.publishTime;
  const visibleUrl =
    pickNonNull(entries.map((r) => r.visibleUrl)) ?? best.visibleUrl;
  const contentSnippet = pickLongest(entries.map((r) => r.contentSnippet));

  const confidence = calculateOverallConfidence(entries, platform);

  return {
    platform,
    author,
    title,
    keywords,
    publishTime,
    visibleUrl,
    contentSnippet,
    contentType,
    confidence,
    rawResults: results,
  };
}

/** Majority vote on platform. Fallback to highest-confidence model. */
function votePlatform(results: VLMResult[]): Platform {
  const votes = results.map((r) => r.platform).filter(Boolean) as Platform[];
  const winner = majorityVote(votes);
  if (winner) return winner;

  const best = results.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
  return best.platform ?? "unknown";
}

function voteContentType(results: VLMResult[]): ContentType | null {
  const votes = results
    .map((r) => r.contentType)
    .filter(Boolean) as ContentType[];
  return majorityVote(votes);
}

/**
 * Find text consensus among candidates using similarity threshold.
 * Groups similar strings, returns the representative of the largest group.
 */
function textConsensus(
  candidates: (string | null)[],
  threshold: number,
): string | null {
  const valid = candidates.filter(Boolean) as string[];
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const groups: string[][] = [];
  for (const text of valid) {
    let placed = false;
    for (const group of groups) {
      if (textSimilarity(group[0], text) >= threshold) {
        group.push(text);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([text]);
  }

  const largest = groups.reduce((a, b) => (a.length >= b.length ? a : b));
  // Pick the longest string in the winning group as representative
  return largest.reduce((a, b) => (a.length >= b.length ? a : b));
}

function uniqueKeywords(keywords: string[]): string[] {
  const normalized = new Map<string, string>();
  for (const kw of keywords) {
    const key = kw.toLowerCase().trim();
    if (key && !normalized.has(key)) {
      normalized.set(key, kw);
    }
  }
  return [...normalized.values()];
}

function majorityVote<T extends string>(votes: T[]): T | null {
  if (votes.length === 0) return null;

  const counts = new Map<T, number>();
  for (const v of votes) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  const threshold = Math.floor(votes.length / 2) + 1;
  for (const [value, count] of counts) {
    if (count >= threshold) return value;
  }

  // No majority — return the most common
  let best: T = votes[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function pickNonNull<T>(values: (T | null)[]): T | null {
  return values.find((v) => v != null) ?? null;
}

function pickLongest(values: (string | null)[]): string | null {
  const valid = values.filter(Boolean) as string[];
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a.length >= b.length ? a : b));
}

/**
 * Calculate overall confidence based on platform agreement and field coverage.
 * - Platform agreement: all agree = 1.0, majority = 0.8, no majority = 0.5
 * - Field coverage: proportion of non-null key fields across models
 */
function calculateOverallConfidence(
  results: VLMResult[],
  mergedPlatform: Platform,
): number {
  const platformVotes = results.map((r) => r.platform).filter(Boolean);
  const agreeing = platformVotes.filter((p) => p === mergedPlatform).length;
  const agreementScore =
    agreeing === results.length
      ? 1.0
      : agreeing > results.length / 2
        ? 0.8
        : 0.5;

  const keyFields: (keyof VLMResult)[] = [
    "author",
    "title",
    "visibleUrl",
    "contentSnippet",
  ];
  let coveredFields = 0;
  for (const field of keyFields) {
    if (results.some((r) => r[field] != null)) coveredFields++;
  }
  const coverageScore = coveredFields / keyFields.length;

  const avgModelConfidence =
    results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

  return (
    Math.round(
      (agreementScore * 0.4 + coverageScore * 0.2 + avgModelConfidence * 0.4) *
        100,
    ) / 100
  );
}
