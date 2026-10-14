/**
 * Who is on screen in ONE edit once the node's layout is applied: each
 * camera of the edit, and on it every (camera, speaker) pair the drawn edit
 * shows, with where on the master clock it is first seen and every slot shape
 * it is drawn in. The region editor lists these pairs (one crop each), and its
 * default boxes are dealt over a camera's pairs in order of first appearance
 * (`speakerViewCameraSpeakers`) — which is also the order `autoRegions` deals
 * them in, so the panel and the run frame the same speaker with the same box.
 * Pure.
 */
import { normalizeTranscript, resolveEdlSegmentSlots, speakerTurns, transcriptSpeakerLabels, type Edl, type EdlTargetAspect } from "@nodaro/shared/edl"
import { layOutSpeakerView, speakerViewSlotSet } from "./speaker-view-layout.js"
import { resolveSpeakerViewAspect } from "./speaker-view-rule.js"
import { isWholeClipEdl } from "./whole-clip-edl.js"

/** A speaker's stretch on the master clock. */
export interface SpeakerViewTurn {
  readonly speaker: string
  readonly startMs: number
  readonly endMs: number
}

/** One slot shape a pair is drawn in. */
export interface SpeakerViewShowAs {
  readonly layout: string
  readonly slots: number
  readonly slotIndex: number
  readonly aspect: EdlTargetAspect
}

export interface SpeakerViewOnScreenPair {
  readonly source: string
  readonly speaker: string
  /** Where on the master clock the pair is first on screen. */
  readonly firstMs: number
  readonly showAs: readonly SpeakerViewShowAs[]
}

export interface SpeakerViewOnScreenCamera {
  readonly id: string
  readonly url: string
  readonly offsetMs?: number
}

export interface SpeakerViewOnScreen {
  /** The edit's video sources, in edit order. */
  readonly cameras: readonly SpeakerViewOnScreenCamera[]
  /** Every pair on screen, in the order the drawn edit first shows it. */
  readonly pairs: readonly SpeakerViewOnScreenPair[]
  /** The edit's turns (its named segments, else the transcript's), in edit order. */
  readonly turns: readonly SpeakerViewTurn[]
}

/** The settings the layout is drawn with, ALREADY normalized by the caller
 *  (`normalizeSpeakerViewData`), as the run sends them. */
export interface SpeakerViewOnScreenSettings {
  readonly layout?: unknown
  readonly targetAspect?: unknown
}

/** A pair's identity in the slot-shape list. */
export const speakerViewShowAsKey = (s: SpeakerViewShowAs): string => `${s.layout}|${s.slots}|${s.slotIndex}|${s.aspect}`

/** The edit's named segments as turns: neighbours with one speaker that meet
 *  on the master clock merge. */
function editTurns(edl: Edl): SpeakerViewTurn[] {
  const turns: SpeakerViewTurn[] = []
  for (const seg of edl.segments) {
    if (typeof seg.speaker !== "string" || !seg.speaker) continue
    const last = turns.at(-1)
    if (last && last.speaker === seg.speaker && last.endMs === seg.inMs) turns[turns.length - 1] = { ...last, endMs: seg.outMs }
    else turns.push({ speaker: seg.speaker, startMs: seg.inMs, endMs: seg.outMs })
  }
  return turns
}

/** The transcript's turns on the master clock: a turn runs until another
 *  speaker talks (no gap threshold). */
function transcriptTurns(raw: unknown, edl: Edl): SpeakerViewTurn[] {
  if (raw === undefined || raw === null || raw === "") return []
  let parsed: unknown = raw
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw) } catch { return [] }
  }
  const t = normalizeTranscript(parsed)
  if (!t.words.some((w) => typeof w.speaker === "string" && w.speaker)) return []
  const offset = edl.sources.find((s) => s.id === t.sourceId)?.offsetMs ?? 0
  return speakerTurns(t, { minTurnMs: 0, mergeGapMs: Number.POSITIVE_INFINITY }).map((turn) => ({
    speaker: turn.speaker,
    startMs: turn.startMs + offset,
    endMs: turn.endMs + offset,
  }))
}

/**
 * The cameras and on-screen pairs of `edl` laid out with `settings`. A segment
 * that names no one (a one-camera edit the renderer splits at the transcript's
 * turns) shows every speaker who talks during it.
 *
 * A bare video's whole-clip edit (`isWholeClipEdl`) shows EVERY transcript
 * speaker, first seen at their first speech: its one segment's length is the
 * measured clip on a run but a placeholder for the editor's idle edit, so who
 * is on screen must not depend on it — the run, the panel, the badge, the
 * review and the region editor then list and deal the same speakers.
 */
export function speakerViewOnScreen(edl: Edl, transcript: unknown, settings: SpeakerViewOnScreenSettings): SpeakerViewOnScreen {
  const labels = transcript === undefined || transcript === null || transcript === "" ? [] : transcriptSpeakerLabels(transcript)
  const aspect = resolveSpeakerViewAspect(settings.targetAspect, edl) as EdlTargetAspect
  const speakers = speakerViewSlotSet(edl, labels)
  const { drawn } = layOutSpeakerView(edl, { layout: typeof settings.layout === "string" ? settings.layout : "auto", aspect, speakers })

  const cameras: SpeakerViewOnScreenCamera[] = []
  for (const source of edl.sources) {
    if (source.kind !== "video" || cameras.some((c) => c.id === source.id)) continue
    cameras.push({ id: source.id, url: source.url, ...(typeof source.offsetMs === "number" ? { offsetMs: source.offsetMs } : {}) })
  }
  const named = edl.segments.some((s) => typeof s.speaker === "string" && s.speaker)
  const turns = named ? editTurns(edl) : transcriptTurns(transcript, edl)
  const wholeClip = isWholeClipEdl(edl)

  const pairs = new Map<string, { source: string; speaker: string; firstMs: number; showAs: Map<string, SpeakerViewShowAs> }>()
  const add = (source: string, speaker: string, atMs: number, showAs: SpeakerViewShowAs) => {
    if (!cameras.some((c) => c.id === source)) return
    const key = JSON.stringify([source, speaker])
    const pair = pairs.get(key) ?? { source, speaker, firstMs: atMs, showAs: new Map<string, SpeakerViewShowAs>() }
    pairs.set(key, { ...pair, firstMs: Math.min(pair.firstMs, atMs), showAs: pair.showAs.set(speakerViewShowAsKey(showAs), showAs) })
  }

  for (const seg of drawn.segments) {
    const slots = resolveEdlSegmentSlots(drawn, seg)
    const layout = slots.length > 1 ? (seg.layout?.mode ?? "single") : "single"
    slots.forEach((slot, slotIndex) => {
      const showAs: SpeakerViewShowAs = { layout, slots: slots.length, slotIndex: layout === "pip" ? slotIndex : 0, aspect }
      if (slot.speaker) {
        add(slot.source, slot.speaker, seg.inMs, showAs)
        return
      }
      if (named || slots.length !== 1) return
      for (const t of turns) {
        if (wholeClip || (t.endMs > seg.inMs && t.startMs < seg.outMs)) add(slot.source, t.speaker, Math.max(seg.inMs, t.startMs), showAs)
      }
    })
  }

  return {
    cameras,
    pairs: [...pairs.values()].map((p) => ({ source: p.source, speaker: p.speaker, firstMs: p.firstMs, showAs: [...p.showAs.values()] })),
    turns,
  }
}

/**
 * The speakers on screen on camera `cameraId`, in the order the default boxes
 * are dealt: by first appearance on the master clock (ties keep the order the
 * drawn edit first shows them). The region editor's `framingModel` sorts each
 * camera's pairs the same way.
 */
export function speakerViewCameraSpeakers(onScreen: SpeakerViewOnScreen, cameraId: string): string[] {
  return onScreen.pairs
    .filter((p) => p.source === cameraId)
    .sort((a, b) => a.firstMs - b.firstMs)
    .map((p) => p.speaker)
}
