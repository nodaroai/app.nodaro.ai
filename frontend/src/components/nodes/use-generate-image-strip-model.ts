import { nodeAspectRatio } from "@nodaro/shared/nodes"
import { useMemo } from "react"
import { useT } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import {
  IMAGE_GEN_MODELS,
  IMAGE_OUTPUT_FORMAT_OPTIONS,
  getSourcePhotoAspectRatios,
  IMAGE_RESOLUTION_OPTIONS,
  withoutDeniedModels,
  writesGif,
} from "@/components/editor/config-panels/model-options"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useSurfaceAvailability } from "@/lib/surface-availability"
import { shortenLabel } from "./strip-label"
import type { GenerateImageData } from "@/types/nodes"
import { IMAGE_MODEL_ROLE_DEFAULTS } from "@nodaro/shared/model-catalog"

/**
 * Single source for the generate-image run-strip model/aspect/resolution/repeat
 * derivation + change handlers + the run action. Consumed by BOTH the hover
 * quick-toolbar and the inline in-body run strip so they can never disagree on
 * the provider default, the aspect/resolution option sets, or the handlers —
 * the provider-enum-sync hazard the plan calls out.
 *
 * Body lifted verbatim from generate-image-quick-toolbar.tsx (the original
 * lines 115-165 derivation): provider/isMulti/modelLabel/modelShort,
 * getSourcePhotoAspectRatios(currentProvider), IMAGE_RESOLUTION_OPTIONS[provider],
 * the shortened pill labels, repeatCount, and the handle* fns that call
 * updateNodeData. `modelOptions` is the shared IMAGE_GEN_MODELS list.
 */
export function useGenerateImageStripModel(nodeId: string, data: GenerateImageData) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  // The menu hides the models this deployment does not offer (the panel's
  // `withoutDeniedModels`); the set lands after the first paint, so subscribe.
  // The node's CURRENT model is read off the full list: a hidden model a saved
  // node holds keeps its name on the pill.
  const availability = useSurfaceAvailability()
  const modelOptions = useMemo(() => withoutDeniedModels(IMAGE_GEN_MODELS, { nodeType: "generate-image" }), [availability])

  const providers = data.providers && data.providers.length > 0
    ? data.providers
    : [data.provider || IMAGE_MODEL_ROLE_DEFAULTS.general]
  const currentProvider = providers[0]
  const isMulti = providers.length > 1

  const modelEntry = useMemo(
    () => IMAGE_GEN_MODELS.find((m) => m.value === currentProvider),
    [currentProvider],
  )
  const modelLabel = isMulti ? t("node.nModels", { n: providers.length }) : modelEntry?.label ?? currentProvider
  // Short-form label for the compact pill (drops vendor prefix, fits ~8 chars).
  const modelShort = useMemo(() => {
    if (isMulti) return `${providers.length}M`
    const lbl = modelEntry?.label ?? currentProvider
    return lbl.length > 10 ? lbl.slice(0, 9).trimEnd() + "…" : lbl
  }, [isMulti, providers.length, modelEntry?.label, currentProvider])

  // A GIF is square (512 a frame): neither the ratio nor the size applies, so
  // both controls hide while it is the file the node writes — as in the panel,
  // which keeps the stored values for another format.
  const gif = !isMulti && writesGif(currentProvider, data.outputFormat)
  // Auto (keep a wired photo's shape) on every model; an unset ratio IS Auto —
  // the panel shows it and the run sends it (`nodeAspectRatio`).
  const aspectOptions = useMemo(() => (gif ? [] : getSourcePhotoAspectRatios(currentProvider)), [currentProvider, gif])
  const resolutionOptions = gif ? undefined : IMAGE_RESOLUTION_OPTIONS[currentProvider]
  const currentAspect = nodeAspectRatio("generate-image", data.aspectRatio) ?? ""
  const currentResolution = data.resolution ?? resolutionOptions?.[0]?.value ?? ""

  // Short label for the pill — strips the parenthetical descriptor that
  // option labels often carry ("2K (High)" → "2K", "16:9 (Landscape)" →
  // "16:9"). The full label still renders inside the dropdown items, which
  // translate it; the pill translates what is left ("Auto"). A GIF's pill
  // names the format in the ratio's place ("GIF (animated)" → "GIF").
  const gifLabel = gif ? IMAGE_OUTPUT_FORMAT_OPTIONS[currentProvider]?.find((o) => o.value === "gif")?.label : undefined
  const aspectShort = localizeOption(shortenLabel(gifLabel ?? aspectOptions.find((o) => o.value === currentAspect)?.label ?? currentAspect))
  const resolutionShort = gif ? "" : shortenLabel(resolutionOptions?.find((o) => o.value === currentResolution)?.label ?? currentResolution)

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
    modelOptions,
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
