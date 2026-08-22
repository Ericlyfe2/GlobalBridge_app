/**
 * Recover JSON from a model that was told to return only JSON.
 *
 * Every strict-JSON feature had its own copy of this in the previous
 * architecture — four identical implementations and one that had drifted. It
 * is one function now, which is the point of the port.
 *
 * The layered recovery is not defensive programming for its own sake: models
 * genuinely do wrap JSON in markdown fences, prefix it with "Here's the
 * analysis:", or emit a trailing comma. Each of those turns a good answer into
 * a fallback response for the user, so it is worth recovering from.
 */
export function extractJson(text: string): unknown | null {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to substring recovery */
  }

  // Widest brace-delimited span. A greedy match rather than a lazy one because
  // the payloads here are nested objects: a lazy match stops at the first inner
  // closing brace and yields a truncated fragment that parses to the wrong shape.
  const braces = cleaned.match(/\{[\s\S]*\}/);
  if (braces) {
    try {
      return JSON.parse(braces[0]);
    } catch {
      /* fall through */
    }
  }

  // Some features (translate) legitimately expect a top-level array.
  const brackets = cleaned.match(/\[[\s\S]*\]/);
  if (brackets) {
    try {
      return JSON.parse(brackets[0]);
    } catch {
      /* fall through */
    }
  }

  return null;
}

/** Narrow an unknown parse result to a plain object. */
export function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
