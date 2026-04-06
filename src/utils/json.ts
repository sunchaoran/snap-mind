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
  const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch?.[1]) {
    return JSON.parse(jsonMatch[1]) as T;
  }

  throw new SyntaxError(
    `Failed to extract JSON from LLM response: ${trimmed.slice(0, 200)}`,
  );
}
