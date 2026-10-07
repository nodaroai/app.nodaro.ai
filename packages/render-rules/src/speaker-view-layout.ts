/**
 * Who is on screen, and with how many cameras: the app's mirror of the cloud
 * plugin's layout stage (SV3, SV4, and the late-camera SNAP decided
 * 2026-10-06). The rule needs it because a refusal is judged on the edit AS
 * DRAWN — a multi-slot segment that reads a camera before its `offsetMs` does
 * not refuse the edit, it drops the late slots and snaps — and the badge must
 * say "refuse" only for an edit the plugin refuses.
 *
 * Mirrored, not shared: the plugin's code is private to it, and
 * `speaker-view-parity.test.ts` pins this copy to fixtures the plugin
 * generated. It stops where the plugin's TURN SPLIT begins — the split is the
 * plugin's taste and is not copied into the public app — so everything here is
 * judged on the edit as given, and the notes count SEGMENTS (a segment the
 * split cuts into pieces is one here and may be several there).
 *
 * Pure; never mutates its input.
 */
import {
  resolveEdlSegmentSlots,
  speakerLayoutAllows,
  getSpeakerLayout,
  type Edl,
  type EdlLayout,
  type EdlSegment,
  type EdlTargetAspect,
} from "@nodaro/shared"

type Slot = NonNullable<EdlLayout["slots"]>[number]

/** The layout `id` renders as at `aspect` with `count` slots (SV4 a): the twin
 *  (side-by-side ↔ stacked, the same two speakers turned for the aspect), else
 *  grid if the count fits, else single. */
export function snapLayout(id: string, aspect: EdlTargetAspect, count: number): string {
  const fits = (candidate: string) => {
    const sheet = getSpeakerLayout(candidate)
    return !!sheet && speakerLayoutAllows(sheet, { aspect, slotCount: count })
  }
  if (id === "single") return "single"
  if (fits(id)) return id
  const twin = id === "side-by-side" ? "stacked" : id === "stacked" ? "side-by-side" : undefined
  if (twin && fits(twin)) return twin
  if (fits("grid")) return "grid"
  return "single"
}

/** The edit's speakers on screen, in order of first appearance: each segment's
 *  `speaker`, then the speakers of its hint slots (SV3). */
export function speakerOrder(edl: Edl): string[] {
  const seen: string[] = []
  const add = (s: unknown) => {
    if (typeof s === "string" && s && !seen.includes(s)) seen.push(s)
  }
  for (const seg of edl.segments) {
    add(seg.speaker)
    for (const slot of Array.isArray(seg.layout?.slots) ? seg.layout!.slots! : []) add(slot?.speaker)
  }
  return seen
}

/** Who gets a tile: the speakers the edit names, else the transcript's labels. */
export function speakerViewSlotSet(edl: Edl, transcriptLabels: readonly string[]): string[] {
  const fromEdit = speakerOrder(edl)
  return fromEdit.length > 0 ? fromEdit : [...transcriptLabels]
}

/** Each speaker's picture source (the video source that shows them most often,
 *  else the one whose `speakers` lists them, else the edit's only camera) and
 *  the speakers no camera places. */
export function speakerSources(edl: Edl, speakers: readonly string[]): { sources: Map<string, string>; unplaced: string[] } {
  const videos = edl.sources.filter((s) => s.kind === "video").map((s) => s.id)
  const tally = new Map<string, Map<string, number>>()
  const count = (speaker: unknown, source: unknown) => {
    if (typeof speaker !== "string" || typeof source !== "string" || !videos.includes(source)) return
    const row = tally.get(speaker) ?? new Map<string, number>()
    row.set(source, (row.get(source) ?? 0) + 1)
    tally.set(speaker, row)
  }
  for (const seg of edl.segments) {
    count(seg.speaker, seg.video)
    for (const slot of Array.isArray(seg.layout?.slots) ? seg.layout!.slots! : []) count(slot?.speaker, slot?.source)
  }
  const sources = new Map<string, string>()
  const unplaced: string[] = []
  for (const speaker of speakers) {
    const row = tally.get(speaker)
    const shown = row ? videos.filter((v) => row.has(v)).sort((a, b) => row.get(b)! - row.get(a)!)[0] : undefined
    const listed = edl.sources.find((s) => s.kind === "video" && Array.isArray(s.speakers) && s.speakers.includes(speaker))?.id
    const source = shown ?? listed ?? (videos.length === 1 ? videos[0] : undefined)
    if (source) sources.set(speaker, source)
    else unplaced.push(speaker)
  }
  return { sources, unplaced }
}

const slotCount = (seg: EdlSegment) => (Array.isArray(seg.layout?.slots) ? seg.layout!.slots!.length : 0)

/** The segment showing its own camera: the hint's mode and slots dropped, its
 *  switch and emphasis (if any) kept. */
function asSingle(seg: EdlSegment): EdlSegment {
  if (!seg.layout) return seg
  const { mode: _mode, slots: _slots, ...rest } = seg.layout
  const { layout: _layout, ...bare } = seg
  return Object.keys(rest).length > 0 ? { ...bare, layout: { mode: "single", ...rest } } : bare
}

/** `auto`: a hint keeps its slots, its mode snapped for the aspect. */
function followHint(seg: EdlSegment, aspect: EdlTargetAspect): EdlSegment {
  const layout = seg.layout
  if (!layout || layout.mode === "single") return seg
  const sheet = getSpeakerLayout(layout.mode)
  const n = slotCount(seg)
  const mode = sheet && n >= 2 ? snapLayout(sheet.id, aspect, n) : "single"
  return mode === "single" ? asSingle(seg) : mode === layout.mode ? seg : { ...seg, layout: { ...layout, mode } }
}

const originMs = (edl: Edl, id: string): number => {
  const offset = edl.sources.find((s) => s.id === id)?.offsetMs
  return typeof offset === "number" && Number.isFinite(offset) ? offset : 0
}

interface CoverageSnap {
  readonly from: string
  readonly to: string
  readonly late: readonly string[]
}

const layoutLabel = (mode: string, slots: number) => (mode === "grid" ? `grid of ${slots}` : mode)

/** Drops the slots on a camera that has not begun at the segment, and snaps
 *  what is left (SV4's order); a segment left with fewer than two cameras
 *  shows its own (`original`). A segment every camera covers is unchanged. */
function coverSegment(edl: Edl, aspect: EdlTargetAspect, original: EdlSegment, laid: EdlSegment, snaps: CoverageSnap[]): EdlSegment {
  const slots = laid.layout?.slots
  if (!laid.layout || !Array.isArray(slots) || slots.length < 2) return laid
  const covering = slots.filter((slot) => laid.inMs >= originMs(edl, slot.source))
  if (covering.length === slots.length) return laid
  const sheet = getSpeakerLayout(laid.layout.mode)
  const mode = sheet && covering.length >= 2 ? snapLayout(sheet.id, aspect, covering.length) : "single"
  snaps.push({
    from: layoutLabel(laid.layout.mode, slots.length),
    to: layoutLabel(mode, covering.length),
    late: [...new Set(slots.filter((slot) => !covering.includes(slot)).map((slot) => slot.source))],
  })
  return mode === "single" ? asSingle(original) : { ...laid, layout: { ...laid.layout, mode, slots: covering } }
}

/** The snapped segments, counted per change. */
function coverageNotes(snaps: readonly CoverageSnap[]): string[] {
  const groups = new Map<string, { snap: CoverageSnap; n: number }>()
  for (const snap of snaps) {
    const key = JSON.stringify([snap.from, snap.to, snap.late])
    const g = groups.get(key)
    groups.set(key, { snap, n: (g?.n ?? 0) + 1 })
  }
  return [...groups.values()].map(
    ({ snap, n }) =>
      `${n} segment${n === 1 ? "" : "s"}: ${snap.from} → ${snap.to} — ${snap.late.map((id) => `"${id}"`).join(", ")} had not begun (offsetMs)`,
  )
}

export interface SpeakerViewLayoutRequest {
  /** `auto` (default) or a layout id. */
  readonly layout?: string
  readonly aspect: EdlTargetAspect
  /** Who fills a fixed multi-slot layout, in order — `speakerViewSlotSet`. */
  readonly speakers: readonly string[]
}

export interface SpeakerViewLayoutResult {
  /** The edit with its layouts written (the late-camera snap applied). */
  readonly drawn: Edl
  /** What the snap changed, one line per kind, counted per segment. */
  readonly notes: readonly string[]
  /** Speakers no camera places (a fixed multi-slot layout cannot be drawn). */
  readonly unplaced: readonly string[]
}

/** The edit as laid out: the node's layout setting and the edit's own hints
 *  written into each segment, anything the aspect or count rules out snapped
 *  (SV4), and every segment that reads a late camera snapped (decided
 *  2026-10-06). */
export function layOutSpeakerView(edl: Edl, req: SpeakerViewLayoutRequest): SpeakerViewLayoutResult {
  const setting = req.layout ?? "auto"
  const snaps: CoverageSnap[] = []
  const covered = (original: EdlSegment, laid: EdlSegment) => coverSegment(edl, req.aspect, original, laid, snaps)
  const result = (segments: readonly EdlSegment[], unplaced: readonly string[] = []): SpeakerViewLayoutResult => {
    const notes = coverageNotes(snaps)
    return { drawn: { ...edl, segments: [...segments], meta: { ...(edl.meta ?? {}), targetAspect: req.aspect } }, notes, unplaced }
  }

  if (setting === "auto") return result(edl.segments.map((seg) => covered(seg, followHint(seg, req.aspect))))
  const sheet = getSpeakerLayout(setting)
  if (!sheet || sheet.id === "single") {
    return result(edl.segments.map((seg) => (seg.layout && (seg.layout.mode !== "single" || slotCount(seg) > 1) ? asSingle(seg) : seg)))
  }

  const speakers = [...req.speakers]
  const mode = snapLayout(sheet.id, req.aspect, speakers.length)
  if (mode === "single") return layOutSpeakerView(edl, { ...req, layout: "single" })

  const { sources: sourceOf, unplaced } = speakerSources(edl, speakers)
  if (unplaced.length > 0) return result(edl.segments, unplaced)
  const slotOf = (speaker: string, active: string | undefined): Slot => ({
    source: sourceOf.get(speaker)!,
    speaker,
    ...(active !== undefined ? { weight: speaker === active ? 1 : 0 } : {}),
  })
  let order = [...speakers]
  return result(
    edl.segments.map((seg) => {
      const active = typeof seg.speaker === "string" && speakers.includes(seg.speaker) ? seg.speaker : undefined
      if (mode === "pip" && active !== undefined) order = [active, ...speakers.filter((s) => s !== active)]
      const { mode: _mode, slots: _slots, ...rest } = seg.layout ?? { mode: "" }
      const slots = order.map((s) => slotOf(s, active))
      const { region: _region, ...bare } = seg
      return covered(seg, { ...(slots.length > 1 ? bare : seg), layout: { ...rest, mode, slots } })
    }),
  )
}

/** The sources a drawn segment reads for its picture and sound: every slot it
 *  shows, and the sound (`audio`, else the master-audio source, else `video`). */
export function sourcesReadBy(edl: Edl, seg: EdlSegment): string[] {
  const masterAudio = edl.sources.find((s) => s.role === "master-audio")?.id
  const sound = seg.audio ?? masterAudio ?? seg.video
  return [...resolveEdlSegmentSlots(edl, seg).map((s) => s.source), ...(sound ? [sound] : [])]
}
