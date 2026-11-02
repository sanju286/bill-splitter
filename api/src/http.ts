import type { Context } from 'hono'

// Reads the request body as a JSON object.
// Returns { ok: false } for a missing body, malformed JSON, or JSON that is
// not an object. The caller turns that into the right error response.
export async function readJsonObject(
  c: Context,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  let value: unknown
  try {
    value = await c.req.json()
  } catch {
    return { ok: false }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false }
  }
  return { ok: true, body: value as Record<string, unknown> }
}

// A "text" field the API accepts: a non-empty, non-whitespace-only string.
// The original string is stored as-is; only validation trims.
export function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

// Money is always whole cents: a positive integer number (not a string).
// typeof guards against null/undefined; Number.isInteger guards against
// 10.5, Infinity and NaN.
export function isPositiveWholeCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
