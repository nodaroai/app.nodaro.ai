/**
 * What the region editor lists (U4): the cameras of the edit, and on each the
 * (source, speaker) pairs that actually occur on screen once the node's
 * layout is applied — one crop per pair is what `speakerRegions` stores
 * (D20's `(source, speaker)` rung). Pure; reads the edit(s) the panel reads.
 *
 * Each pair also lists every slot shape it is drawn in ("Show as"), so the
 * dashed cover crop and the upscale chip can be shown for each, and the
 * master-clock turns the "Jump to" buttons and the row times come from.
 */
import {
  coerceSpeakerViewEdl,
  layOutSpeakerView,
  normalizeSpeakerViewData,
  resolveSpeakerViewAspect,
  speakerViewSlotSet,
  type SpeakerViewContext,
  type SpeakerViewNodeSettings,
} from "@nodaro/render-rules"
import { resolveEdlSegmentSlots, speakerTurns, transcriptSpeakerLabels, normalizeTranscript, type Edl } from "@nodaro/shared"
import type { Region, SpeakerViewAspect, Turn } from "./region-geometry"

/** One slot shape a pair is drawn in. */
export interface FramingShowAs {
  readonly layout: string
  readonly slots: number
  readonly slotIndex: number
  readonly aspect: SpeakerViewAspect
}

export interface FramingPair {
  readonly source: string
  readonly speaker: string
  /** Where on the master clock the pair is first on screen. */
  readonly firstMs: number
  readonly showAs: readonly FramingShowAs[]
}

export interface FramingCamera {
  readonly id: string
  readonly url: string
  readonly offsetMs?: number
  /** In order of first appearance. */
  readonly pairs: readonly FramingPair[]
}

export interface FramingModel {
  readonly cameras: readonly FramingCamera[]
  /** Master-clock turns, per speaker, in time order. */
  readonly turns: readonly Turn[]
}

export type StoredRegions = ReadonlyArray<{ source: string; speaker: string; region: Region }>

const keyOf = (s: FramingShowAs) => `${s.layout}|${s.slots}|${s.slotIndex}|${s.aspect}`

/** The edit's named segments as turns: neighbours with one speaker that meet
 *  on the master clock merge. */
function editTurns(edl: Edl): Turn[] {
  const turns: Turn[] = []
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
function transcriptTurns(raw: unknown, edl: Edl): Turn[] {
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
 * The cameras and pairs of every clip (one entry per clip; a plain edit is
 * one), laid out with the node's settings exactly as the run normalizes them.
 * A clip that is not an edit is skipped.
 */
export function framingModel(
  edits: readonly unknown[],
  transcript: unknown,
  settings: SpeakerViewNodeSettings,
  ctx: SpeakerViewContext | undefined,
): FramingModel {
  const data = normalizeSpeakerViewData(settings, ctx).data
  const labels = transcript === undefined || transcript === null || transcript === "" ? [] : transcriptSpeakerLabels(transcript)
  const cameras = new Map<string, { id: string; url: string; offsetMs?: number; pairs: Map<string, { source: string; speaker: string; firstMs: number; showAs: Map<string, FramingShowAs> }> }>()
  const turns: Turn[] = []

  for (const raw of edits) {
    const coerced = coerceSpeakerViewEdl(raw)
    if ("problem" in coerced) continue
    const edl = coerced.edl
    const aspect = resolveSpeakerViewAspect(data.targetAspect, edl) as SpeakerViewAspect
    const speakers = speakerViewSlotSet(edl, labels)
    const { drawn } = layOutSpeakerView(edl, { layout: typeof data.layout === "string" ? data.layout : "auto", aspect, speakers })
    for (const source of edl.sources) {
      if (source.kind !== "video" || cameras.has(source.id)) continue
      cameras.set(source.id, { id: source.id, url: source.url, ...(typeof source.offsetMs === "number" ? { offsetMs: source.offsetMs } : {}), pairs: new Map() })
    }
    const named = edl.segments.some((s) => typeof s.speaker === "string" && s.speaker)
    const clipTurns = named ? editTurns(edl) : transcriptTurns(transcript, edl)
    turns.push(...clipTurns)

    const add = (source: string, speaker: string, atMs: number, showAs: FramingShowAs) => {
      const camera = cameras.get(source)
      if (!camera) return
      const pair = camera.pairs.get(speaker) ?? { source, speaker, firstMs: atMs, showAs: new Map() }
      pair.firstMs = Math.min(pair.firstMs, atMs)
      pair.showAs.set(keyOf(showAs), showAs)
      camera.pairs.set(speaker, pair)
    }

    for (const seg of drawn.segments) {
      const slots = resolveEdlSegmentSlots(drawn, seg)
      const layout = slots.length > 1 ? (seg.layout?.mode ?? "single") : "single"
      slots.forEach((slot, slotIndex) => {
        const showAs: FramingShowAs = { layout, slots: slots.length, slotIndex: layout === "pip" ? slotIndex : 0, aspect }
        if (slot.speaker) {
          add(slot.source, slot.speaker, seg.inMs, showAs)
          return
        }
        // A segment no one is named on (a one-camera edit the renderer splits
        // at the transcript's turns): every speaker who talks during it.
        if (named || slots.length !== 1) return
        for (const t of clipTurns) {
          if (t.endMs > seg.inMs && t.startMs < seg.outMs) add(slot.source, t.speaker, Math.max(seg.inMs, t.startMs), showAs)
        }
      })
    }
  }

  return {
    cameras: [...cameras.values()].map((c) => ({
      id: c.id,
      url: c.url,
      ...(c.offsetMs !== undefined ? { offsetMs: c.offsetMs } : {}),
      pairs: [...c.pairs.values()]
        .sort((a, b) => a.firstMs - b.firstMs)
        .map((p) => ({ source: p.source, speaker: p.speaker, firstMs: p.firstMs, showAs: [...p.showAs.values()] })),
    })),
    turns: [...turns].sort((a, b) => a.startMs - b.startMs),
  }
}

/** Does this camera need a box per speaker? One speaker on a camera is shown
 *  full frame by default (a close-up), and gets no box until one is drawn. */
export const cameraIsShared = (camera: FramingCamera): boolean => camera.pairs.length >= 2

/** The stored region of a pair, if any. */
export function storedRegionOf(stored: unknown, source: string, speaker: string): Region | undefined {
  if (!Array.isArray(stored)) return undefined
  const row = stored.find((r) => r && typeof r === "object" && (r as { source?: unknown }).source === source && (r as { speaker?: unknown }).speaker === speaker) as
    | { region?: Partial<Region> }
    | undefined
  const g = row?.region
  if (!g || [g.x, g.y, g.w, g.h].some((v) => typeof v !== "number" || !Number.isFinite(v))) return undefined
  return { x: g.x!, y: g.y!, w: g.w!, h: g.h! }
}

/**
 * The rows to save: every drawn box, in camera then pair order, followed by
 * stored rows for pairs this edit does not show (kept, never silently lost:
 * another clip or a later edit may show them again).
 */
export function regionsToSave(
  model: FramingModel,
  boxes: ReadonlyMap<string, Region>,
  stored: unknown,
): Array<{ source: string; speaker: string; region: Region }> {
  const out: Array<{ source: string; speaker: string; region: Region }> = []
  const shown = new Set<string>()
  for (const camera of model.cameras) {
    for (const pair of camera.pairs) {
      const key = pairKey(pair.source, pair.speaker)
      shown.add(key)
      const region = boxes.get(key)
      if (region) out.push({ source: pair.source, speaker: pair.speaker, region })
    }
  }
  if (Array.isArray(stored)) {
    for (const row of stored as Array<{ source?: unknown; speaker?: unknown; region?: unknown }>) {
      if (!row || typeof row.source !== "string" || typeof row.speaker !== "string") continue
      if (shown.has(pairKey(row.source, row.speaker))) continue
      const region = storedRegionOf([row], row.source, row.speaker)
      if (region) out.push({ source: row.source, speaker: row.speaker, region })
    }
  }
  return out
}

export const pairKey = (source: string, speaker: string): string => JSON.stringify([source, speaker])
