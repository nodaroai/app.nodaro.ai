import { NODE_REF_PATTERN, parseNodeRef, canonicalVarName, classifyRefToken, type RefTokenKind } from "@nodaro/shared"

/** How a `{...}` token (parsed name) renders/behaves. Single source of truth for
 *  the editor decoration AND the missing-refs chip — predicate-level identity.
 *  Name kept for the existing call sites; the classifier itself now lives in
 *  `@nodaro/shared` (`classifyRefToken`) so the editor and the backend dispatch
 *  guard can never drift on what counts as a reference. */
export type PromptTokenKind = RefTokenKind

/**
 * Classify a parsed token name against the resolvable upstream label set.
 * `resolvable === null` means the consumer has no ref data at all (PromptEditor
 * without a `nodeRefs` prop) — such tokens classify `unknown` and render like
 * wired (cyan), never amber, so "no data" never masquerades as "nothing wired".
 *
 * Delegates to `@nodaro/shared`: node-name variables are matched
 * case-insensitively there, and the excluded namespaces are the shared
 * `REF_TOKEN_NAMESPACE_PREFIXES` (`image:` / `video:` / `audio:` / `slot:` /
 * `ref:`), not `image:` alone.
 */
export function classifyPromptToken(
  name: string,
  resolvable: ReadonlySet<string> | null,
): PromptTokenKind {
  return classifyRefToken(name, resolvable)
}

/** Tokens never treated as a real reference: empty, reference-namespace tokens
 *  (`image:` / `video:` / `audio:` / `slot:` / `ref:`), reserved vars. */
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
      if (!isExcludedToken(name)) refs.add(canonicalVarName(name))
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
