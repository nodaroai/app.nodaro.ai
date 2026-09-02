/**
 * Workflow-node parameter normalization.
 *
 * The config panels already prevent an impossible provider/parameter pair from
 * being *selected*: their dropdowns are provider-aware and a fail-safe effect
 * snaps stale values when the provider changes. But both of those are React
 * effects — they only run when that specific node's panel or hover strip is
 * mounted. A node written straight into workflow JSON by a non-UI author (an
 * agent, an import, a template) is never seen by either, so its invalid pair
 * survives all the way to the provider call.
 *
 * That is the 2026-08-09 incident: one `generate-image` node carrying
 * `gpt-image` + `16:9` (GPT Image 1.5 renders 1:1 / 3:2 / 2:3 only) reached KIE,
 * got rejected, and aborted a run whose five sibling nodes had already produced
 * — and billed for — their images.
 *
 * This module is the write-boundary guard: it heals the node instead of
 * rejecting it, so the user sees a valid value on the canvas rather than a
 * failed run. It reads exclusively from `MODEL_CATALOG`, so a model added later
 * is covered without touching this file.
 */

import { normalizeModelInput, type ModelInputAdjustment } from "./model-catalog.js"

/**
 * Node types whose `data` carries catalog-governed model parameters under the
 * shape this module understands (`provider` + aspectRatio/resolution/quality).
 *
 * IMAGE ONLY, deliberately. The video nodes route several of these fields
 * through mode-dependent defaults (`"adaptive"` for Seedance/Hailuo, duration
 * composites tied to pricing) that this flat normalizer would flatten wrongly;
 * they get their own pass once those defaults are catalog-derived too.
 *
 * `modify-image` carries the same provider/aspectRatio/resolution/quality trio
 * as `image-to-image` (it routes through the same worker), and `edit-image`
 * carries provider + aspectRatio. `edit-image`'s `targetResolution` is an
 * UPSCALE target, a different field this module never reads — so listing the
 * type here heals its ratio without touching what it is priced on.
 */
export const MODEL_PARAM_NODE_TYPES: ReadonlySet<string> = new Set([
  "generate-image",
  "image-to-image",
  "modify-image",
  "edit-image",
])

export interface NodeParamAdjustment extends ModelInputAdjustment {
  nodeId: string
  provider: string
}

export interface NormalizedNodes<T> {
  nodes: T[]
  /** Empty when nothing needed correcting. */
  adjustments: NodeParamAdjustment[]
}

interface NodeLike {
  id?: unknown
  type?: unknown
  data?: unknown
}

/**
 * Return `nodes` with every catalog-governed image parameter coerced into a
 * combination its provider actually accepts, plus the list of what changed.
 *
 * Immutable: nodes that need no correction are returned by reference, and a
 * corrected node is a fresh object (never a mutation of the caller's input).
 *
 * Multi-provider nodes (`data.providers` holding 2+ entries) are SKIPPED: the
 * valid set there is the intersection across every selected provider, and when
 * a stored value falls outside it there is no single defensible replacement —
 * picking one provider's default would silently misconfigure the others. Those
 * nodes are still guarded interactively by the panel's intersection dropdown.
 */
export function normalizeNodeModelParams<T extends NodeLike>(
  nodes: readonly T[],
): NormalizedNodes<T> {
  const adjustments: NodeParamAdjustment[] = []
  const out = nodes.map((node) => {
    const type = typeof node.type === "string" ? node.type : ""
    if (!MODEL_PARAM_NODE_TYPES.has(type)) return node

    const data = node.data
    if (!data || typeof data !== "object" || Array.isArray(data)) return node
    const d = data as Record<string, unknown>

    const multi = Array.isArray(d.providers) ? (d.providers as unknown[]) : []
    if (multi.length > 1) return node

    const provider =
      typeof d.provider === "string"
        ? d.provider
        : typeof multi[0] === "string"
          ? (multi[0] as string)
          : undefined
    if (!provider) return node

    const normalized = normalizeModelInput(provider, {
      aspectRatio: typeof d.aspectRatio === "string" ? d.aspectRatio : undefined,
      resolution: typeof d.resolution === "string" ? d.resolution : undefined,
      quality: typeof d.quality === "string" ? d.quality : undefined,
    })
    if (normalized.adjustments.length === 0) return node

    const nodeId = typeof node.id === "string" ? node.id : "(unknown node)"
    for (const adj of normalized.adjustments) {
      adjustments.push({ ...adj, nodeId, provider })
    }

    // Only the three governed keys are rewritten; everything else on the node
    // is passed through untouched. A dropped lever is written as `undefined`
    // rather than deleted so the shape stays stable for downstream readers.
    return {
      ...node,
      data: {
        ...d,
        aspectRatio: normalized.aspectRatio,
        resolution: normalized.resolution,
        quality: normalized.quality,
      },
    }
  })

  return { nodes: out, adjustments }
}

/** One-line-per-change summary, for surfacing back to an agent or a log. */
export function describeNodeAdjustments(adjustments: readonly NodeParamAdjustment[]): string[] {
  return adjustments.map(
    (a) => `${a.nodeId} (${a.provider}): ${a.field} "${a.from}" → ${a.to === undefined ? "removed" : `"${a.to}"`} — ${a.reason}`,
  )
}
