"use client"

import { Volume2, VolumeX } from "lucide-react"
import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  useResultGenerationSettings,
  buildAppliedConfigPatch,
} from "@/hooks/use-result-generation-settings"
import {
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
} from "@/components/editor/config-panels/model-options"
import { ResultSettingsInfo, type ResultSummaryRow } from "./result-settings-info"
import { nonEmptyString } from "@/lib/utils"
import type { GeneratedResult, GenerateVideoNodeData } from "@/types/nodes"

interface GenerateVideoResultInfoProps {
  readonly nodeId: string
  /** The active result whose generation settings to surface. */
  readonly result: GeneratedResult | undefined
  /** Current node data — fallback for display when the job is unavailable. */
  readonly data: GenerateVideoNodeData
}

// value → label across the FULL i2v ∪ t2v union, built once at module load.
// I2V is inserted first and wins on id collisions (mirrors VIDEO_GEN_MODELS'
// "I2V entries win" rule), so a provider present in both lists keeps its i2v
// label. `VIDEO_GEN_MODELS` (the picker list) collapses split-id t2v twins
// (grok, wan, wan-2.7-t2v), so a job that recorded a collapsed id would miss
// there — this union always resolves.
const VIDEO_MODEL_LABELS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const m of [...VIDEO_I2V_MODELS, ...VIDEO_T2V_MODELS]) {
    if (!map.has(m.value)) map.set(m.value, m.label)
  }
  return map
})()

/** Resolve a video provider id to its display label; falls back to the raw id. */
export function videoModelLabelFor(provider: string | undefined): string {
  if (!provider) return "—"
  return VIDEO_MODEL_LABELS.get(provider) ?? provider
}

/**
 * Hover-revealed pill at the bottom-right of a Generate Video result — the
 * video sibling of `GenerateImageResultInfo`. Shows the model / aspect /
 * resolution / duration (+ an audio indicator) that produced THIS output and
 * offers to re-apply those settings to the node. Thin wrapper over the shared
 * `ResultSettingsInfo`.
 */
export function GenerateVideoResultInfo({
  nodeId,
  result,
  data,
}: GenerateVideoResultInfoProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const jobId = result?.jobId && result.jobId.length > 0 ? result.jobId : undefined
  const { data: settings, isLoading } = useResultGenerationSettings(jobId)

  // Prefer the job's actual settings (drift-proof, per-result); fall back to
  // the node's current config for legacy/purged jobs. `aspectRatio`/`resolution`
  // are coerced via `nonEmptyString` because `GenerateVideoNodeData`'s string-
  // index signature widens them to `unknown` (a truthy `unknown` narrows to
  // `{}`, which isn't assignable to `string`) — unlike GenerateImageData, where
  // they're concretely typed.
  const provider = settings?.provider ?? data.provider
  const aspect = settings?.aspectRatio ?? nonEmptyString(data.aspectRatio)
  const resolution = settings?.resolution ?? nonEmptyString(data.resolution)
  const duration = settings?.duration ?? data.duration
  // Audio is special: its ABSENCE is meaningful (many providers have no audio
  // lever at all). Show it only when THIS job recorded it — never fall back to
  // the node's current config, which would paint a misleading on/off for a
  // result whose provider never produced audio.
  const recordedAudio = settings?.generateAudio
  const model = videoModelLabelFor(provider)
  const durationLabel = typeof duration === "number" ? `${duration}s` : undefined
  const summary = [model, aspect, resolution, durationLabel].filter(Boolean).join(" · ")

  const rows: ResultSummaryRow[] = [{ label: "Model", value: model }]
  if (aspect) rows.push({ label: "Aspect", value: aspect })
  if (resolution) rows.push({ label: "Resolution", value: resolution })
  if (durationLabel) rows.push({ label: "Duration", value: durationLabel })
  if (typeof recordedAudio === "boolean")
    rows.push({ label: "Audio", value: recordedAudio ? "On" : "Off" })

  const audioIcon =
    typeof recordedAudio === "boolean" ? (
      recordedAudio ? (
        <Volume2 className="w-3 h-3 shrink-0 opacity-80" aria-label="Audio on" />
      ) : (
        <VolumeX className="w-3 h-3 shrink-0 opacity-60" aria-label="Audio off" />
      )
    ) : undefined

  return (
    <ResultSettingsInfo
      summary={summary}
      summaryTrailing={audioIcon}
      rows={rows}
      settings={settings}
      isLoading={isLoading}
      mediaNoun="video"
      onApply={(includePrompt) => {
        if (!settings) return
        updateNodeData(nodeId, buildAppliedConfigPatch(settings, { includePrompt }))
        toast.success(includePrompt ? "Applied settings + prompt" : "Applied settings")
      }}
    />
  )
}
