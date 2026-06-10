import { NODE_REF_PATTERN, RESERVED_TEMPLATE_VARS, parseNodeRef } from "@nodaro/shared"

/** How a `{...}` token (parsed name) renders/behaves. Single source of truth for
 *  the editor decoration AND the missing-refs chip — predicate-level identity. */
export type PromptTokenKind = "wired" | "reserved" | "missing" | "skip" | "unknown"

/**
 * Classify a parsed token name against the resolvable upstream label set.
 * `resolvable === null` means the consumer has no ref data at all (PromptEditor
 * without a `nodeRefs` prop) — such tokens classify `unknown` and render like
 * wired (cyan), never amber, so "no data" never masquerades as "nothing wired".
 */
export function classifyPromptToken(
  name: string,
  resolvable: ReadonlySet<string> | null,
): PromptTokenKind {
  if (name === "" || name.startsWith("image:")) return "skip"
  if (RESERVED_TEMPLATE_VARS.has(name)) return "reserved"
  if (resolvable === null) return "unknown"
  return resolvable.has(name) ? "wired" : "missing"
}

/** Tokens never treated as a real reference: empty, image-ref tokens, reserved vars. */
export function isExcludedToken(raw: string): boolean {
  const kind = classifyPromptToken(raw, null)
  return kind === "skip" || kind === "reserved"
}

/** Non-excluded `{Label}` tokens referenced across the given string fields (trimmed). */
export function referencedRefs(data: Record<string, unknown>, fields: readonly string[]): Set<string> {
  const refs = new Set<string>()
  for (const field of fields) {
    const value = data[field]
    if (typeof value !== "string" || value.length === 0) continue
    for (const match of value.matchAll(NODE_REF_PATTERN)) {
      const { name } = parseNodeRef(match[1] ?? "")
      if (!isExcludedToken(name)) refs.add(name)
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
