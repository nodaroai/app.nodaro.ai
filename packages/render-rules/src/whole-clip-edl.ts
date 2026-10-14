/**
 * The whole-clip EDL (Speaker View's Video input, decided 2026-10-11): a bare
 * video and its measured length become the one-source, one-segment edit the
 * renderer already understands, so the editor's badge, the rule's checks, the
 * self-host route and the cloud render all read ONE normal edit. The plugin's
 * contract (`SpeakerViewJobPayload.edl`) is unchanged; the synthesis lives in
 * the app and is built here and nowhere else.
 *
 * Pure. It never looks a duration up: the length is resolved ONCE upstream of
 * both engines (a server-side measurement of the real stream end) and handed
 * in, so the two engines cannot build different edits, price them differently
 * or render different clips.
 */
import { isEdlTargetAspect, type Edl, type EdlTargetAspect } from "@nodaro/shared/edl"
import { SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID } from "./speaker-frames.js"
import { SPEAKER_VIEW_VIDEO_DEFAULT_ASPECT } from "./speaker-view-settings.js"

export interface WholeClipEdlInput {
  /** The clip's URL, exactly as the Speaker Frames job behind a `tracks` wire read it. */
  readonly url: string
  /** The clip's real length in milliseconds (the stream's end, not a declared duration). */
  readonly durationMs: number
  /**
   * The transcript's speaker labels. Written onto the source only when there
   * are two or more DISTINCT ones: with exactly one, the renderer's
   * single-face exception would be allowed before its co-presence check, and
   * the largest face would be followed with no note even when two people are
   * on screen (a diarization collapse on a short two-host clip).
   */
  readonly speakers?: readonly string[]
  /** The aspect to draw at; the video-mode default (9:16) when absent or unknown. */
  readonly targetAspect?: EdlTargetAspect
}

export type WholeClipEdlResult = { readonly edl: Edl } | { readonly problem: string }

/**
 * The labels as the transcript spells them: distinct, in the order given,
 * VERBATIM. `transcriptSpeakerLabels` returns `word.speaker` untouched, and the
 * renderer matches a source's labels against the transcript's words by exact
 * string, so a label tidied here would stop matching downstream (" A" and "A"
 * are two speakers there). Only blank and non-string entries are dropped.
 */
function distinctLabels(raw: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const label of raw) {
    if (typeof label !== "string") continue
    if (label.trim() && !out.includes(label)) out.push(label)
  }
  return out
}

/**
 * The edit for a bare video: one video source named like a bare video in
 * Speaker Frames (so the tracks' file-and-offset check reads the same id), one
 * segment over the whole clip, no `audio` and no role (the clip's own sound
 * plays untouched), and the target aspect.
 */
export function wholeClipEdl(input: WholeClipEdlInput): WholeClipEdlResult {
  const url = typeof input.url === "string" ? input.url.trim() : ""
  if (!url) return { problem: "Speaker View needs the video's address to cut it." }
  const d = input.durationMs
  if (typeof d !== "number" || !Number.isFinite(d) || Math.floor(d) < 1) {
    return { problem: "Speaker View could not tell how long this video is, so it cannot cut it. Check the video plays, then run again." }
  }
  // Cut DOWN to a whole millisecond: an outMs past the stream's end is billed
  // per output minute and read past the last frame.
  const outMs = Math.floor(d)
  const labels = distinctLabels(input.speakers)
  const targetAspect = isEdlTargetAspect(input.targetAspect) ? input.targetAspect : SPEAKER_VIEW_VIDEO_DEFAULT_ASPECT
  return {
    edl: {
      version: 1,
      clock: "master",
      sources: [{
        id: SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID,
        kind: "video",
        url,
        ...(labels.length >= 2 ? { speakers: labels } : {}),
      }],
      segments: [{ id: "seg-0", inMs: 0, outMs, video: SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID }],
      meta: { targetAspect },
    },
  }
}

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

/**
 * Whether `raw` (an edit, or its JSON) has the shape `wholeClipEdl` builds: a
 * master-clock edit of ONE bare video source and ONE unnamed segment from 0.
 * It is how video mode is known from the edit alone, with no side channel for
 * a new surface to forget. An edit with a named speaker, a second source or
 * segment, a role, an offset, a crop or a layout is an ordinary edit.
 */
export function isWholeClipEdl(raw: unknown): boolean {
  const e = parse(raw) as Partial<Edl> | null | undefined
  if (!e || typeof e !== "object" || Array.isArray(e)) return false
  if (e.clock !== "master" || !Array.isArray(e.sources) || e.sources.length !== 1 || !Array.isArray(e.segments) || e.segments.length !== 1) return false
  const src = e.sources[0]!
  const seg = e.segments[0]!
  if (!src || src.id !== SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID || src.kind !== "video" || typeof src.url !== "string" || !src.url) return false
  if (src.role !== undefined || src.region !== undefined || (src.offsetMs !== undefined && src.offsetMs !== 0)) return false
  if (!seg || seg.video !== SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID || seg.inMs !== 0 || typeof seg.outMs !== "number" || !(seg.outMs > 0)) return false
  return seg.speaker === undefined && seg.audio === undefined && seg.region === undefined && seg.layout === undefined
}
