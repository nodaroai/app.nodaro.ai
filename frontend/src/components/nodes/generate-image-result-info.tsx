"use client"

import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  useResultGenerationSettings,
  buildAppliedConfigPatch,
} from "@/hooks/use-result-generation-settings"
import { IMAGE_GEN_MODELS } from "@/components/editor/config-panels/model-options"
import { ResultSettingsInfo, type ResultSummaryRow } from "./result-settings-info"
import type { GeneratedResult, GenerateImageData } from "@/types/nodes"

interface GenerateImageResultInfoProps {
  readonly nodeId: string
  /** The active result whose generation settings to surface. */
  readonly result: GeneratedResult | undefined
  /** Current node data — fallback for display when the job is unavailable. */
  readonly data: GenerateImageData
}

function modelLabelFor(provider: string | undefined): string {
  if (!provider) return "—"
  return IMAGE_GEN_MODELS.find((m) => m.value === provider)?.label ?? provider
}

/**
 * Hover-revealed pill at the bottom-right of a Generate Image result. Shows the
 * model / aspect / resolution that produced THIS output and offers to re-apply
 * those settings to the node. Thin wrapper over the shared `ResultSettingsInfo`
 * — see it for the drift-proof rationale.
 */
export function GenerateImageResultInfo({
  nodeId,
  result,
  data,
}: GenerateImageResultInfoProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const jobId = result?.jobId && result.jobId.length > 0 ? result.jobId : undefined
  const { data: settings, isLoading } = useResultGenerationSettings(jobId)

  // Prefer the job's actual settings (drift-proof, correct per-result); fall
  // back to the node's current config for legacy/purged jobs so the pill
  // always shows something sensible.
  const provider = settings?.provider ?? data.provider
  const aspect = settings?.aspectRatio ?? data.aspectRatio
  const resolution = settings?.resolution ?? data.resolution
  const model = modelLabelFor(provider)
  const summary = [model, aspect, resolution].filter(Boolean).join(" · ")

  const rows: ResultSummaryRow[] = [{ label: "Model", value: model }]
  if (aspect) rows.push({ label: "Aspect", value: aspect })
  if (resolution) rows.push({ label: "Resolution", value: resolution })

  return (
    <ResultSettingsInfo
      summary={summary}
      rows={rows}
      settings={settings}
      isLoading={isLoading}
      mediaNoun="image"
      onApply={(includePrompt) => {
        if (!settings) return
        updateNodeData(nodeId, buildAppliedConfigPatch(settings, { includePrompt }))
        toast.success(includePrompt ? "Applied settings + prompt" : "Applied settings")
      }}
    />
  )
}
