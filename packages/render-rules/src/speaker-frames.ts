/**
 * Speaker Frames (P3.6): the rules the editor, the workflow run and the
 * self-host relay share.
 *
 *  - WHAT AN EDIT SAMPLES (P3-5 (c), P3-24 (a), decided 2026-10-06): the
 *    plugin's own scope, verbatim — every `video` source of an edit, plus any a
 *    segment or a slot shows, samples the master spans the edit keeps moved
 *    onto its own clock (`sourceMs = masterMs − offsetMs`, clamped at its zero),
 *    padded by 2 s each side and merged; a clip pack is one run over the union
 *    of its clips' spans; a bare video is sampled whole. The panel's tick list
 *    shows each source's frame count from it, and a connected self-host builds
 *    its detection proxies over exactly these spans (P3-15 (a)).
 *  - NO PRICE YET (P3.7): `SPEAKER_FRAMES_PRICED` is false, and every run is
 *    refused with the plugin's own words before anything is reserved — the
 *    Speaker View arrangement before C4, in the same three layers (the node,
 *    the run's preflight, the payload).
 *  - MANUAL CORRECTIONS (P3-18 (a)): `trackAssignments` on the node, applied
 *    at read time by `applySpeakerTrackAssignments`; an assignment whose track
 *    a re-run no longer has is listed, never silently dropped.
 */
import { validateEdl, type Edl, type EdlSegment, type EdlSource, type SpeakerTrackSetDescriptor } from "@nodaro/shared"

/** Whether Speaker Frames may be charged for at all. FALSE until P3.7 measures
 *  and ships the per-1,000-frames rate (TA4: no interim price). P3.7 flips this
 *  one flag. */
export const SPEAKER_FRAMES_PRICED = false

/** The one credit id (P3-13 (a)): billed per started block of 1,000 sampled
 *  frames once P3.7 sets the rate. */
export const SPEAKER_FRAMES_CREDIT_ID = "speaker-frames"

/** The plugin route's exact words. */
export const SPEAKER_FRAMES_NOT_PRICED_MESSAGE = "Speaker Frames is not priced yet"

/** The detection proxy's rate (P3-6, P3-31: fixed and not shown). */
export const SPEAKER_FRAMES_SAMPLE_FPS = 2
/** The detection proxy's height (P3-6). */
export const SPEAKER_FRAMES_PROXY_HEIGHT = 540
/** The margin sampled each side of a kept span (P3-5 (a)). */
export const SPEAKER_FRAMES_SPAN_MARGIN_MS = 2000
/** Kept footage one source may contribute (§3 step 1). */
export const SPEAKER_FRAMES_MAX_SOURCE_MS = 180 * 60_000
/** The source id a bare video's tracks carry. */
export const SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID = "video"

export interface SpeakerFramesRunRefusal {
  readonly nodeIds: readonly string[]
  readonly message: string
}

/**
 * The run-start refusal while Speaker Frames has no price, asked of the nodes a
 * run WILL execute before any node dispatches (both engines), so nothing
 * upstream runs and charges for detection that cannot start. Skipped nodes
 * never run. P3.7 deletes this with the flag.
 */
export function speakerFramesRunRefusal(
  nodes: ReadonlyArray<{ readonly id: string; readonly type?: unknown; readonly data?: unknown }>,
  priced: boolean = SPEAKER_FRAMES_PRICED,
): SpeakerFramesRunRefusal | null {
  if (priced) return null
  const hits = nodes.filter((n) => n.type === "speaker-frames" && (n.data as { skipped?: unknown } | null | undefined)?.skipped !== true)
  if (hits.length === 0) return null
  const nodeIds = hits.map((n) => n.id)
  return {
    nodeIds,
    message: `${SPEAKER_FRAMES_NOT_PRICED_MESSAGE} (Speaker Frames node ${nodeIds.join(", ")}). The run did not start and nothing was charged.`,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  What an edit samples
// ─────────────────────────────────────────────────────────────────────────

export type SpeakerFramesScopeCode = "invalid_input" | "invalid_edl" | "too_long" | "no_video"

export interface SpeakerFramesRefusal {
  readonly ok: false
  readonly code: SpeakerFramesScopeCode
  readonly message: string
}

export interface SpeakerFramesSpan {
  readonly startMs: number
  readonly endMs: number
}

export interface SpeakerFramesScopeSource {
  /** `EdlSource.id`, or `SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID` for a bare video. */
  readonly sourceId: string
  readonly url: string
  /** Source-clock spans to sample: padded, merged, whole ms. `null`: the whole source. */
  readonly spans: readonly SpeakerFramesSpan[] | null
  /** Kept footage before the margins; `null` for a bare video. */
  readonly keptMs: number | null
  /** Frames sampled at 2 fps over `spans`; `null` for a bare video (its length is unknown here). */
  readonly frames: number | null
}

const refuse = (code: SpeakerFramesScopeCode, message: string): SpeakerFramesRefusal => ({ ok: false, code, message: `speaker-frames: ${message}` })

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

function coerceOne(raw: unknown, at: string): Edl | SpeakerFramesRefusal {
  const v = parse(raw)
  if (!isObj(v)) return refuse("invalid_edl", `${at} must be an EDL object.`)
  if (!Array.isArray(v.sources) || !Array.isArray(v.segments)) return refuse("invalid_edl", `${at} needs \`sources\` and \`segments\`.`)
  if (v.clock === "output") return refuse("invalid_edl", `${at} must be on the master clock (an edit-plan EDL), not a rendered output's.`)
  for (let i = 0; i < v.sources.length; i++) {
    const row = v.sources[i] as unknown
    if (!isObj(row) || typeof row.id !== "string" || !row.id) return refuse("invalid_edl", `${at}: source ${i} needs a string \`id\`.`)
    if (typeof row.url !== "string" || !row.url.trim()) return refuse("invalid_edl", `${at}: source "${row.id}" needs a non-empty string \`url\`.`)
  }
  const edl = v as unknown as Edl
  const checked = validateEdl(edl)
  if (!checked.ok) return refuse("invalid_edl", `${at} is not a valid edit: ${checked.issues.slice(0, 3).join("; ")}`)
  return edl
}

/**
 * The edits an `edl` value holds: one EDL, an `Edl[]` pack, a clip set
 * (`{ clips }`), or the JSON string of any of them — and a fan-in's list of
 * JSON strings (P3-24: the clips of a pack folded onto the one `edl` wire).
 * Every edit must be a valid master-clock EDL; an empty pack is refused.
 */
export function coerceSpeakerFramesEdits(raw: unknown): { readonly ok: true; readonly edits: Edl[] } | SpeakerFramesRefusal {
  const v = parse(raw)
  const list: unknown[] | undefined = Array.isArray(v) ? v : isObj(v) && Array.isArray(v.clips) ? (v.clips as unknown[]) : isObj(v) ? [v] : undefined
  if (!list) return refuse("invalid_edl", "`edl` must be an edit, a clip pack (an array of edits) or a clip set.")
  if (list.length === 0) return refuse("invalid_edl", "the clip pack holds no edit.")
  const edits: Edl[] = []
  for (let i = 0; i < list.length; i++) {
    const one = coerceOne(list[i], list.length === 1 ? "the edit" : `clip ${i + 1}`)
    if ("ok" in one && one.ok === false) return one
    edits.push(one as Edl)
  }
  return { ok: true, edits }
}

/** The ids an edit samples: its video sources, and every source a segment or a slot shows. */
function sampledIds(edl: Edl): Set<string> {
  const ids = new Set<string>()
  for (const s of edl.sources) if (s.kind === "video") ids.add(s.id)
  for (const seg of edl.segments as readonly EdlSegment[]) {
    if (typeof seg.video === "string") ids.add(seg.video)
    for (const slot of seg.layout?.slots ?? []) if (slot && typeof slot.source === "string") ids.add(slot.source)
  }
  return ids
}

function merge(spans: readonly SpeakerFramesSpan[]): SpeakerFramesSpan[] {
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const out: SpeakerFramesSpan[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.startMs <= last.endMs) out[out.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, s.endMs) }
    else out.push({ ...s })
  }
  return out
}

const totalMs = (spans: readonly SpeakerFramesSpan[]): number => spans.reduce((n, s) => n + (s.endMs - s.startMs), 0)
const minutes = (ms: number): string => `${Math.round((ms / 60_000) * 10) / 10} min`
/** P3-5: frames = ⌈Σ scoped span × sampleFps⌉. */
const framesOf = (spans: readonly SpeakerFramesSpan[]): number => Math.ceil((totalMs(spans) * SPEAKER_FRAMES_SAMPLE_FPS) / 1000)

interface SourceSpans {
  readonly sourceId: string
  readonly url: string
  readonly keptMs: number
  readonly spans: SpeakerFramesSpan[]
}

/** Every sampled video source of the edits, in first-seen order, before the
 *  untick list — or the refusal the plugin would answer. */
function sourcesOf(edits: readonly Edl[]): { ok: true; byId: Map<string, { source: EdlSource; kept: SpeakerFramesSpan[] }> } | SpeakerFramesRefusal {
  const byId = new Map<string, { source: EdlSource; kept: SpeakerFramesSpan[] }>()
  for (const edl of edits) {
    const ids = sampledIds(edl)
    const spans = (edl.segments as readonly EdlSegment[]).map((seg) => ({ startMs: seg.inMs, endMs: seg.outMs }))
    for (const source of edl.sources) {
      if (!ids.has(source.id)) continue
      const seen = byId.get(source.id)
      if (seen && seen.source.url !== source.url) {
        return refuse("invalid_edl", `source "${source.id}" names two different files in this pack — give each file its own source id.`)
      }
      if (source.kind !== "video") return refuse("no_video", `source "${source.id}" is audio — Speaker Frames samples video sources only.`)
      const off = typeof source.offsetMs === "number" && Number.isFinite(source.offsetMs) ? source.offsetMs : 0
      byId.set(source.id, { source, kept: [...(seen?.kept ?? []), ...spans.map((s) => ({ startMs: s.startMs - off, endMs: s.endMs - off }))] })
    }
  }
  return { ok: true, byId }
}

function spansOf(sourceId: string, url: string, kept: readonly SpeakerFramesSpan[]): SourceSpans {
  const clamped = merge(kept.map((s) => ({ startMs: Math.max(0, s.startMs), endMs: s.endMs })).filter((s) => s.endMs > s.startMs))
  const padded = merge(
    clamped.map((s) => ({
      startMs: Math.max(0, Math.floor(s.startMs - SPEAKER_FRAMES_SPAN_MARGIN_MS)),
      endMs: Math.ceil(s.endMs + SPEAKER_FRAMES_SPAN_MARGIN_MS),
    })),
  )
  return { sourceId, url, keptMs: totalMs(clamped), spans: padded }
}

/**
 * What one Speaker Frames run samples: per source, its file and the
 * source-clock spans, or the refusal (the plugin's codes). Exactly one of
 * `edits` and `videoUrl`.
 */
export function speakerFramesScope(input: {
  readonly edits?: readonly Edl[]
  readonly videoUrl?: string
  readonly excludeSourceIds?: readonly string[]
}): { readonly ok: true; readonly sources: SpeakerFramesScopeSource[] } | SpeakerFramesRefusal {
  const hasEdits = !!input.edits && input.edits.length > 0
  const hasVideo = typeof input.videoUrl === "string" && input.videoUrl.length > 0
  if (hasEdits === hasVideo) return refuse("invalid_input", "wire exactly one of an edit (`edl`) and a video (`videoUrl`).")
  if (hasVideo) {
    if ((input.excludeSourceIds ?? []).length > 0) return refuse("invalid_input", "a bare video has no sources to untick.")
    return { ok: true, sources: [{ sourceId: SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID, url: input.videoUrl!, spans: null, keptMs: null, frames: null }] }
  }
  const found = sourcesOf(input.edits!)
  if (!found.ok) return found
  const excluded = new Set(input.excludeSourceIds ?? [])
  for (const id of excluded) {
    if (!found.byId.has(id)) return refuse("invalid_input", `the untick list names "${id}", which is not a video source of the edit.`)
  }
  const out: SpeakerFramesScopeSource[] = []
  for (const [sourceId, { source, kept }] of found.byId) {
    if (excluded.has(sourceId)) continue
    const s = spansOf(sourceId, source.url, kept)
    if (s.keptMs > SPEAKER_FRAMES_MAX_SOURCE_MS) {
      return refuse("too_long", `source "${sourceId}" keeps ${minutes(s.keptMs)} of footage, over the ${minutes(SPEAKER_FRAMES_MAX_SOURCE_MS)} limit.`)
    }
    if (s.spans.length === 0) continue
    out.push({ sourceId, url: s.url, spans: s.spans, keptMs: s.keptMs, frames: framesOf(s.spans) })
  }
  if (out.length === 0) {
    return found.byId.size === 0
      ? refuse("no_video", "the edit shows no video source to sample.")
      : refuse("invalid_input", "nothing left to sample: every source is unticked, or its kept spans all lie before its own start.")
  }
  return { ok: true, sources: out }
}

/**
 * The node's untick list narrowed to the cameras the CURRENT edits sample, in
 * order. A camera unticked under an earlier wiring stays in the node's data
 * after the edit is rewired without it, and the panel — which lists only the
 * current edit's cameras — can neither show nor re-tick it; sent as is, the
 * scope would refuse every run. Both engines send this list; the API route
 * keeps the scope's strict check for a caller's own list. Edits that cannot be
 * read leave the list unchanged (the scope refuses them anyway).
 */
export function speakerFramesLiveExclusions(edits: readonly Edl[], excludeSourceIds: readonly string[] | undefined): string[] {
  const list = (excludeSourceIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0)
  const found = sourcesOf(edits)
  if (!found.ok) return list
  return list.filter((id) => found.byId.has(id))
}

export interface SpeakerFramesSourceRow {
  readonly sourceId: string
  readonly url: string
  /** Frames this source samples when ticked (P3-5). */
  readonly frames: number
  readonly ticked: boolean
}

/** The panel's per-source tick list (P3-5 (a)): every source the edits sample,
 *  ticked or not, with its frame count. Empty when the edits cannot be read. */
export function speakerFramesSourceRows(edits: readonly Edl[], excludeSourceIds: readonly string[] | undefined): SpeakerFramesSourceRow[] {
  if (edits.length === 0) return []
  const found = sourcesOf(edits)
  if (!found.ok) return []
  const excluded = new Set(excludeSourceIds ?? [])
  return [...found.byId].map(([sourceId, { source, kept }]) => {
    const s = spansOf(sourceId, source.url, kept)
    return { sourceId, url: source.url, frames: framesOf(s.spans), ticked: !excluded.has(sourceId) }
  })
}

// ─────────────────────────────────────────────────────────────────────────
//  Manual corrections (P3-18 (a))
// ─────────────────────────────────────────────────────────────────────────

/** One correction on the node: this track is this speaker (`null`: nobody). */
export interface SpeakerTrackAssignment {
  readonly trackId: string
  readonly speaker: string | null
}

/**
 * The descriptor every consumer reads: each assigned track relabelled
 * (`attribution.method: "manual"`, confidence 1) or cleared (`null`), matched
 * by track id. Assignments whose track the descriptor no longer has are
 * returned in `unmatched` — a re-run that changed track ids lists them. Pure;
 * the input is never mutated.
 */
export function applySpeakerTrackAssignments(
  descriptor: SpeakerTrackSetDescriptor,
  assignments: readonly SpeakerTrackAssignment[] | undefined,
): { readonly descriptor: SpeakerTrackSetDescriptor; readonly unmatched: SpeakerTrackAssignment[] } {
  if (!assignments || assignments.length === 0) return { descriptor, unmatched: [] }
  const byTrack = new Map<string, SpeakerTrackAssignment>()
  for (const a of assignments) if (a && typeof a.trackId === "string") byTrack.set(a.trackId, a)
  const used = new Set<string>()
  const sources = descriptor.sources.map((s) => ({
    ...s,
    tracks: s.tracks.map((t) => {
      const a = byTrack.get(t.id)
      if (!a) return t
      used.add(t.id)
      const { speaker: _s, attribution: _a, ...rest } = t
      if (a.speaker === null || a.speaker === "") return rest
      return { ...rest, speaker: a.speaker, attribution: { method: "manual", confidence: 1 } }
    }),
  }))
  return { descriptor: { ...descriptor, sources }, unmatched: [...byTrack.values()].filter((a) => !used.has(a.trackId)) }
}
