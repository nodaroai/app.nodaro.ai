import { NODE_REF_PATTERN, RESERVED_TEMPLATE_VARS } from "@nodaro/shared"

/** Tokens never treated as a real reference: empty, image-ref tokens, reserved vars. */
export function isExcludedToken(raw: string): boolean {
  if (raw === "") return true
  if (raw.startsWith("image:")) return true
  return RESERVED_TEMPLATE_VARS.has(raw)
}

/** Non-excluded `{Label}` tokens referenced across the given string fields (trimmed). */
export function referencedRefs(data: Record<string, unknown>, fields: readonly string[]): Set<string> {
  const refs = new Set<string>()
  for (const field of fields) {
    const value = data[field]
    if (typeof value !== "string" || value.length === 0) continue
    for (const match of value.matchAll(NODE_REF_PATTERN)) {
      const raw = (match[1] ?? "").trim()
      if (!isExcludedToken(raw)) refs.add(raw)
    }
  }
  return refs
}

/** True if any field contains a literal empty `{}` marker (NODE_REF_PATTERN needs 1+ char, so it never matches `{}`). */
export function hasEmptyInjection(data: Record<string, unknown>, fields: readonly string[]): boolean {
  for (const field of fields) {
    const value = data[field]
    if (typeof value === "string" && value.includes("{}")) return true
  }
  return false
}
