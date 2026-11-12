/**
 * The editor's side of the start-frame-only rule (`videoStartFrameOnlyProblem`,
 * `@nodaro/shared`): a video model that takes a start frame ONLY at some
 * resolution (Grok Imagine Video 1.5 at 1080p — decided 2026-11-12, refuse up
 * front). One module for every editor surface that reads it — the resolution
 * menus (the run strip), the panels' note, the Run-confirm estimate — so they
 * judge a node exactly as the editor's Run and the server do.
 */
import { videoStartFrameOnlyProblem, type VideoStartFrameOnlyProblem } from "@nodaro/shared/models"
import { getModel } from "@nodaro/shared/model-catalog"
import { referenceModalityForHandle } from "@nodaro/shared/workflow"
import { tx, type TFunction } from "@/lib/i18n"

/** The frames wired into a video node beside its start frame. */
export interface WiredVideoFrames {
  readonly hasEndFrame: boolean
  /** Edges into the node's Image References (a keyframes model's in-between frames). */
  readonly inBetweenFrameCount: number
}

/** What is wired into node `nodeId` beside its start frame, read off the edges. */
export function wiredVideoFrames(
  nodeId: string,
  edges: ReadonlyArray<{ readonly target: string; readonly targetHandle?: string | null }>,
): WiredVideoFrames {
  let hasEndFrame = false
  let inBetweenFrameCount = 0
  for (const e of edges) {
    if (e.target !== nodeId) continue
    if (e.targetHandle === "endFrame") hasEndFrame = true
    else if (referenceModalityForHandle(e.targetHandle) === "image") inBetweenFrameCount++
  }
  return { hasEndFrame, inBetweenFrameCount }
}

/**
 * The refusal a run of this node would meet for its resolution and wiring, or
 * undefined. The in-between frames are counted after the clip's cap (the shared
 * rule applies it), as the run sends them.
 */
export function nodeStartFrameOnlyProblem(
  provider: string | undefined,
  data: { readonly resolution?: unknown; readonly duration?: unknown },
  frames: WiredVideoFrames,
): VideoStartFrameOnlyProblem | undefined {
  return videoStartFrameOnlyProblem(provider, {
    resolution: typeof data.resolution === "string" ? data.resolution : undefined,
    durationSec: typeof data.duration === "number" || typeof data.duration === "string" ? data.duration : undefined,
    ...frames,
  })
}

/**
 * Whether a resolution menu offers `value` on this node. A tier that takes a
 * start frame only is offered while nothing but a start frame would be sent —
 * or while it is the node's saved value: that is kept and shown, never snapped
 * away, and the note and the Run say why the run is refused.
 */
export function offersVideoResolution(
  provider: string | undefined,
  value: string,
  data: { readonly resolution?: unknown; readonly duration?: unknown },
  frames: WiredVideoFrames,
): boolean {
  if (value === data.resolution) return true
  return nodeStartFrameOnlyProblem(provider, { ...data, resolution: value }, frames) === undefined
}

/**
 * The refusal's sentence in the interface language: `vidcfg.*` for the note
 * beside the setting, `nodeRun.*` (which adds that nothing was charged) for a
 * refused run. Its English is the server's `error.message` word for word.
 */
export function startFrameOnlyText(
  provider: string,
  problem: VideoStartFrameOnlyProblem,
  key: "vidcfg.startFrameOnlyResolution" | "nodeRun.startFrameOnlyResolution",
  t: TFunction = tx,
): string {
  return t(key, {
    model: getModel(provider)?.label ?? provider,
    resolution: problem.resolution,
    fallback: problem.fallbackResolution ?? "",
  })
}
