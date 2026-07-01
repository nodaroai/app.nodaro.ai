"use client"

import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useResultGenerationSettings } from "@/hooks/use-result-generation-settings"
import { ResultSettingsInfo, type ResultSummaryRow } from "./result-settings-info"
import type { GeneratedResult, ImageCollageData } from "@/types/nodes"

interface ImageCollageResultInfoProps {
  readonly nodeId: string
  /** The active result whose generation settings to surface. */
  readonly result: GeneratedResult | undefined
  /** Current node data — fallback for display when the job is unavailable. */
  readonly data: ImageCollageData
}

const LAYOUT_LABEL: Record<string, string> = { smart: "Smart", grid: "Grid" }

/**
 * Hover-revealed pill at the bottom-right of an Image Collage result — the
 * collage counterpart to {@link GenerateImageResultInfo}. Shows the layout /
 * aspect / resolution that produced THIS output (read from its job's
 * `input_data`, drift-proof) and offers to re-apply them to the node. Thin
 * wrapper over the shared `ResultSettingsInfo`; `hidePromptApply` because a
 * collage has no prompt.
 */
export function ImageCollageResultInfo({ nodeId, result, data }: ImageCollageResultInfoProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const jobId = result?.jobId && result.jobId.length > 0 ? result.jobId : undefined
  const { data: settings, isLoading } = useResultGenerationSettings(jobId)

  // Prefer the job's actual settings (correct per-result); fall back to the
  // node's current config for legacy/purged jobs so the pill always shows
  // something sensible.
  const layoutRaw = settings?.layout ?? data.layout
  const aspect = settings?.aspectRatio ?? data.aspectRatio
  const resolution = settings?.resolution ?? data.resolution
  const layout = layoutRaw ? (LAYOUT_LABEL[layoutRaw] ?? layoutRaw) : undefined
  const summary = [layout, aspect, resolution].filter(Boolean).join(" · ")

  const rows: ResultSummaryRow[] = []
  if (layout) rows.push({ label: "Layout", value: layout })
  if (aspect) rows.push({ label: "Aspect", value: aspect })
  if (resolution) rows.push({ label: "Resolution", value: resolution })

  return (
    <ResultSettingsInfo
      summary={summary}
      rows={rows}
      settings={settings}
      isLoading={isLoading}
      mediaNoun="collage"
      hidePromptApply
      onApply={() => {
        if (!settings) return
        const patch: Record<string, unknown> = {}
        if (settings.layout !== undefined) patch.layout = settings.layout
        if (settings.aspectRatio !== undefined) patch.aspectRatio = settings.aspectRatio
        if (settings.resolution !== undefined) patch.resolution = settings.resolution
        updateNodeData(nodeId, patch)
        toast.success("Applied settings")
      }}
    />
  )
}
