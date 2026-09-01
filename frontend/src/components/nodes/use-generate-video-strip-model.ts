import { useMemo } from "react"
import {
  VIDEO_GEN_MODELS,
  VIDEO_RESOLUTION_OPTIONS,
  getAspectRatiosForVideoModel,
  getDurationsForVideoModel,
  getVideoModelCapabilitiesTooltip,
} from "@/components/editor/config-panels/model-options"
import { uiResolutionFill, uiDurationFill } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { shortenLabel } from "./strip-label"
import type { GenerateVideoNodeData } from "@/types/nodes"

/**
 * Single source for the generate-video run-strip derivation: model / aspect /
 * duration / resolution / versions, plus all change handlers and the run
 * action. Consumed by BOTH the hover quick-toolbar and the inline in-body run
 * strip so they can never disagree (provider-enum-sync hazard).
 *
 * Body lifted verbatim from generate-video-quick-toolbar.tsx (the original
 * lines 124-198 derivation). Also re-exports `getVideoModelCapabilitiesTooltip`
 * so the caller can thread the model-row tooltip through unchanged.
 */
export function useGenerateVideoStripModel(nodeId: string, data: GenerateVideoNodeData) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  const currentProvider = data.provider || "seedance-2-fast"

  const modelEntry = useMemo(
    () => VIDEO_GEN_MODELS.find((m) => m.value === currentProvider),
    [currentProvider],
  )
  const modelLabel = modelEntry?.label ?? currentProvider
  // Short-form label for the compact pill (drops vendor prefix, fits ~10 chars).
  const modelShort = useMemo(() => {
    const lbl = modelEntry?.label ?? currentProvider
    return lbl.length > 12 ? lbl.slice(0, 11).trimEnd() + "…" : lbl
  }, [modelEntry?.label, currentProvider])

  const aspectOptions = useMemo(() => getAspectRatiosForVideoModel(currentProvider), [currentProvider])
  const durationOptions = useMemo(() => getDurationsForVideoModel(currentProvider), [currentProvider])
  const resolutionOptions = VIDEO_RESOLUTION_OPTIONS[currentProvider]
  // The unified GenerateVideoNodeData picks up a `[key: string]: unknown`
  // index signature via the underlying ImageToVideoData / TextToVideoData
  // intersection — explicit fields like `resolution` survive the Omit, but
  // their inferred type widens to `unknown`-ish when accessed. Coerce to a
  // string at the read boundary; the dropdowns + payload builders all
  // expect strings.
  const currentAspect: string = (typeof data.aspectRatio === "string" ? data.aspectRatio : undefined) ?? aspectOptions[0]?.value ?? ""
  // An UNSET duration/resolution must display the value the node actually
  // renders and bills, which is `durations[0]` / `resolutions[0]` only for the
  // families whose credit-identifier fallback happens to be the first tier.
  // Wan 3.0 is the counter-example this launch introduced: it renders and bills
  // 5s @ 720p while its ascending ladders start at 2s / 480p, so a bare index-0
  // read showed "480p" on a node the badge priced (and `runWan3` rendered) at
  // 720p. `uiResolutionFill` / `uiDurationFill` are the SAME shared helpers the
  // DAG payload builder and the config-panel fail-safe use, so the strip, the
  // panel, the credit badge and the wire cannot drift apart.
  const currentDuration: number | undefined =
    (typeof data.duration === "number" ? data.duration : undefined) ??
    uiDurationFill(currentProvider) ??
    durationOptions[0]?.value
  const currentResolution: string =
    (typeof data.resolution === "string" ? data.resolution : undefined) ??
    (resolutionOptions ? uiResolutionFill(currentProvider) : undefined) ??
    resolutionOptions?.[0]?.value ??
    ""

  // Short labels for the pill — strips the parenthetical descriptor that
  // option labels often carry ("1080p (High)" → "1080p", "16:9 (Landscape)" →
  // "16:9"). The full label still renders inside the dropdown items.
  const aspectShort = shortenLabel(aspectOptions.find((o) => o.value === currentAspect)?.label ?? currentAspect)
  const resolutionShort = shortenLabel(resolutionOptions?.find((o) => o.value === currentResolution)?.label ?? currentResolution)
  const durationShort = currentDuration !== undefined ? `${currentDuration}s` : ""

  // Versions / repeat count — how many results to generate per run. Clamped to
  // 1-4 in this UI.
  const repeatCount = Math.min(Math.max(1, (data.repeatCount as number | undefined) ?? 1), 4)
  const handleRepeatChange = (value: string) => {
    const n = parseInt(value, 10)
    updateNodeData(nodeId, { repeatCount: Number.isFinite(n) ? n : 1 })
  }

  const handleModelChange = (value: string) => {
    updateNodeData(nodeId, { provider: value })
  }
  const handleAspectChange = (value: string) => {
    updateNodeData(nodeId, { aspectRatio: value })
  }
  const handleDurationChange = (value: string) => {
    const n = parseInt(value, 10)
    if (Number.isFinite(n)) {
      updateNodeData(nodeId, { duration: n })
    }
  }
  const handleResolutionChange = (value: string) => {
    updateNodeData(nodeId, { resolution: value })
  }

  return {
    modelLabel,
    modelShort,
    currentProvider,
    modelOptions: VIDEO_GEN_MODELS,
    getModelTooltip: getVideoModelCapabilitiesTooltip,
    aspectOptions,
    currentAspect,
    aspectShort,
    durationOptions,
    currentDuration,
    durationShort,
    resolutionOptions,
    currentResolution,
    resolutionShort,
    repeatCount,
    onModelChange: handleModelChange,
    onAspectChange: handleAspectChange,
    onDurationChange: handleDurationChange,
    onResolutionChange: handleResolutionChange,
    onRepeatChange: handleRepeatChange,
    runSingleNode,
  }
}
