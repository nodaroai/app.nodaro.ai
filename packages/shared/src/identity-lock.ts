/**
 * Identity Lock — strength control for facial likeness preservation when a
 * Character node's reference photo is fed into downstream generation.
 *
 * Real prompts seen in the wild (especially on Nano-Banana-Pro and
 * ChatGPT-Image) explicitly write `"identitylock": "priority absolute"` /
 * `"strictvisualfidelity": true` to clamp the face to the reference. This
 * helper produces the equivalent natural-language clause so the rest of the
 * stack stays unchanged.
 *
 * Used by:
 *  - frontend DAG executor (`workflow-editor/execute-node.ts`)
 *  - backend orchestrator (`services/workflow-engine/payload-builder.ts`)
 */
import type { GenericNode, GenericEdge, ConnectedReference, ReferenceSource } from "./types.js"
import { PASSTHROUGH_TYPES } from "./ancestor-refs.js"

export type IdentityLockMode = "off" | "soft" | "strict"

/** Default applied when a Character node was created before the field existed. */
export const DEFAULT_IDENTITY_LOCK: IdentityLockMode = "soft"

/** Strict beats Soft beats Off — when multiple Character nodes feed one node. */
const RANK: Record<IdentityLockMode, number> = { off: 0, soft: 1, strict: 2 }

/**
 * Natural-language clause for each mode. Returns an empty string for "off"
 * (or anything unrecognised) so callers can append unconditionally.
 */
export function getIdentityLockClause(mode: IdentityLockMode | undefined): string {
  switch (mode) {
    case "strict":
      return "the subject's facial identity must match the reference photo exactly — no creative reinterpretation; preserve facial structure, eye color, skin tone, and distinctive features precisely."
    case "soft":
      return "preserve the reference subject's overall facial likeness."
    default:
      return ""
  }
}

/** Coerce arbitrary node-data field into a valid `IdentityLockMode`. */
export function toIdentityLockMode(value: unknown): IdentityLockMode {
  if (value === "off" || value === "soft" || value === "strict") return value
  return DEFAULT_IDENTITY_LOCK
}

/**
 * @deprecated Since Fix 4 (character @-mentions revamp) the per-image
 * identity directive in `buildImagePrompt` — via
 * `resolveCharacterMentions` Phase 0 and the strengthened
 * `buildIdentityDirective` for person/character labels — already folds
 * the identity-preservation language directly into the bulleted reference
 * section. The global trailing clause this function used to produce is
 * now redundant for character-wired flows, and this function only ever
 * fired for upstream Character nodes. It now returns "" unconditionally
 * so existing callers stay safe; remove the call sites in a follow-up
 * cleanup, then this helper, `IdentityLockMode`, and `getIdentityLockClause`
 * can be retired.
 */
export function collectIdentityLockClause<N extends GenericNode, E extends GenericEdge>(
  _nodeId: string,
  _nodes: readonly N[],
  _edges: readonly E[],
): string {
  return ""
}

function collectStrongestIdentityLock<N extends GenericNode, E extends GenericEdge>(
  nodeId: string,
  nodes: readonly N[],
  edges: readonly E[],
  visited = new Set<string>(),
): IdentityLockMode | undefined {
  if (visited.has(nodeId)) return undefined
  visited.add(nodeId)
  let strongest: IdentityLockMode | undefined
  const incoming = edges.filter((e) => e.target === nodeId)
  for (const edge of incoming) {
    const src = nodes.find((n) => n.id === edge.source)
    if (!src) continue
    if (src.type === "character") {
      const mode = toIdentityLockMode((src.data as Record<string, unknown>).identityLock)
      if (!strongest || RANK[mode] > RANK[strongest]) strongest = mode
    }
    // Pass-through types don't produce refs themselves but may forward an
    // upstream Character (e.g. ai-writer wired to a Character then to image-gen).
    if (PASSTHROUGH_TYPES.has(src.type)) {
      const upstream = collectStrongestIdentityLock(src.id, nodes, edges, visited)
      if (upstream && (!strongest || RANK[upstream] > RANK[strongest])) strongest = upstream
    }
  }
  return strongest
}

/**
 * Return `true` when any Character node is upstream of `nodeId` (walking
 * through pass-through types). Used to short-circuit
 * `collectIdentityLockClause`: with the new per-image identity directives
 * (Fix 4) the global trailing clause is redundant for character-wired flows.
 *
 * Non-character wired-image refs still get the global clause.
 */
export function hasUpstreamCharacter<N extends GenericNode, E extends GenericEdge>(
  nodeId: string,
  nodes: readonly N[],
  edges: readonly E[],
  visited = new Set<string>(),
): boolean {
  if (visited.has(nodeId)) return false
  visited.add(nodeId)
  const incoming = edges.filter((e) => e.target === nodeId)
  for (const edge of incoming) {
    const src = nodes.find((n) => n.id === edge.source)
    if (!src) continue
    if (src.type === "character") return true
    if (PASSTHROUGH_TYPES.has(src.type)) {
      if (hasUpstreamCharacter(src.id, nodes, edges, visited)) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Per-reference, customizable identity-lock (Unified Reference Roles, Phase A).
//
// Distinct from the node-data `IdentityLockMode` ("off"/"soft"/"strict") above:
// this is an OPTIONAL, opt-in lock line attached to a single resolved
// `ConnectedReference`. OFF by default for EVERY source — a lock line is emitted
// only when the ref explicitly sets `identityLock.enabled === true` (the ref may
// supply custom `.text`; otherwise the source's built-in wording is used).
// Consumed by the prompt builder to prepend a fidelity line per reference.
// ---------------------------------------------------------------------------

/** Built-in lock wording per source. `{ref}` is replaced with the binding. */
const DEFAULT_LOCK_TEXT: Partial<Record<ReferenceSource, string>> = {
  "wired-character": "Lock the exact identity of the person in {ref} — face, bone structure, skin tone, and all unique features.",
  "wired-face": "Lock the exact facial identity in {ref} — bone structure, features, and skin texture.",
  "wired-creature": "Lock the exact identity of the creature in {ref} — anatomy, markings, and all unique features.",
  "wired-location": "Lock the exact look of {ref} — match the location's architecture, layout, and lighting.",
}

/**
 * The identity-lock line for a reference, or `null` when the lock is off.
 * Opt-in only: a line is returned ONLY when `identityLock.enabled === true`
 * (absent or `enabled === false` → `null`). Custom `text` wins (with `{ref}` →
 * binding); otherwise the source's built-in wording is used.
 */
/**
 * Apply a per-mention identity-lock OVERRIDE to `ref` — the tri-state
 * `~lock` / `~nolock` sentinel (Unified Reference Roles, Task 4 + F4). The
 * `lockOverride` argument is the token's parsed `lock`:
 *   - `undefined` → INHERIT: the ORIGINAL ref is returned UNCHANGED (never a
 *     copy), so a lock-less mention resolves byte-identically to before and the
 *     ref/source default governs.
 *   - `true` → FORCE ON: `identityLock.enabled = true` (any existing custom
 *     `text` is preserved) — the `~lock` sentinel.
 *   - `false` → FORCE OFF: `identityLock.enabled = false`, which
 *     `buildIdentityLockLine` renders as `null`, SUPPRESSING even a ref-level
 *     `identityLock.enabled = true` — the `~nolock` sentinel.
 * Called by the three HYBRID mention resolvers right before
 * `buildIdentityLockLine`. Never mutates `ref`.
 */
export function withForcedIdentityLock(ref: ConnectedReference, lockOverride?: boolean): ConnectedReference {
  if (lockOverride === undefined) return ref
  if (lockOverride) return { ...ref, identityLock: { enabled: true, text: ref.identityLock?.text } }
  return { ...ref, identityLock: { enabled: false } }
}

export function buildIdentityLockLine(ref: ConnectedReference, binding: string): string | null {
  const lock = ref.identityLock
  if (!lock?.enabled) return null                       // default OFF + explicit-false OFF
  const interpolate = (t: string) => t.replaceAll("{ref}", binding)
  const custom = lock.text?.trim()
  if (custom) return interpolate(custom)
  const text = DEFAULT_LOCK_TEXT[ref.source]
  return text ? interpolate(text) : null
}
