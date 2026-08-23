/**
 * Remove server-only fields from arbitrary job JSON before it crosses a public
 * API boundary. `unscoredUrl` is the private remux base used by Recast audio
 * replacement; it must never reach browsers, SDK consumers, MCP clients, or
 * even the admin UI.
 *
 * Supabase JSONB values are acyclic plain JSON, but this helper deliberately
 * handles shared/cyclic objects as well so a malformed mock or future adapter
 * cannot turn redaction into an infinite recursion. The input is never mutated.
 */
export function redactPrivateJobData<T>(value: T): T {
  return redact(value, new WeakMap<object, unknown>()) as T
}

function redact(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value

  const existing = seen.get(value)
  if (existing !== undefined) return existing

  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const item of value) copy.push(redact(item, seen))
    return copy
  }

  const copy: Record<string, unknown> = {}
  seen.set(value, copy)
  for (const [key, item] of Object.entries(value)) {
    if (key === "unscoredUrl") continue
    Object.defineProperty(copy, key, {
      value: redact(item, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return copy
}
