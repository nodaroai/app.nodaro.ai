/**
 * Node reference pattern and resolution for {Node Label} template syntax.
 * Shared between frontend and backend.
 */

/** Matches {Node Label} references in text. */
export const NODE_REF_PATTERN = /\{([^}]+)\}/g

/** Reserved template variable names that should NOT be resolved as node refs */
export const RESERVED_TEMPLATE_VARS = new Set([
  "name",
  "description",
  "userPrompt",
  "assetDescriptions",
  "outputCount",
])

/**
 * Split a `{...}` token body into its node name and optional fallback. Splits on the FIRST `||`
 * (a fallback may itself contain `||`); both sides are trimmed. `fallback` is null when there is
 * no `||`, preserving the legacy "leave the literal token" behavior.
 *   "person || man" -> { name: "person", fallback: "man" }
 *   "person || "    -> { name: "person", fallback: "" }     (resolves to empty when absent)
 *   "person"        -> { name: "person", fallback: null }   (literal {person} when absent)
 */
export function parseNodeRef(raw: string): { name: string; fallback: string | null } {
  const i = raw.indexOf("||")
  if (i === -1) return { name: raw.trim(), fallback: null }
  return { name: raw.slice(0, i).trim(), fallback: raw.slice(i + 2).trim() }
}

/**
 * Canonical form of a node-name variable: trimmed + lowercased. Node-name
 * variables are CASE-INSENSITIVE with lowercase as canonical, so nodes labeled
 * `TEXt`, `TEXT`, `text` all feed the one `{text}` variable and `{TEXT}` /
 * `{Text}` / `{text}` in a prompt all resolve to it.
 *
 * Reserved template vars (RESERVED_TEMPLATE_VARS, e.g. `userPrompt`) are matched
 * case-sensitively on the ORIGINAL token BEFORE canonicalization, so `{userPrompt}`
 * stays a reserved token rather than becoming a `userprompt` node ref.
 */
export function canonicalVarName(label: string): string {
  return label.trim().toLowerCase()
}

/**
 * The distinct `{label}` names referenced across the given texts. Mirrors the
 * canvas-side `referencedRefs`: strips the `|| fallback`, and ignores empty
 * tokens, image-ref tokens (`{image:N}`), and RESERVED_TEMPLATE_VARS. Used to
 * SUPPRESS auto-injection of a connected node the author already placed
 * explicitly via `{label}` (so it isn't injected twice). `matchAll` over the
 * global pattern does not mutate its lastIndex, so sharing the constant is safe.
 */
export function extractReferencedLabels(
  ...texts: ReadonlyArray<string | undefined | null>
): Set<string> {
  const refs = new Set<string>()
  for (const text of texts) {
    if (typeof text !== "string" || text.length === 0) continue
    for (const m of text.matchAll(NODE_REF_PATTERN)) {
      const { name } = parseNodeRef(m[1] ?? "")
      if (name === "" || name.startsWith("image:") || RESERVED_TEMPLATE_VARS.has(name)) continue
      refs.add(canonicalVarName(name)) // case-insensitive: {Foo} suppresses a `foo` node
    }
  }
  return refs
}

/** Handle → combine-order category for same-label `{label}` merging. Lower wins
 *  first: prompt (0) → elements (1) → look family (2). Other handles are -1
 *  (not combinable — they keep the per-engine last-wins/suffix behavior). */
export const REF_HANDLE_CATEGORY: Readonly<Record<string, number>> = {
  prompt: 0,
  elements: 1,
  look: 2,
  cinematography: 2,
  style: 2,
}

/** Combine-order category for a direct-parent edge's `targetHandle`; -1 when the
 *  handle isn't one of the combinable prompt/elements/look handles. */
export function refHandleCategory(targetHandle: string | null | undefined): number {
  if (targetHandle != null && Object.prototype.hasOwnProperty.call(REF_HANDLE_CATEGORY, targetHandle)) {
    return REF_HANDLE_CATEGORY[targetHandle]
  }
  return -1
}

/** A candidate contribution to the `{label}` map: the node's label, its resolved
 *  output, and its direct-parent handle category (-1 = not combinable / deeper). */
export interface RefCandidate {
  label: string
  output: string
  category: number
}

/**
 * Same-label COMBINE: when ≥2 direct-parent candidates (category ≥ 0) share a
 * label, `{label}` resolves to their values joined by ", " ordered prompt →
 * elements → look, and within a category by candidate (edge) order. Returns a
 * Map of ONLY the combined labels; the caller fills the rest with its own
 * (FE suffix / BE last-wins) logic, skipping any label present here. Shared so
 * the frontend executor and backend orchestrator never drift.
 */
export function combineSameLabelRefs(candidates: ReadonlyArray<RefCandidate>): Map<string, string> {
  const byLabel = new Map<string, RefCandidate[]>()
  for (const c of candidates) {
    if (c.category < 0) continue
    const key = canonicalVarName(c.label) // TEXt + TEXT + text collapse into one {text}
    const arr = byLabel.get(key)
    if (arr) arr.push(c)
    else byLabel.set(key, [c])
  }
  const combined = new Map<string, string>()
  for (const [label, group] of byLabel) {
    if (group.length < 2) continue
    const ordered = group
      .map((c, i) => ({ c, i }))
      .sort((a, b) => a.c.category - b.c.category || a.i - b.i)
      .map((x) => x.c.output)
    combined.set(label, ordered.join(", "))
  }
  return combined
}

/**
 * Resolve {Node Label} references in text by replacing them with actual node outputs.
 * Skips reserved template variables used by applyTemplate().
 * Iterates until stable to handle nested refs (e.g. {List} → {Animal1} → "dog").
 */
export function resolveNodeRefs(
  text: string,
  labelToOutput: ReadonlyMap<string, string>,
): string {
  const MAX_PASSES = 10
  let result = text
  for (let i = 0; i < MAX_PASSES; i++) {
    const next = result.replace(NODE_REF_PATTERN, (match, raw: string) => {
      const { name, fallback } = parseNodeRef(raw)
      if (RESERVED_TEMPLATE_VARS.has(name)) return match
      // Node-name vars are case-insensitive: try the literal key first (keeps
      // original-cased maps like condition-variables working), then the
      // lowercase-canonical key (node-ref maps are canonical-keyed).
      const output = labelToOutput.get(name) ?? labelToOutput.get(canonicalVarName(name))
      if (output !== undefined) return output            // connected, non-empty output → its value
      if (fallback !== null) return fallback             // absent/empty + fallback → default ("" for {name || })
      return match                                       // absent + no || → literal {name}
    })
    if (next === result) break
    result = next
  }
  return result
}
