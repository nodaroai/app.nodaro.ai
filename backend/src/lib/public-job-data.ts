import { withoutServerOnlyKeys } from "./job-output-visibility.js"

/**
 * Remove server-only fields from arbitrary job JSON before it crosses a public
 * API boundary. `unscoredUrl` is the private remux base used by Recast audio
 * replacement; it must never reach browsers, SDK consumers, MCP clients, or
 * even the admin UI.
 *
 * It also drops a job's server-only `output_data` keys — the top-level `__`
 * keys plugins keep resume checkpoints in (lib/job-output-visibility.ts) —
 * from every `output_data` it meets in the value, so a whole row, a list of
 * rows or an envelope around them is covered. A bare `output_data` (not
 * under that key) goes through `redactPrivateJobOutput` instead.
 *
 * Supabase JSONB values are acyclic plain JSON, but this helper deliberately
 * handles shared/cyclic objects as well so a malformed mock or future adapter
 * cannot turn redaction into an infinite recursion. The input is never mutated.
 */
export function redactPrivateJobData<T>(value: T): T {
  return redact(value, new WeakMap<object, unknown>()) as T
}

/**
 * The redaction for a job's `output_data` read on its own (not inside a row):
 * its server-only top-level `__` keys dropped, then `redactPrivateJobData`.
 */
export function redactPrivateJobOutput<T>(output: T): T {
  return redactPrivateJobData(withoutServerOnlyKeys(output))
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
      value: redact(key === "output_data" ? withoutServerOnlyKeys(item) : item, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return copy
}
