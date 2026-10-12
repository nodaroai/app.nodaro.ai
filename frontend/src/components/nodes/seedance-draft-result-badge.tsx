"use client"

import { useT } from "@/lib/i18n"
import { useResultGenerationSettings } from "@/hooks/use-result-generation-settings"
import type { GeneratedResult } from "@/types/nodes"

/**
 * "Draft" badge on a Seedance 2.5 draft result (480p). Read from the result
 * itself when the single-node run stamped it, else from the result's job
 * (`input_data.draft`), so a workflow-run draft is badged too.
 *
 * `lookup` says whether this result can be a draft at all; when false (a
 * Wan / Runway video-to-video node) the job is never fetched for it. On
 * Generate Video the job query is the one the result-info pill already
 * caches, so it stays on. A result already stamped `draft` needs no lookup.
 * Hides on hover so it never covers the result's own controls.
 */
export function SeedanceDraftResultBadge({
  result,
  lookup = true,
}: {
  readonly result: GeneratedResult | undefined
  readonly lookup?: boolean
}) {
  const t = useT()
  const jobId = result?.jobId && result.jobId.length > 0 ? result.jobId : undefined
  const { data: settings } = useResultGenerationSettings(jobId, { enabled: lookup && result?.draft !== true })
  if (result?.draft !== true && settings?.draft !== true) return null
  return (
    <span className="absolute bottom-2 left-2 z-10 px-1.5 py-0.5 rounded-md bg-amber-500/80 text-white text-[10px] font-medium pointer-events-none transition-opacity group-hover/video:opacity-0">
      {t("node.draftBadge")}
    </span>
  )
}

/** The finalize's notice code when the draft's audio could not be re-applied. */
export const DRAFT_AUDIO_NOT_REAPPLIED = "draft_audio_not_reapplied"

/**
 * Warning on a Seedance 2.5 HD (from draft) result whose draft audio could not
 * be re-applied: the 1080p video was delivered silent. Read from the result's
 * job (`output_data.warningCode`), so workflow runs show it too. Localised by
 * code; the backend's English `warningMessage` is the fallback for other codes.
 * Mount it only where a result can carry it (a node set to Seedance 2.5 HD) —
 * every mount is a job lookup.
 */
export function SeedanceHdAudioWarning({ result }: { readonly result: GeneratedResult | undefined }) {
  const t = useT()
  const jobId = result?.jobId && result.jobId.length > 0 ? result.jobId : undefined
  const { data: settings } = useResultGenerationSettings(jobId)
  if (settings?.warningCode !== DRAFT_AUDIO_NOT_REAPPLIED) return null
  return (
    <div
      role="status"
      className="absolute top-2 left-2 right-2 z-10 px-2 py-1 rounded-md bg-amber-500/90 text-white text-[10px] leading-snug pointer-events-none transition-opacity group-hover/node:opacity-0"
    >
      {t("node.draftAudioNotReapplied")}
    </div>
  )
}
