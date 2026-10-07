/**
 * What Speaker View's pickers and normalizer need to know about the edit wired
 * into it (SV10, SV23, SV3): how many speakers are on screen, how many cameras
 * there are, and how many speaker changes stay inside one picture (the only
 * ones a Pan can sweep). ONE pure function turns the saved upstream output
 * into it, so the panel, the quick strip, the badge and the payload builder
 * all read the same numbers.
 *
 * In clips mode Camera Switch's saved output is a BATCH of EDLs (SV23): each
 * clip is one entry, and a setting is offered only when it suits every clip.
 */
import { transcriptSpeakerLabels, isEdlTargetAspect, type Edl, type EdlTargetAspect } from "@nodaro/shared"
import { speakerViewSlotSet } from "./speaker-view-layout.js"

/** One clip's facts, read off its EDL as given. */
export interface SpeakerViewClip {
  /** The speakers on screen (SV3): the edit's, else the transcript's labels. */
  readonly speakers: readonly string[]
  readonly speakerCount: number
  /** Video sources in the edit. */
  readonly cameras: number
  /** Segments that carry a multi-slot hint (Camera Switch's `layoutHints`). */
  readonly hinted: number
  /** Speaker changes between named neighbouring segments. */
  readonly changes: number
  /** Of those, the ones whose two segments show the same camera. */
  readonly sameCameraChanges: number
  /** False when no segment names a speaker: the plugin names them from the
   *  transcript, so the changes cannot be counted from the edit. */
  readonly changesKnown: boolean
  readonly targetAspect?: EdlTargetAspect
}

export interface SpeakerViewContext {
  /** One entry per clip (one for a plain edit). Never empty. */
  readonly clips: readonly SpeakerViewClip[]
  /** The first aspect an EDL names, if any. */
  readonly targetAspect?: EdlTargetAspect
}

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

const isEdl = (v: unknown): v is Edl => {
  const e = v as { sources?: unknown; segments?: unknown } | null
  return !!e && typeof e === "object" && Array.isArray(e.sources) && Array.isArray(e.segments) && e.segments.length > 0
}

function clipOf(edl: Edl, transcriptLabels: readonly string[]): SpeakerViewClip {
  const speakers = speakerViewSlotSet(edl, transcriptLabels)
  const named = edl.segments.filter((s) => typeof s.speaker === "string" && s.speaker)
  let changes = 0
  let sameCameraChanges = 0
  for (let i = 1; i < edl.segments.length; i++) {
    const a = edl.segments[i - 1]!
    const b = edl.segments[i]!
    if (!a.speaker || !b.speaker || a.speaker === b.speaker) continue
    changes++
    if (a.video && a.video === b.video) sameCameraChanges++
  }
  const aspect = edl.meta?.targetAspect
  return {
    speakers,
    speakerCount: speakers.length,
    cameras: edl.sources.filter((s) => s.kind === "video").length,
    hinted: edl.segments.filter((s) => Array.isArray(s.layout?.slots) && s.layout!.slots!.length > 1).length,
    changes,
    sameCameraChanges,
    changesKnown: named.length >= 2,
    ...(isEdlTargetAspect(aspect) ? { targetAspect: aspect } : {}),
  }
}

/**
 * The context of the upstream output. `edls` is what the wire carries: one
 * EDL (an object or its JSON string), or Camera Switch's clips-mode batch of
 * them. Entries that are not an EDL are skipped; with none left the result is
 * `undefined` — the edit is not known yet, and the pickers fall back to the
 * aspect-only rules. `transcript` is the wired transcript (an object or its
 * JSON string), read only for its speaker labels when the edit names none.
 */
export function speakerViewContext(edls: unknown, transcript?: unknown): SpeakerViewContext | undefined {
  const parsed = parse(edls)
  const list = (Array.isArray(parsed) ? parsed : [parsed]).map(parse).filter(isEdl)
  if (list.length === 0) return undefined
  const labels = transcript === undefined || transcript === null || transcript === "" ? [] : transcriptSpeakerLabels(transcript)
  const clips = list.map((edl) => clipOf(edl, labels))
  const targetAspect = clips.find((c) => c.targetAspect !== undefined)?.targetAspect
  return { clips, ...(targetAspect ? { targetAspect } : {}) }
}
