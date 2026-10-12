/**
 * What the badge adds to a Speaker View that is fed a bare video (decided
 * 2026-10-11), on top of the idle edit's own verdict: the wiring rule (one of
 * an edit and a video), the video-mode gate (R15: closed until Speaker View AND
 * Speaker Frames are priced, and then the only issue said), the transcript video mode requires (D3), a source no
 * wider than the target (D18, an issue), the low-resolution upscale (D10) and
 * the centre-of-frame note (D9), the last two as warnings. Every sentence is
 * the shared rule's (`@nodaro/render-rules`), the one the run and the route
 * refuse with, so the badge never passes what the run refuses.
 *
 * Sizes are what the producer saved; the real ones are measured by the server
 * at the run (D16), where the same rules apply again.
 */
import {
  SPEAKER_VIEW_VIDEO_DEFAULT_ASPECT,
  speakerViewFramingNote,
  speakerViewInputIssue,
  speakerViewSourceAspectRefusal,
  speakerViewSourceUpscale,
  speakerViewVideoModeRefusal,
  speakerViewVideoTranscriptIssue,
} from "@nodaro/render-rules"
import { isEdlTargetAspect, transcriptSpeakerLabels } from "@nodaro/shared"
import type { EdlValidity } from "@/lib/edl-validity"
import {
  speakerViewTracksWired,
  speakerViewTranscript,
  speakerViewVideoSize,
  speakerViewVideoWired,
  speakerViewWiring,
} from "@/lib/speaker-view-context"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export { speakerViewWiring }

export interface SpeakerViewVideoExtras {
  readonly issues: readonly string[]
  readonly warnings: readonly string[]
}

/** The issues and warnings a wired video adds; null when none is wired. */
export function speakerViewVideoExtras(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): SpeakerViewVideoExtras | null {
  if (!speakerViewVideoWired(nodeId, edges)) return null
  const data = (nodes.find((n) => n.id === nodeId)?.data ?? {}) as Record<string, unknown>
  const issues: string[] = []
  const warnings: string[] = []

  const wiring = speakerViewInputIssue(speakerViewWiring(nodeId, nodes, edges))
  if (wiring) issues.push(wiring.message)
  // Video mode is closed until Speaker Frames is priced too (R15): that is the
  // one thing to say, and nothing below can be acted on until then.
  const closed = speakerViewVideoModeRefusal()
  if (closed) {
    issues.push(closed.message)
    return { issues, warnings }
  }

  const transcript = speakerViewTranscript(nodeId, nodes, edges)
  const missing = speakerViewVideoTranscriptIssue(transcript)
  if (missing) issues.push(missing.message)

  const aspect = isEdlTargetAspect(data.targetAspect) ? data.targetAspect : SPEAKER_VIEW_VIDEO_DEFAULT_ASPECT
  const size = speakerViewVideoSize(nodeId, nodes, edges)
  if (size) {
    const refusal = speakerViewSourceAspectRefusal(size, aspect)
    if (refusal) issues.push(refusal.message)
    else {
      const upscale = speakerViewSourceUpscale(size, aspect)
      if (upscale?.message) warnings.push(upscale.message)
    }
  }

  const note = speakerViewFramingNote({
    speakers: missing ? [] : transcriptSpeakerLabels(transcript),
    tracksWired: speakerViewTracksWired(nodeId, edges),
    speakerRegions: data.speakerRegions,
    defaultRegionKeys: data.defaultRegionKeys,
  })
  if (note) warnings.push(note)
  return { issues, warnings }
}

/** The edit's verdict with the video's issues first and its warnings last. */
export function withSpeakerViewVideoExtras(verdict: EdlValidity | null, extras: SpeakerViewVideoExtras | null): EdlValidity | null {
  if (!extras) return verdict
  const base: EdlValidity = verdict ?? { kind: "edl", ok: true, issues: [], warnings: [] }
  return {
    ...base,
    ok: base.ok && extras.issues.length === 0,
    issues: [...extras.issues, ...base.issues],
    warnings: [...base.warnings, ...extras.warnings],
  }
}
