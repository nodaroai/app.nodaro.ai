import { REF_IMAGE_MAX_LIMITS, DEFAULT_REF_IMAGE_MAX, MODELS_WITH_REFERENCE_IMAGE_SUPPORT } from "@nodaro/shared"
import type { WorkflowNode } from "@/types/nodes"

export interface HandleConnectionLimit {
  /** Number of connections the runtime will actually consume on this
   *  handle for the consumer's current model. Connections beyond this
   *  count are wired but silently ignored at execution. */
  readonly limit: number
  /** Short human-readable identifier — provider id for single-provider
   *  nodes, "selected models" for multi-provider. Used in tooltip copy. */
  readonly providerLabel: string
  /** True when the consumer node is in multi-provider mode and the limit
   *  was computed from the MIN across selected providers; the tooltip
   *  should clarify "may not be used by all selected models". */
  readonly isMultiProviderMin: boolean
}

/**
 * Returns the effective MAX connection count for a given (node, handle)
 * pair, derived from the consumer's currently-selected model. The popover
 * uses this to show "M of N max" in the count label and to gray out any
 * wired rows past the limit (they're still saved with the workflow but
 * the runtime drops them).
 *
 * Returns `null` when there is no per-model limit for this handle — most
 * handles fall here.
 *
 * Currently covers Generate Image's `references` handle (the only handle
 * with a documented per-provider max). Extend to other handles (Assets,
 * etc.) when their limits become available in @nodaro/shared.
 */
export function getHandleConnectionLimit(
  node: WorkflowNode | undefined,
  handleId: string,
): HandleConnectionLimit | null {
  if (!node) return null

  if (node.type === "generate-image" && handleId === "references") {
    const data = node.data as { provider?: string; providers?: readonly string[] } | undefined
    const providers: readonly string[] =
      data?.providers && data.providers.length > 0
        ? data.providers
        : [data?.provider || "nano-banana-pro"]

    // Filter to providers that actually consume reference images — others
    // ignore them entirely, so their "limit" of zero would be misleading.
    const refConsumers = providers.filter((p) => MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(p))
    if (refConsumers.length === 0) return null

    // Multi-provider: pick the MIN limit across selected providers — past
    // that count, AT LEAST one provider will silently drop the ref. The
    // tooltip can clarify that this is the most-restrictive provider.
    let minLimit = Infinity
    for (const p of refConsumers) {
      const lim = REF_IMAGE_MAX_LIMITS[p] ?? DEFAULT_REF_IMAGE_MAX
      if (lim < minLimit) minLimit = lim
    }
    if (!Number.isFinite(minLimit)) return null

    return {
      limit: minLimit,
      providerLabel: refConsumers.length > 1 ? "selected models" : refConsumers[0],
      isMultiProviderMin: refConsumers.length > 1,
    }
  }

  return null
}
