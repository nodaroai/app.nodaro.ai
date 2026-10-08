/**
 * What the Speaker View panel's INPUT section says about the edit wired into
 * the node (U2b, SV24): the facts behind each state, as pure functions so the
 * panel only chooses words. The counts and refusals are the rule's own
 * (`@nodaro/render-rules`); this file reads them off what the canvas holds.
 */
import {
  findSpeakerViewIssues,
  speakerViewContext,
  speakerViewWireSettings,
  type SpeakerViewContext,
  type SpeakerViewNodeSettings,
} from "@nodaro/render-rules"
import { transcriptSpeakerLabels } from "@nodaro/shared"
import { nodeTypeDefaultLabel } from "@/components/editor/config-panel-label"
import { speakerViewEdits, speakerViewEdlProducer } from "@/lib/speaker-view-context"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export type SpeakerViewInputState =
  /** No edit is wired and the node holds none of its own. */
  | { readonly kind: "no-edit" }
  /** An edit IS wired, but its producer has no saved output yet. */
  | { readonly kind: "not-run"; readonly producer: string }
  | { readonly kind: "ready" }

export function speakerViewInputState(nodeId: string, nodes: ReadonlyArray<WorkflowNode>, edges: ReadonlyArray<WorkflowEdge>): SpeakerViewInputState {
  if (speakerViewEdits(nodeId, nodes, edges).length > 0) return { kind: "ready" }
  const producer = speakerViewEdlProducer(nodeId, nodes, edges)
  if (!producer) return { kind: "no-edit" }
  const label = (producer.data as { label?: unknown } | undefined)?.label
  return { kind: "not-run", producer: typeof label === "string" && label.trim() ? label : nodeTypeDefaultLabel(String(producer.type)) }
}

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

/** The speakers the edits name on their segments, in order of first appearance. */
function namedSpeakers(edits: readonly unknown[]): string[] {
  const seen = new Set<string>()
  for (const raw of edits) {
    const segments = (parse(raw) as { segments?: unknown } | null | undefined)?.segments
    if (!Array.isArray(segments)) continue
    for (const s of segments) {
      const speaker = (s as { speaker?: unknown } | null)?.speaker
      if (typeof speaker === "string" && speaker) seen.add(speaker)
    }
  }
  return [...seen]
}

/**
 * The wired transcript's speaker labels against the names the edit gives its
 * speakers: Camera Switch renames them (Host, Guest), so a transcript straight
 * from Transcribe (speaker_0, speaker_1) does not match. Mismatched when the
 * edit names a speaker the transcript does not; the transcript naming MORE
 * speakers than the edit shows is fine. `null` when there is nothing to compare.
 */
export function speakerViewLabelMismatch(edits: readonly unknown[], transcript: unknown): { readonly labels: string[]; readonly names: string[] } | null {
  if (transcript === undefined || transcript === null || transcript === "") return null
  const labels = transcriptSpeakerLabels(transcript)
  const names = namedSpeakers(edits)
  if (labels.length === 0 || names.length === 0) return null
  return names.every((n) => labels.includes(n)) ? null : { labels, names }
}

export type SpeakerViewInputProblem = "wire-camera-switch" | "no-transcript" | "no-speaker-labels"

const INPUT_PROBLEMS: readonly string[] = ["wire-camera-switch", "no-transcript", "no-speaker-labels"]

/** Why the plugin cannot read speakers from this input (SV24), as the rule's
 *  own code, for the first clip it applies to. */
export function speakerViewInputProblem(edits: readonly unknown[], transcript: unknown, settings: Readonly<Record<string, unknown>>): SpeakerViewInputProblem | null {
  for (const edl of edits) {
    const parsed = parse(edl)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
    const wire = speakerViewWireSettings(settings as SpeakerViewNodeSettings, speakerViewContext(parsed, transcript))
    const found = findSpeakerViewIssues({ edl: parsed, transcript, settings: wire }).issues.find((i) => INPUT_PROBLEMS.includes(i.code))
    if (found) return found.code as SpeakerViewInputProblem
  }
  return null
}

/**
 * How many of the edit's speaker changes a Pan and a Crossfade apply to
 * (SV5, SV21 c): a Pan only where both speakers are on one camera, a
 * Crossfade only where the master clock jumps. Summed over a clip pack.
 * `null` when the changes cannot be counted from the edit (no segment names a
 * speaker — the plugin names them from the transcript) or there are none.
 */
export function speakerViewChangeCounts(ctx: SpeakerViewContext | undefined): { readonly changes: number; readonly pan: number; readonly crossfade: number } | null {
  if (!ctx || !ctx.clips.every((c) => c.changesKnown)) return null
  const changes = ctx.clips.reduce((n, c) => n + c.changes, 0)
  if (changes === 0) return null
  return {
    changes,
    pan: ctx.clips.reduce((n, c) => n + c.sameCameraChanges, 0),
    crossfade: ctx.clips.reduce((n, c) => n + c.jumpChanges, 0),
  }
}
