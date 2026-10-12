import { toast } from "sonner"
import { tx } from "@/lib/i18n"
import { measureClipLength } from "@/lib/api"
import type { MeasureClip } from "./speaker-view-source"
import type { ExecutionContext } from "./types"

/**
 * The editor's measurement of a clip for the source checks (decided 2026-10-12,
 * R4): the cached background job, polled. Says once that the video is being
 * checked, and ends the moment the run is stopped or replaced (a Stop or a
 * restarted run rejects with `ClipMeasureStopped`, never a refusal).
 */
export function editorClipMeasure(ctx: Pick<ExecutionContext, "signal" | "isWorkflowStale">): MeasureClip {
  return (videoUrl) =>
    measureClipLength({
      videoUrl,
      onWaiting: () => toast.info(tx("nodeRun.speakerViewChecking")),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      isStale: ctx.isWorkflowStale,
    })
}
