/**
 * Speaker View's Video input as pure rules (decided 2026-10-11): the one place
 * the editor's badge, the canvas run, the server run and the REST route learn
 * what a bare video needs before it can be cut.
 *
 *  - exactly one of `edl` and `video` is wired;
 *  - the transcript is REQUIRED (D3): without speaker labels there are no
 *    turns to follow, so the answer is "wire Transcribe with speaker detection"
 *    — asked BEFORE the clip is measured, so a refusal costs nothing;
 *  - the edit the run cuts is `wholeClipEdl` (D8) over the clip's measured
 *    length, with the transcript's labels written only when there are two or
 *    more (D15);
 *  - the clip's shape: a source no wider than the target is refused (D18), a
 *    low-resolution one renders with a warning naming the upscale (D10);
 *  - what the idle canvas judges is the same edit over a placeholder length,
 *    because the length is measured once, at the run, by the server (D16) —
 *    the badge never invents a second number;
 *  - nothing to frame with (no face tracks, no drawn box) is a non-blocking
 *    note (D9): the centre of the frame is used.
 *
 * Pure; never throws.
 */
import { isEdlTargetAspect, transcriptSpeakerLabels, type Edl, type EdlTargetAspect } from "@nodaro/shared"
import { speakerViewSourceAspectRefusal, speakerViewSourceUpscale, type SpeakerViewSize } from "./speaker-view-source-fit.js"
import { SPEAKER_VIEW_VIDEO_DEFAULT_ASPECT } from "./speaker-view-settings.js"
import { SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID } from "./speaker-frames.js"
import { drawnSpeakerRegions } from "./speaker-view-tracks.js"
import { wholeClipEdl } from "./whole-clip-edl.js"
import { SPEAKER_VIEW_VIDEO_NOT_LIVE_REASON, speakerViewVideoModeLive, type SpeakerViewVideoGateFlags } from "./speaker-view-video-gate.js"

export type SpeakerViewInputIssueCode = "both" | "neither"

export interface SpeakerViewInputIssue {
  readonly code: SpeakerViewInputIssueCode
  readonly message: string
}

export const SPEAKER_VIEW_BOTH_INPUTS_MESSAGE = "Connect an edit or a video to Speaker View, not both."
export const SPEAKER_VIEW_NO_INPUT_MESSAGE = "Connect an edit (Edit Plan's or Camera Switch's EDL) to the EDL input, or a video to the Video input."

/** Exactly one of the two inputs: the rule Speaker Frames keeps for `edl` and `video`. */
export function speakerViewInputIssue(wired: { readonly hasEdl: boolean; readonly hasVideo: boolean }): SpeakerViewInputIssue | null {
  if (wired.hasEdl && wired.hasVideo) return { code: "both", message: SPEAKER_VIEW_BOTH_INPUTS_MESSAGE }
  if (!wired.hasEdl && !wired.hasVideo) return { code: "neither", message: SPEAKER_VIEW_NO_INPUT_MESSAGE }
  return null
}

export type SpeakerViewVideoTranscriptCode = "no-transcript" | "no-speaker-labels"

export const SPEAKER_VIEW_VIDEO_NO_TRANSCRIPT_MESSAGE =
  "Wire a Transcribe node (with speaker detection) — Speaker View needs the transcript to know who speaks when."
export const SPEAKER_VIEW_VIDEO_NO_LABELS_MESSAGE =
  "This transcript has no speaker labels. Turn on speaker detection in Transcribe."

const blank = (v: unknown) => v === undefined || v === null || v === ""

const aspectOf = (requested: unknown): EdlTargetAspect => (isEdlTargetAspect(requested) ? requested : SPEAKER_VIEW_VIDEO_DEFAULT_ASPECT)

const sizeOf = (clip: { readonly width?: number; readonly height?: number }): SpeakerViewSize | undefined =>
  typeof clip.width === "number" && typeof clip.height === "number" && clip.width > 0 && clip.height > 0
    ? { width: clip.width, height: clip.height }
    : undefined

/** The transcript video mode requires (D3): present, and naming at least one speaker. */
export function speakerViewVideoTranscriptIssue(transcript: unknown): { readonly code: SpeakerViewVideoTranscriptCode; readonly message: string } | null {
  if (blank(transcript)) return { code: "no-transcript", message: SPEAKER_VIEW_VIDEO_NO_TRANSCRIPT_MESSAGE }
  if (transcriptSpeakerLabels(transcript).length === 0) return { code: "no-speaker-labels", message: SPEAKER_VIEW_VIDEO_NO_LABELS_MESSAGE }
  return null
}

/**
 * Whether the measurement saw a face in the frames it sampled (decided
 * 2026-10-12, R2): `none` only when it looked and found none, `unknown` when it
 * could not look (no detector on this host, a sampling failure). A rule that
 * refuses on faces refuses on `none` alone.
 */
export type SpeakerViewClipFaces = "present" | "none" | "unknown"

/** What the server measured about a clip (D16): its real stream end and, when it could read them, its pixels and whether it shows faces. */
export interface SpeakerViewClipFacts {
  readonly durationMs: number
  readonly width?: number
  readonly height?: number
  readonly faces?: SpeakerViewClipFaces
}

export type SpeakerViewVideoEditCode = SpeakerViewVideoTranscriptCode | "bad-clip" | "source-not-wider" | "no-faces"

export const SPEAKER_VIEW_NO_FACES_MESSAGE =
  "No faces were found in this video, so there is nobody for Speaker View to follow. Use a video where the speakers' faces can be seen."

export interface SpeakerViewClipRefusal {
  readonly code: "source-not-wider" | "no-faces"
  readonly message: string
}

/**
 * What the clip's own facts refuse, in one place for the node's dispatch, the
 * run-start check and the self-host route: a source already as narrow as the
 * target (D18) and, only for a node that opts in (decided 2026-10-12, R2), a
 * clip the detector looked at and found no face in. Unknown facts never refuse.
 */
export function speakerViewClipRefusal(input: {
  readonly clip: SpeakerViewClipFacts
  readonly targetAspect?: unknown
  readonly requireFaces?: boolean
}): SpeakerViewClipRefusal | null {
  const size = sizeOf(input.clip)
  if (size) {
    const refusal = speakerViewSourceAspectRefusal(size, aspectOf(input.targetAspect))
    if (refusal) return { code: refusal.code, message: refusal.message }
  }
  if (input.requireFaces === true && input.clip.faces === "none") return { code: "no-faces", message: SPEAKER_VIEW_NO_FACES_MESSAGE }
  return null
}

export type SpeakerViewVideoEditResult =
  | { readonly ok: true; readonly edl: Edl; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: SpeakerViewVideoEditCode; readonly message: string }


export interface SpeakerViewVideoEditInput {
  readonly url: string
  readonly clip: SpeakerViewClipFacts
  readonly transcript: unknown
  /** The node's own aspect; the video-mode default (9:16) when unset or unknown. */
  readonly targetAspect?: unknown
  /** The node asks for a clip with a face in it (decided 2026-10-12, R2). */
  readonly requireFaces?: boolean
}

/**
 * The edit a run cuts and the warnings that go with it, or why the run cannot
 * go ahead. Both engines and the self-host route call exactly this, with the
 * clip facts the one server measurement returned.
 */
export function speakerViewVideoEdit(input: SpeakerViewVideoEditInput): SpeakerViewVideoEditResult {
  const missing = speakerViewVideoTranscriptIssue(input.transcript)
  if (missing) return { ok: false, ...missing }
  const aspect = aspectOf(input.targetAspect)
  const size = sizeOf(input.clip)
  const refusal = speakerViewClipRefusal({ clip: input.clip, targetAspect: aspect, requireFaces: input.requireFaces })
  if (refusal) return { ok: false, code: refusal.code, message: refusal.message }
  const built = wholeClipEdl({
    url: input.url,
    durationMs: input.clip.durationMs,
    speakers: transcriptSpeakerLabels(input.transcript),
    targetAspect: aspect,
  })
  if ("problem" in built) return { ok: false, code: "bad-clip", message: built.problem }
  const upscale = size ? speakerViewSourceUpscale(size, aspect) : undefined
  return { ok: true, edl: built.edl, warnings: upscale?.message ? [upscale.message] : [] }
}

/** A length only the idle canvas uses: positive, and nobody's duration. */
const IDLE_CLIP_MS = 1000
/**
 * The edit the idle canvas (badge, panel, region editor) reads for a wired
 * video: the same shape the run builds, over a placeholder length, because
 * the real length is measured once by the server at the run (D16). Anything
 * that depends on the length (the 180-minute cap) is judged at the run.
 *
 * It needs the video's REAL address, and answers `undefined` without one: a
 * stand-in address would travel on as a source the region editor, a thumbnail
 * or a fetch takes for a file (decided 2026-10-12). A caller with no address
 * yet has no edit to read: its producer has not run.
 */
export function speakerViewIdleEdit(input: { readonly url?: string; readonly transcript?: unknown; readonly targetAspect?: unknown }): Edl | undefined {
  const url = typeof input.url === "string" ? input.url.trim() : ""
  if (!url) return undefined
  const built = wholeClipEdl({
    url,
    durationMs: IDLE_CLIP_MS,
    speakers: blank(input.transcript) ? [] : transcriptSpeakerLabels(input.transcript),
    targetAspect: aspectOf(input.targetAspect),
  })
  if ("problem" in built) throw new Error(`speakerViewIdleEdit: ${built.problem}`)
  return built.edl
}

export interface SpeakerViewFramingNoteInput {
  readonly speakers: readonly string[]
  /** Whether anything is wired into `tracks`: Speaker Frames' own notes speak then. */
  readonly tracksWired: boolean
  readonly speakerRegions: unknown
  readonly defaultRegionKeys: unknown
}

/**
 * D9, non-blocking: with no face tracks and no box drawn for a speaker, the
 * renderer uses the centre of the frame for them. Default thirds the region
 * editor pre-fills do not count until saved as drawn (`drawnSpeakerRegions`).
 * Null when there is nothing to say.
 */
export function speakerViewFramingNote(input: SpeakerViewFramingNoteInput): string | null {
  if (input.tracksWired || input.speakers.length === 0) return null
  const drawn = new Set(
    drawnSpeakerRegions(input.speakerRegions, input.defaultRegionKeys)
      .filter((r) => r.source === SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID)
      .map((r) => r.speaker),
  )
  const unframed = input.speakers.filter((s) => !drawn.has(s))
  if (unframed.length === 0) return null
  return `No framing set for ${unframed.join(", ")}: the centre of the frame is used.`
}

export interface SpeakerViewVideoRunRefusal {
  readonly nodeIds: readonly string[]
  readonly message: string
}

type RunNode = { readonly id: string; readonly type?: unknown; readonly data?: unknown }
type RunEdge = { readonly source: string; readonly target: string; readonly targetHandle?: string | null }

const dataOf = (n: RunNode | undefined): Record<string, unknown> =>
  n?.data && typeof n.data === "object" && !Array.isArray(n.data) ? (n.data as Record<string, unknown>) : {}

/** The name a person gave the node, else the node type's own name: a message never shows the raw id. */
export function speakerViewNodeLabel(node: RunNode | undefined): string {
  const label = dataOf(node).label
  return typeof label === "string" && label.trim() ? label.trim() : "Speaker View"
}
const labelOf = speakerViewNodeLabel

/** The pixels an upload node saved, when the video comes straight from one. */
function savedUploadSize(source: RunNode | undefined): SpeakerViewSize | undefined {
  if (source?.type !== "upload-video") return undefined
  const m = dataOf(source).metadata as { width?: unknown; height?: unknown } | undefined
  return typeof m?.width === "number" && typeof m?.height === "number" && m.width > 0 && m.height > 0
    ? { width: m.width, height: m.height }
    : undefined
}

/**
 * The refusals of Speaker View's Video input that are known from the graph
 * alone, asked at RUN START (like the not-priced gate) so Transcribe and every
 * other paid node upstream never charge for a run that cannot succeed:
 * an edit and a video wired together, video mode not live yet (R15: Speaker
 * View AND Speaker Frames priced), no transcript wired, and (D18) a video
 * straight from an Upload whose saved size is already as narrow as the target.
 * A source that has not run has no size yet; the node's own dispatch judges
 * it from the measurement (a backstop, not a substitute).
 *
 * `runNodes` are the nodes the run will execute; `allNodes` and `edges` the
 * whole graph (the source of a wire may sit outside a partial run).
 */
export function speakerViewVideoRunRefusal(
  runNodes: ReadonlyArray<RunNode>,
  allNodes: ReadonlyArray<RunNode>,
  edges: ReadonlyArray<RunEdge>,
  /** The price flags the video-mode gate reads; none = the real ones. */
  gate: SpeakerViewVideoGateFlags = {},
): SpeakerViewVideoRunRefusal | null {
  const live = speakerViewVideoModeLive(gate)
  const found: Array<{ id: string; label: string; reason: string }> = []
  for (const node of runNodes) {
    if (node.type !== "speaker-view" || dataOf(node).skipped === true) continue
    const data = dataOf(node)
    const into = (handle: string) => edges.filter((e) => e.target === node.id && e.targetHandle === handle)
    const video = into("video").at(-1)
    if (!video) continue
    const wired = speakerViewInputIssue({ hasEdl: into("edl").length > 0 || !blank(data.edl), hasVideo: true })
    if (wired) {
      found.push({ id: node.id, label: labelOf(node), reason: wired.message })
      continue
    }
    // Video mode is closed until Speaker Frames is priced too (R15).
    if (!live) {
      found.push({ id: node.id, label: labelOf(node), reason: SPEAKER_VIEW_VIDEO_NOT_LIVE_REASON })
      continue
    }
    if (into("transcript").length === 0 && blank(data.transcript)) {
      found.push({ id: node.id, label: labelOf(node), reason: SPEAKER_VIEW_VIDEO_NO_TRANSCRIPT_MESSAGE })
      continue
    }
    const size = savedUploadSize(allNodes.find((n) => n.id === video.source))
    const refusal = size ? speakerViewSourceAspectRefusal(size, aspectOf(data.targetAspect)) : null
    if (refusal) found.push({ id: node.id, label: labelOf(node), reason: refusal.message })
  }
  if (found.length === 0) return null
  return {
    nodeIds: found.map((f) => f.id),
    message: found.map((f) => `${f.reason} (Speaker View node "${f.label}").`).join(" ") + " The run did not start and nothing was charged.",
  }
}
