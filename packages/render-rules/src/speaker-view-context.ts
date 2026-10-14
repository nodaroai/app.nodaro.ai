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
import {
  transcriptSpeakerLabels,
  isEdlTargetAspect,
  type Edl,
  type EdlTargetAspect,
  type SpeakerTrackSetDescriptor,
} from "@nodaro/shared/edl"
import { speakerViewSlotSet } from "./speaker-view-layout.js"
import { speakerViewTracksDescriptor } from "./speaker-view-tracks.js"
import { isWholeClipEdl } from "./whole-clip-edl.js"

/** One clip's facts, read off its EDL as given. */
export interface SpeakerViewClip {
  /** The speakers on screen (SV3): the edit's, else the transcript's labels. */
  readonly speakers: readonly string[]
  readonly speakerCount: number
  /** Video sources in the edit. */
  readonly cameras: number
  /** The ids of the edit's video sources, in edit order (`autoRegions` frames
   *  the only one). */
  readonly cameraIds: readonly string[]
  /** Segments that carry a multi-slot hint (Camera Switch's `layoutHints`). */
  readonly hinted: number
  /** Speaker changes between named neighbouring segments. */
  readonly changes: number
  /** Of those, the ones whose two segments show the same camera AND where the
   *  plugin writes a switch (the incoming segment is free, see `isFreeBoundary`). */
  readonly sameCameraChanges: number
  /** Of those, the ones across a jump of the master clock (the next segment
   *  starts later than the last ended) AND where the plugin writes a switch:
   *  the only ones a crossfade is written at (SV21 c) — it would blend
   *  contiguous speech with itself otherwise. An UPPER BOUND: the context does
   *  not know the node's duration, so a crossfade whose overlap exceeds
   *  0.9 x min(adjacent segment) (which the plugin drops) is still counted. */
  readonly jumpChanges: number
  /** False when no segment names a speaker: the plugin names them from the
   *  transcript, so the changes cannot be counted from the edit. */
  readonly changesKnown: boolean
  /** True when the edit is the whole-clip edit of a bare video (`isWholeClipEdl`):
   *  the node was fed a Video, not an Edit Plan's edit. */
  readonly wholeClip: boolean
  readonly targetAspect?: EdlTargetAspect
  /** The clip's edit as given, for the rules that lay it out with the node's
   *  settings (`autoRegions` deals its boxes over who is on screen). */
  readonly edl: Edl
}

export interface SpeakerViewContext {
  /** One entry per clip (one for a plain edit). Never empty. */
  readonly clips: readonly SpeakerViewClip[]
  /** The first aspect an EDL names, if any. */
  readonly targetAspect?: EdlTargetAspect
  /** The transcript the context was read with (as given), if any. */
  readonly transcript?: unknown
  /** True when this edit is ONE clip of several the node runs over — a row of
   *  a list (a Camera Switch clip pack, an Edit Plan's clips). The run judges
   *  each row on its own, so only the caller knows (`SpeakerViewContextOptions`). */
  readonly packClip?: true
  /** The face tracks wired in, with the app's labels (`SpeakerViewContextOptions.tracks`);
   *  absent when none are. A speaker a track names is followed by it, so the
   *  automatic boxes leave them out (decided 2026-10-13: faces win). */
  readonly tracks?: SpeakerTrackSetDescriptor
}

export interface SpeakerViewContextOptions {
  /** The edit is one row of a list the node runs over (several clips). */
  readonly packClip?: boolean
  /**
   * The face tracks as a run sends them (`SpeakerViewTracksResolved.tracks`:
   * Speaker Frames' descriptor with the app's labels), when a `tracks` wire is
   * there. Every caller that builds the route's settings from this context
   * (`speakerViewWireSettings`) and stamps or compares its render basis passes
   * them: the automatic boxes a run sends depend on who is tracked. A value
   * that holds no descriptor is ignored.
   */
  readonly tracks?: unknown
}

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

const isEdl = (v: unknown): v is Edl => {
  const e = v as { sources?: unknown; segments?: unknown } | null
  return !!e && typeof e === "object" && Array.isArray(e.sources) && Array.isArray(e.segments) && e.segments.length > 0
}

/**
 * Does the plugin write the node's switch at the boundary INTO this segment?
 * Only where the boundary has no transition of its own: no `layout.transition`
 * and no `segment.transition`, or a bare `{ type: "cut" }`. Edit Plan's
 * discontinuous boundaries often already carry `transition: crossfade`; those
 * are rendered as the edit says, so neither a Pan nor a Crossfade applies there.
 */
function isFreeBoundary(seg: Edl["segments"][number]): boolean {
  return !seg.layout?.transition && (!seg.transition || seg.transition.type === "cut")
}

function clipOf(edl: Edl, transcriptLabels: readonly string[]): SpeakerViewClip {
  const speakers = speakerViewSlotSet(edl, transcriptLabels)
  const named = edl.segments.filter((s) => typeof s.speaker === "string" && s.speaker)
  let changes = 0
  let sameCameraChanges = 0
  let jumpChanges = 0
  for (let i = 1; i < edl.segments.length; i++) {
    const a = edl.segments[i - 1]!
    const b = edl.segments[i]!
    if (!a.speaker || !b.speaker || a.speaker === b.speaker) continue
    changes++
    if (!isFreeBoundary(b)) continue
    if (a.video && a.video === b.video) sameCameraChanges++
    if (b.inMs !== a.outMs) jumpChanges++
  }
  const aspect = edl.meta?.targetAspect
  return {
    speakers,
    speakerCount: speakers.length,
    cameras: edl.sources.filter((s) => s.kind === "video").length,
    cameraIds: edl.sources.filter((s) => s.kind === "video").map((s) => s.id),
    hinted: edl.segments.filter((s) => Array.isArray(s.layout?.slots) && s.layout!.slots!.length > 1).length,
    changes,
    sameCameraChanges,
    jumpChanges,
    changesKnown: named.length >= 2,
    wholeClip: isWholeClipEdl(edl),
    ...(isEdlTargetAspect(aspect) ? { targetAspect: aspect } : {}),
    edl,
  }
}

/**
 * The context of the upstream output. `edls` is what the wire carries: one
 * EDL (an object or its JSON string), or Camera Switch's clips-mode batch of
 * them. Entries that are not an EDL are skipped; with none left the result is
 * `undefined` — the edit is not known yet, and the pickers fall back to the
 * aspect-only rules. `transcript` is the wired transcript (an object or its
 * JSON string), read for its speaker labels when the edit names none.
 * `options.packClip`: the edit is one row of a list the node runs over.
 */
export function speakerViewContext(edls: unknown, transcript?: unknown, options: SpeakerViewContextOptions = {}): SpeakerViewContext | undefined {
  const parsed = parse(edls)
  const list = (Array.isArray(parsed) ? parsed : [parsed]).map(parse).filter(isEdl)
  if (list.length === 0) return undefined
  const given = !(transcript === undefined || transcript === null || transcript === "")
  const labels = given ? transcriptSpeakerLabels(transcript) : []
  const clips = list.map((edl) => clipOf(edl, labels))
  const targetAspect = clips.find((c) => c.targetAspect !== undefined)?.targetAspect
  const tracks = speakerViewTracksDescriptor(options.tracks)
  return {
    clips,
    ...(targetAspect ? { targetAspect } : {}),
    ...(given ? { transcript } : {}),
    ...(options.packClip ? { packClip: true as const } : {}),
    ...(tracks ? { tracks } : {}),
  }
}
