import { useMemo } from "react"
import {
  IMAGE_GEN_MODELS,
  getAspectRatiosForModel,
  IMAGE_RESOLUTION_OPTIONS,
} from "@/components/editor/config-panels/model-options"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { shortenLabel } from "./strip-label"
import type { GenerateImageData } from "@/types/nodes"

/**
 * Single source for the generate-image run-strip model/aspect/resolution/repeat
 * derivation + change handlers + the run action. Consumed by BOTH the hover
 * quick-toolbar and the inline in-body run strip so they can never disagree on
 * the provider default, the aspect/resolution option sets, or the handlers —
 * the provider-enum-sync hazard the plan calls out.
 *
 * Body lifted verbatim from generate-image-quick-toolbar.tsx (the original
 * lines 115-165 derivation): provider/isMulti/modelLabel/modelShort,
 * getAspectRatiosForModel(currentProvider), IMAGE_RESOLUTION_OPTIONS[provider],
 * the shortened pill labels, repeatCount, and the handle* fns that call
 * updateNodeData. `modelOptions` is the shared IMAGE_GEN_MODELS list.
 */
export function useGenerateImageStripModel(nodeId: string, data: GenerateImageData) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  const providers = data.providers && data.providers.length > 0
    ? data.providers
    : [data.provider || "nano-banana-pro"]
  const currentProvider = providers[0]
  const isMulti = providers.length > 1

  const modelEntry = useMemo(
    () => IMAGE_GEN_MODELS.find((m) => m.value === currentProvider),
    [currentProvider],
  )
  const modelLabel = isMulti ? `${providers.length} models` : modelEntry?.label ?? currentProvider
  // Short-form label for the compact pill (drops vendor prefix, fits ~8 chars).
  const modelShort = useMemo(() => {
    if (isMulti) return `${providers.length}M`
    const lbl = modelEntry?.label ?? currentProvider
    return lbl.length > 10 ? lbl.slice(0, 9).trimEnd() + "…" : lbl
  }, [isMulti, providers.length, modelEntry?.label, currentProvider])

  const aspectOptions = useMemo(() => getAspectRatiosForModel(currentProvider), [currentProvider])
  const resolutionOptions = IMAGE_RESOLUTION_OPTIONS[currentProvider]
  const currentAspect = data.aspectRatio ?? aspectOptions[0]?.value ?? ""
  const currentResolution = data.resolution ?? resolutionOptions?.[0]?.value ?? ""

  // Short label for the pill — strips the parenthetical descriptor that
  // option labels often carry ("2K (High)" → "2K", "16:9 (Landscape)" →
  // "16:9"). The full label still renders inside the dropdown items.
  const aspectShort = shortenLabel(aspectOptions.find((o) => o.value === currentAspect)?.label ?? currentAspect)
  const resolutionShort = shortenLabel(resolutionOptions?.find((o) => o.value === currentResolution)?.label ?? currentResolution)

  // Versions / repeat count — how many results to generate per run. Clamped to
  // 1-4 in this UI (the shared helper allows up to 20; we intentionally narrow
  // the toolbar to a sensible default range).
  const repeatCount = Math.min(Math.max(1, (data.repeatCount as number | undefined) ?? 1), 4)
  const handleRepeatChange = (value: string) => {
    const n = parseInt(value, 10)
    updateNodeData(nodeId, { repeatCount: Number.isFinite(n) ? n : 1 })
  }

  const handleModelChange = (value: string) => {
    updateNodeData(nodeId, { provider: value, providers: undefined })
  }
  const handleAspectChange = (value: string) => {
    updateNodeData(nodeId, { aspectRatio: value })
  }
  const handleResolutionChange = (value: string) => {
    updateNodeData(nodeId, { resolution: value })
  }

  return {
    isMulti,
    modelLabel,
    modelShort,
    currentProvider,
    modelOptions: IMAGE_GEN_MODELS,
    aspectOptions,
    currentAspect,
    aspectShort,
    resolutionOptions,
    currentResolution,
    resolutionShort,
    repeatCount,
    onModelChange: handleModelChange,
    onAspectChange: handleAspectChange,
    onResolutionChange: handleResolutionChange,
    onRepeatChange: handleRepeatChange,
    runSingleNode,
  }
}
