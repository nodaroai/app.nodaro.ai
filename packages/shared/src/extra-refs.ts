/**
 * Shared helper for materializing user-attached "extra reference images" into
 * `ConnectedReference` entries.
 *
 * Used by both:
 *   - frontend `execute-node.ts` (single-node Run + DAG executor path) and
 *   - backend `payload-builder.ts` (orchestrator path)
 * so single-node frontend runs and orchestrator-driven runs produce identical
 * `referenceImageUrls` + assembled prompts. See `frontend/src/types/nodes.ts`
 * for the `ExtraRef` interface and `packages/shared/src/prompt-builder.ts`
 * for the directive emission contract (`buildExtraRefDirectives`).
 *
 * Field mapping:
 *   - manual upload  → source = "manual",          description = ref.description
 *   - char-variant   → source = "wired-character", characterSlug + variantSlug
 *                      preserved, description = ref.description (used as the
 *                      bullet's per-image description in directives — overrides
 *                      `variantDescription` from the character node).
 *
 * Usage-mode resolution: per-ref `usageMode` override → upstream character
 * node's `defaultUsageMode` → global "identical". The resolved mode is stored
 * in `defaultUsageMode` on the resulting `ConnectedReference` so the existing
 * directive emission (`buildExtraRefDirectives`, `buildCanonicalFallback`,
 * `resolveCharacterMentions`) reads it uniformly.
 *
 * Character-node lookup: takes a `lookupCharacterNode` callback so each caller
 * can provide its own (frontend uses Zustand store + edges, backend uses
 * `PayloadBuildContext.nodes` + edges). The callback should return the
 * character node whose name slugifies to `characterSlug`, or undefined if
 * no such character is wired upstream.
 */

import { DEFAULT_USAGE_MODE, type UsageMode } from "./character-usage-mode.js"
import type { ConnectedReference } from "./types.js"

/** Shape of an extra-ref entry on node data. Matches `ExtraRef` in the
 *  frontend `types/nodes.ts`; duplicated here as a structural interface so
 *  the backend (which sees node data as `Record<string, unknown>`) can pass
 *  raw JSON through `expandExtraRefsToConnectedReferences`. */
export interface ExtraRefInput {
  readonly url?: string
  readonly description?: string
  readonly characterSlug?: string
  readonly variantSlug?: string
  readonly variantDisplayName?: string
  readonly usageMode?: UsageMode
}

/** Hook that returns extra metadata for the upstream Character node backing
 *  a given character slug, if any. Used to resolve `defaultUsageMode` and
 *  `characterCanonicalDescription`. */
export interface ExtraRefCharacterContext {
  readonly defaultUsageMode?: UsageMode
  readonly canonicalDescription?: string | null
  readonly displayName?: string
}

/**
 * Convert a list of `ExtraRef` entries into `ConnectedReference` entries that
 * append to the consumer node's existing `connectedReferences` list. The
 * resulting entries carry `isExtraRef: true` so the shared prompt-builder
 * routes them through the dedicated extra-ref directive emission (which
 * handles "Image N is the same subject as Image M, …" pairing).
 *
 * `lookupCharacterContext(slug)` is called for character-sourced extras to
 * resolve the upstream character node's `defaultUsageMode` and canonical
 * description. Returning `undefined` is safe — the helper falls back to the
 * per-ref `usageMode` override or the global default.
 */
export function expandExtraRefsToConnectedReferences(
  extras: ReadonlyArray<ExtraRefInput> | undefined,
  lookupCharacterContext?: (slug: string) => ExtraRefCharacterContext | undefined,
): ConnectedReference[] {
  if (!extras || extras.length === 0) return []
  const out: ConnectedReference[] = []
  for (let i = 0; i < extras.length; i++) {
    const r = extras[i]
    if (!r || !r.url) continue
    const description = (r.description ?? "").trim()
    if (r.characterSlug) {
      // Character-sourced extra. Resolution chain for the effective mode:
      // per-ref override (r.usageMode) → upstream character node's default →
      // global identical. The character node lookup also gives us the
      // canonical description used by "identical"/"face-pose" mode displays.
      const ctx = lookupCharacterContext?.(r.characterSlug)
      const effectiveMode: UsageMode = r.usageMode ?? ctx?.defaultUsageMode ?? DEFAULT_USAGE_MODE
      const displayName = ctx?.displayName || r.characterSlug
      out.push({
        id: `extra_${i}`,
        defaultName: r.variantDisplayName
          ? `${displayName} / ${r.variantDisplayName}`
          : displayName,
        source: "wired-character",
        description,
        url: r.url,
        characterSlug: r.characterSlug,
        variantSlug: r.variantSlug,
        characterCanonicalDescription: ctx?.canonicalDescription ?? null,
        variantDescription: description.length > 0 ? description : null,
        variantDisplayName: r.variantDisplayName,
        defaultUsageMode: effectiveMode,
        isExtraRef: true,
      })
    } else {
      // Manual upload extra. `description` is what the user typed in the
      // per-row textarea; usage mode override applies if set (drives the
      // directive's lock language even for manual refs — covers the "use as
      // style/face only" case for an uploaded photo).
      const effectiveMode: UsageMode | undefined = r.usageMode
      out.push({
        id: `extra_${i}`,
        defaultName: `Image ${i + 1}`,
        source: "manual",
        description,
        url: r.url,
        defaultUsageMode: effectiveMode,
        isExtraRef: true,
      })
    }
  }
  return out
}
