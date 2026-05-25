import { Loader2 } from "lucide-react"
import type { PipelineStageName } from "@nodaro/shared"

const STAGE_LABELS: Record<PipelineStageName, string> = {
  script: "Stage 1 — Script",
  characters: "Stage 2 — Characters",
  objects: "Stage 3 — Objects",
  locations: "Stage 4 — Locations",
  shot_list: "Stage 5 — Shot List",
  scene_images: "Stage 6 — Scene Images",
  animate_audio_edit: "Stage 7 — Animate & Audio",
  post_merge: "Stage 8 — Final Merge",
}

interface Props {
  stageName: PipelineStageName
  message: string
  /** Coarse stream-progress proxy (cumulative tool-use bytes). When present,
   *  shown as a "(N.N KB so far)" suffix; otherwise just the message. */
  bytesSoFar?: number
}

/**
 * Live LLM-stream progress surface. Mounts on the first `stage:progress`
 * SSE event for the active stage; the parent panel unmounts it when the
 * stage transitions out of `running`. Replaces the 2-minute spinner with a
 * "Drafting plan… (3.4 KB so far)" narrative so the user sees the system
 * is alive even before the structured output is ready to render.
 */
export function StageProgressBanner({ stageName, message }: Props) {
  return (
    <div
      className="mb-3 rounded border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 p-3 flex items-center gap-3"
      data-testid="stage-progress-banner"
    >
      <Loader2 className="w-4 h-4 text-blue-700 dark:text-blue-300 animate-spin shrink-0" />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-blue-700 dark:text-blue-300 font-semibold">
          {STAGE_LABELS[stageName]}
        </div>
        <div className="text-sm text-blue-900 dark:text-blue-100 truncate">
          {message}
        </div>
      </div>
    </div>
  )
}
