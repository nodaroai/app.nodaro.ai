import { imageOverlayCredits, overlayVariantIdFromHandle, VIDEO_UTIL_PRICING } from "@nodaro/shared"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { estimateVideoUtilityBaseCredits } from "@/lib/video-utility-estimate"
import type { WorkflowNode } from "@/types/nodes"

/** Returns the estimated credit cost for a video-utility node by walking
 *  upstream to read source durations. Returns 0 for unsupported node types.
 *
 *  The selector returns a primitive number, so Zustand only triggers a
 *  re-render when the credits actually change — even though the selector
 *  itself re-runs on any store update, that's a few microseconds of pure
 *  math on a JSON object. */
export function useEstimatedCredits(node: WorkflowNode): number {
  return useWorkflowStore((s) => {
    const data = node.data as Record<string, unknown>
    const utility = estimateVideoUtilityBaseCredits(node, s.nodes as WorkflowNode[], s.edges)
    if (utility !== undefined) return utility
    switch (node.type) {
      case "image-overlay": {
        // Base + 2 per extra platform render — ticked ones plus any platform a
        // wire leaves through (mirrors payload-builder's union).
        const ticked = Array.isArray(data.variants) ? (data.variants as unknown[]) : []
        const wired = s.edges
          .filter((e) => e.source === node.id)
          .map((e) => overlayVariantIdFromHandle(e.sourceHandle))
          .filter((id): id is string => !!id)
        return imageOverlayCredits([...ticked, ...wired])
      }
      default:
        return 0
    }
  })
}

/**
 * What a video-utility node's Run is CHARGED (Trim, Loop, Combine, Assemble
 * Narrated Video): its one-unit price — the charged lookup every other node's
 * pill reads — times the units its output spans. The same product the config
 * panel and the workflow estimate quote (getPricingUnits), and the route and
 * the workflow run reserve.
 */
export function useVideoUtilityCredits(node: WorkflowNode): number {
  const unitPrice = useModelCredits(node.type)
  const base = useEstimatedCredits(node)
  return unitPrice * (base / VIDEO_UTIL_PRICING.CREDIT_UNIT)
}
