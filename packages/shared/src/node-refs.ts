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
 *
 * Deliberately NOT `REF_TOKEN_NAMESPACE_PREFIXES`: widening this changes
 * run-time auto-injection on BOTH engines (follow-up ticket), not just the
 * editor.
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

/**
 * Reference-handle id → resolved-input key. The SINGLE SOURCE OF TRUTH for which
 * `targetHandle` ids carry image / video / audio reference inputs. Shared by the
 * backend input-resolver (routes the wired URL into the matching
 * `referenceImageUrls` / `referenceVideoUrls` / `referenceAudioUrls` slot) AND
 * the positional `{image:N}` / `{video:N}` / `{audio:N}` body-token COUNTS in the
 * FE preview (`video-prompt-assembly.ts`), FE run (`execute-node.ts`), and BE
 * payload-builder.
 *
 * Two handle families map to the same keys:
 *   - Legacy / i2v single-name ids (`references` / `reference-videos` /
 *     `reference-audio`) — kept for un-migrated workflows.
 *   - Canonical typed-handle ids the modern Generate Video node exposes
 *     (`imageReferences` / `videoReferences` / `audioReferences`) — share the
 *     resolved-input keys with the legacy ids so consumer code never forks.
 */
export const REFERENCE_HANDLE_MAP: Record<string, "referenceImageUrls" | "referenceVideoUrls" | "referenceAudioUrls"> = {
  // Legacy / i2v single-name handle ids (kept for un-migrated workflows)
  "references": "referenceImageUrls",
  "reference-videos": "referenceVideoUrls",
  "reference-audio": "referenceAudioUrls",
  // New canonical typed-handle ids (Generate Video) — share the resolved-input
  // keys with the legacy ids so payload-builder code doesn't fork.
  "imageReferences": "referenceImageUrls",
  "videoReferences": "referenceVideoUrls",
  "audioReferences": "referenceAudioUrls",
}

/** The three reference modalities a reference handle can carry. */
export type ReferenceModality = "image" | "video" | "audio"

/**
 * The reference MODALITY a `targetHandle` carries, or null when the handle is
 * not a reference handle. Resolves BOTH the legacy single-name ids and the
 * canonical Generate Video ids (via REFERENCE_HANDLE_MAP), so positional
 * `{image:N}` / `{video:N}` / `{audio:N}` token counts cover every handle alias
 * — without this, the generate-video `imageReferences` handle was silently
 * uncounted and `{image:N}` tokens dropped to bare labels on the only creatable
 * video node.
 */
export function referenceModalityForHandle(targetHandle: string | null | undefined): ReferenceModality | null {
  if (targetHandle == null) return null
  const key = REFERENCE_HANDLE_MAP[targetHandle]
  return key === "referenceImageUrls" ? "image" : key === "referenceVideoUrls" ? "video" : key === "referenceAudioUrls" ? "audio" : null
}

/**
 * Frame target handles (start / end keyframes). An image wired into one of these
 * is a KEYFRAME, not an `{image:N}` reference: the backend appends frames at the
 * TAIL of `reference_image_urls` (`resolveSeedance2Inputs`), never numbered. The
 * editor MUST therefore exclude them from `{image:N}` numbering so editor token N
 * equals the worker reference slot N.
 *
 * The SINGLE source of truth for "is this a frame handle," shared by the
 * config-panel autocomplete (`video-configs.tsx`) AND the inline/modal builder
 * (`connected-references.ts`) — without ONE definition those two surfaces drifted
 * and the inline editor numbered the frame as `{image:1}` (the C1 bug). Frames
 * are deliberately NOT in `REFERENCE_HANDLE_MAP`: they carry no reference
 * modality, so `referenceModalityForHandle` already returns `null` for them on
 * the count side — this set is the exclusion lever for the EDITOR-numbering side.
 */
export const FRAME_TARGET_HANDLES: ReadonlySet<string> = new Set(["startFrame", "endFrame"])

/**
 * Minimal structural edge shape {@link countRefModalityEdges} reads — only the
 * two fields the count needs. Both the FE `WorkflowEdge` (xyflow `Edge`, whose
 * `target` is a non-null string) and the BE `SimpleEdge` satisfy it.
 */
export interface RefModalityEdge {
  target?: string | null
  targetHandle?: string | null
}

/**
 * Count the reference-handle edges of a given reference MODALITY wired into a
 * node — the ONE positional `{image:N}` / `{video:N}` / `{audio:N}` counter
 * shared by the FE preview (`video-prompt-assembly.ts`), the FE run
 * (`execute-node.ts`), and the BE orchestrator (`payload-builder.ts`). Counting
 * via `referenceModalityForHandle` (not a single handle string) covers BOTH the
 * legacy single-name ids (`references` / `reference-videos` / `reference-audio`)
 * AND the canonical Generate Video ids (`imageReferences` / `videoReferences` /
 * `audioReferences`), so editor token N maps 1:1 to the worker
 * `referenceImageUrls` / `referenceVideoUrls` / `referenceAudioUrls` slot N on
 * every handle alias. This is the EDGE count (not the resolved/list-expanded URL
 * count) so all three paths stay byte-identical; the edge-vs-resolved divergence
 * for a reference edge that fans out to >1 URL (a List producer) is a shared,
 * documented v1 limitation.
 */
export function countRefModalityEdges(
  edges: ReadonlyArray<RefModalityEdge>,
  nodeId: string,
  modality: ReferenceModality,
): number {
  let n = 0
  for (const e of edges) {
    if (e.target === nodeId && referenceModalityForHandle(e.targetHandle) === modality) n += 1
  }
  return n
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

/**
 * Token namespaces that are NOT node-label references. `{image:1:face}` is the
 * unified-reference grammar, `{slot:x}` is recast's, `{video:N}`/`{audio:N}`
 * are reference handles, and `{ref:<id>}` is the id-addressed reference form —
 * all five are substituted by their own resolvers (`resolveReferenceTokens`,
 * `resolveRefIdTokens`, the recast slot pass), not by resolveNodeRefs. Before
 * this list existed, only `image:` was excluded, so `{video:1}` classified as a
 * MISSING node ref.
 *
 * Compared against the LOWERCASED token name: `REFERENCE_TOKEN_RE` is `/gi` and
 * `REF_ID_TOKEN_RE` spells `[rR][eE][fF]`, so `{Image:1}` / `{Ref:x}` really do
 * resolve downstream and must never read as a missing node ref.
 */
export const REF_TOKEN_NAMESPACE_PREFIXES: readonly string[] = [
  "image:", "video:", "audio:", "slot:", "ref:",
]

export type RefTokenKind = "wired" | "reserved" | "missing" | "skip" | "unknown"

/**
 * Classify a parsed `{...}` token name against the resolvable label set.
 * `resolvable === null` means the caller has no ref data at all — such tokens
 * classify `unknown` and must render like wired, so "no data" never
 * masquerades as "nothing wired".
 *
 * Single source of truth for the editor decoration, the missing-refs chip
 * (frontend/src/lib/prompt-ref-scan.ts delegates here) and the execution
 * engine's dispatch guard.
 */
export function classifyRefToken(
  name: string,
  resolvable: ReadonlySet<string> | null,
): RefTokenKind {
  const lower = name.toLowerCase()
  if (name === "" || REF_TOKEN_NAMESPACE_PREFIXES.some((p) => lower.startsWith(p))) return "skip"
  if (RESERVED_TEMPLATE_VARS.has(name)) return "reserved"
  if (resolvable === null) return "unknown"
  return resolvable.has(canonicalVarName(name)) ? "wired" : "missing"
}

/**
 * The `{Label}` tokens in `text` that `resolveNodeRefs` would leave LITERAL and
 * that no upstream node can explain — i.e. exactly what would reach a provider
 * as the characters `{Label}`. Evidence for why this matters: `{Describe Image}`
 * ×2 (gpt-image-2) and `{gravity flip}` / `{rewind}` (seedance-2-5) in the
 * 2026-09-01 app-reports export.
 *
 * `resolvable` — labels with a value in the ref map (canonical/lowercase).
 * `known`      — canonical labels of the nodes the caller considers to EXIST
 *                (no state requirement; the backend passes every node in the
 *                run's graph).
 *
 * A token whose label is in `known` but not `resolvable` PASSES: the node
 * exists and simply produced nothing, which is the caller's to substitute (the
 * backend resolves it to empty text), not this function's to refuse. A token
 * with an explicit `|| fallback` passes too — the fallback is substituted.
 * Returns original-cased names, de-duplicated by canonical form, for the
 * user-facing message.
 */
export function unresolvedRefTokens(
  text: string,
  opts: { resolvable: ReadonlySet<string>; known: ReadonlySet<string> },
): string[] {
  if (typeof text !== "string" || text.length === 0) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(NODE_REF_PATTERN)) {
    const { name, fallback } = parseNodeRef(m[1] ?? "")
    if (fallback !== null) continue
    if (classifyRefToken(name, opts.resolvable) !== "missing") continue
    const canon = canonicalVarName(name)
    if (opts.known.has(canon) || seen.has(canon)) continue
    seen.add(canon)
    out.push(name)
  }
  return out
}
