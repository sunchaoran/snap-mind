/**
 * Parse JSON from LLM responses, handling markdown code fences
 * like ```json ... ``` that models sometimes wrap their output in.
 */
export function parseLLMJson<T>(text: string): T {
  const trimmed = text.trim();

  // Try direct parse first
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Fall through to code fence extraction
  }

  // Extract from markdown code fence: ```json\n...\n``` or ```\n...\n```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch?.[1]) {
    return JSON.parse(fenceMatch[1].trim()) as T;
  }

  // Last resort: find first { ... } or [ ... ] block
  // Use greedy match from the first {/[ until the very last }/]
  const greedyMatch = trimmed.match(/([{[][\s\S]*?[}\]])(?:\s|$)/);
  if (greedyMatch?.[1]) {
    try {
      return JSON.parse(greedyMatch[1]) as T;
    } catch {
      // Ignore inner parse error, throw outer error
    }
  }

  // Very aggressive: strip anything after the LAST curly brace or bracket
  const lastBraceIndex = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  const firstBraceIndex = Math.min(
    trimmed.indexOf('{') === -1 ? Infinity : trimmed.indexOf('{'),
    trimmed.indexOf('[') === -1 ? Infinity : trimmed.indexOf('[')
  );

  if (lastBraceIndex > firstBraceIndex && firstBraceIndex !== Infinity) {
        try {
          return JSON.parse(trimmed.slice(firstBraceIndex, lastBraceIndex + 1)) as T;
        } catch {
            // Ignore inner parse error
        }
  }

  throw new SyntaxError(
    `Failed to extract JSON from LLM response: ${trimmed.slice(0, 200)}`,
  );
}
