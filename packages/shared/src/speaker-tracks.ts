import type { Edl, EdlSource, EdlValidation } from "./edl.js"

/**
 * Speaker tracks — where each speaker's face is, over time, per camera.
 *
 * WHY THIS EXISTS
 * A face-tracking analysis node samples each camera an edit shows, finds the
 * faces, links them into tracks and labels each track with a speaker. Its
 * result feeds the framing rung `resolveEdlSegmentSlots` reserves for a
 * per-segment resolver (D20, edl-multicam.ts). This module is the wire shape
 * of that result plus the pure functions that read it: structural vocabulary
 * only — no detector, no linking or attribution rule, no framing or follow
 * math, no thresholds. That is why it lives in the Apache-licensed
 * `@nodaro/shared` (the public contract: the API response, the SDK type and
 * the MCP output). Every published version is an irrevocable grant, so every
 * later field is optional and additive.
 *
 * TWO SHAPES, ONE PROJECTION
 *  - `SpeakerTrackSet` — the full set, boxes included. At a long multi-camera
 *    edit it is megabytes of JSON, so it is stored as a JSON artifact (the
 *    versioned box body), never inline in a job row or a node's data.
 *  - `SpeakerTrackSetDescriptor` — what the node outputs: the same set with
 *    every box removed (a `boxCount` per track instead) plus the artifact's
 *    `url`, `sha256` and `bytes`. Consumers fetch the body by URL, check the
 *    hash, run `normalizeSpeakerTracks` + `validateSpeakerTracks` on it, and
 *    can confirm it is the body the descriptor names with
 *    `describeSpeakerTracks(body, artifact)` deep-equal to the descriptor.
 *
 * CLOCK (D19)
 * Boxes are per SOURCE and on that source's own clock (`clock: "source"`), in
 * integer ms. A consumer maps to the master clock through the EDL source's
 * offset: `masterMs = ms + offsetMs` (`remapMsThroughEdl(edl, ms, sourceId)`).
 * Nothing here applies the offset, and nothing ever rescales a time (no
 * seconds→ms guessing — an implausible value is a validation error).
 *
 * GEOMETRY
 * Box coordinates are fractions 0..1 of `frame`: the display-oriented frame
 * (after rotation, square pixels) the producer sampled.
 *
 * SAMPLING
 * `sampledSpans` say what was looked at. No box for a track outside them means
 * "not sampled"; inside them it means "no face there". Spans are half-open
 * `[startMs, endMs)`, like EDL segments.
 */

export const SPEAKER_TRACKS_VERSION = 1 as const

/** How a track got its speaker. Open: a newer producer may add a method, which
 *  an older validator reports as a WARNING, never an issue. */
export const SPEAKER_TRACK_ATTRIBUTION_METHODS = ["source-map", "region", "mouth-motion", "manual"] as const
export type SpeakerTrackAttributionMethod = (typeof SPEAKER_TRACK_ATTRIBUTION_METHODS)[number]
const KNOWN_METHODS: ReadonlySet<string> = new Set(SPEAKER_TRACK_ATTRIBUTION_METHODS)

/** Default hard cap on boxes per source. The longest edit the platform plans
 *  for (180 minutes) sampled at 2 per second is 21,600 samples per source; the
 *  cap leaves room for several faces in every sample. Override per call with
 *  `maxBoxesPerSource`. */
export const SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE = 100_000
/** Default hard cap on the serialized size of a track set (UTF-8 bytes of its
 *  JSON), so no consumer ever loads an unbounded body. Override per call with
 *  `maxBytes`. */
export const SPEAKER_TRACKS_MAX_BYTES = 64 * 1024 * 1024

/** One detection. `ms` on the source clock; x/y/w/h fractions 0..1 of the frame. */
export interface SpeakerTrackBox {
  readonly ms: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** Detector confidence 0..1, when the detector reports one. */
  readonly score?: number
}

export interface SpeakerTrackAttribution {
  /** Known: `SPEAKER_TRACK_ATTRIBUTION_METHODS`. */
  readonly method: SpeakerTrackAttributionMethod | (string & {})
  /** 0..1. */
  readonly confidence: number
  /** The transcript's own label for this speaker, kept beside the display name
   *  in `speaker` so a later rename re-maps instead of orphaning the track. */
  readonly rawSpeaker?: string
}

/** What a track says about itself, without its boxes. */
export interface SpeakerTrackHeader {
  /** Unique in the whole set, e.g. "wide/t3". */
  readonly id: string
  /** A label in the edit's speaker space. Absent = unattributed. */
  readonly speaker?: string
  readonly attribution?: SpeakerTrackAttribution
}

export interface SpeakerTrack extends SpeakerTrackHeader {
  /** Strictly increasing `ms`, each inside one of the source's `sampledSpans`. */
  readonly boxes: readonly SpeakerTrackBox[]
}

export interface SpeakerTrackSummary extends SpeakerTrackHeader {
  readonly boxCount: number
}

export interface SpeakerTrackSpan {
  readonly startMs: number
  /** Exclusive, > startMs. */
  readonly endMs: number
}

interface SpeakerTrackSourceFields {
  /** `EdlSource.id` of a video source. */
  readonly sourceId: string
  /** Boxes, spans and cuts are ms on this SOURCE's own clock (D19). */
  readonly clock: "source"
  /** The display-oriented frame (after rotation, square pixels), in pixels, that box fractions refer to. */
  readonly frame: { readonly w: number; readonly h: number }
  /** What was sampled: sorted, non-overlapping, half-open. */
  readonly sampledSpans: readonly SpeakerTrackSpan[]
  /** Source-clock ms of detected scene changes, ascending. No track spans one. */
  readonly cuts?: readonly number[]
}

export interface SpeakerTrackSource extends SpeakerTrackSourceFields {
  readonly tracks: readonly SpeakerTrack[]
}

export interface SpeakerTrackSourceSummary extends SpeakerTrackSourceFields {
  readonly tracks: readonly SpeakerTrackSummary[]
}

interface SpeakerTrackSetFields {
  readonly version: 1
  /** Samples per second the producer looked at. */
  readonly sampleFps: number
  /** Informational: which detector produced the boxes, e.g. "example:face-detector". */
  readonly detector: { readonly id: string; readonly version?: string }
}

/** The full set — the versioned box body, stored as a JSON artifact. */
export interface SpeakerTrackSet extends SpeakerTrackSetFields {
  readonly sources: readonly SpeakerTrackSource[]
}

/** What the analysis node outputs: the set without its boxes, plus where the body is. */
export interface SpeakerTrackSetDescriptor extends SpeakerTrackSetFields {
  readonly sources: readonly SpeakerTrackSourceSummary[]
  /** Where the `SpeakerTrackSet` body is stored. */
  readonly url: string
  /** SHA-256 of the stored body's bytes, 64 lowercase hex characters. */
  readonly sha256: string
  /** Size of the stored body in bytes. */
  readonly bytes: number
}

// ─────────────────────────────────────────────────────────────────────────
//  Normalization (coerce, never reject — and never reinterpret)
// ─────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const num = (v: unknown, fallback = 0): number => (isNum(v) ? v : fallback)
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
/** A readonly array field of a value that may have skipped normalization. */
const arr = <T,>(v: readonly T[] | undefined): readonly T[] => (Array.isArray(v) ? v : [])
/** Integer ms; never -0 (JSON cannot carry it, so a round trip would differ). */
const int = (v: number): number => {
  const r = Math.round(v)
  return r === 0 ? 0 : r
}

/** One axis of a detection, cropped to the frame: the visible part of
 *  `[p, p+s]` within `[0, 1]`, or undefined when none of it is visible. An
 *  in-frame axis is returned untouched (so a second pass cannot drift by a
 *  float ulp); an overhanging one becomes the intersection, whichever edge it
 *  crosses, so its centre only ever moves toward the visible part. */
function cropAxis(p: number, s: number): readonly [number, number] | undefined {
  if (!(s > 0)) return undefined
  if (p >= 0 && p + s <= 1) return [p, s]
  const lo = clamp01(p)
  const hi = clamp01(p + s)
  return hi > lo ? [lo, hi - lo] : undefined
}

function normalizeBox(raw: unknown): SpeakerTrackBox | undefined {
  if (!isObj(raw)) return undefined
  if (![raw.ms, raw.x, raw.y, raw.w, raw.h].every(isNum)) return undefined
  // A detection is cropped to the frame, never moved: a face at the frame edge
  // keeps only its visible part, and one entirely off-frame is dropped. This is
  // deliberately NOT `normalizeRegion`'s clamp-then-shrink (edl.ts), which is
  // fine for a region a user draws but would shift a left/top overhang and turn
  // an off-frame detection into an in-frame face.
  const xs = cropAxis(raw.x as number, raw.w as number)
  const ys = cropAxis(raw.y as number, raw.h as number)
  if (!xs || !ys) return undefined
  const [x, w] = xs
  const [y, h] = ys
  return { ms: int(raw.ms as number), x, y, w, h, ...(isNum(raw.score) ? { score: clamp01(raw.score) } : {}) }
}

function normalizeSpans(raw: unknown): SpeakerTrackSpan[] {
  if (!Array.isArray(raw)) return []
  const spans = raw
    .filter(isObj)
    .filter((s) => isNum(s.startMs) && isNum(s.endMs))
    .map((s) => ({ startMs: int(s.startMs as number), endMs: int(s.endMs as number) }))
    .filter((s) => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const merged: SpeakerTrackSpan[] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s.startMs <= last.endMs) merged[merged.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, s.endMs) }
    else merged.push(s)
  }
  return merged
}

function normalizeCuts(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const sorted = raw.filter(isNum).map(int).sort((a, b) => a - b)
  return sorted.filter((c, i) => i === 0 || c !== sorted[i - 1])
}

function normalizeAttribution(raw: unknown): SpeakerTrackAttribution | undefined {
  if (!isObj(raw)) return undefined
  const method = str(raw.method)
  if (!method) return undefined
  const rawSpeaker = str(raw.rawSpeaker)
  return { method, confidence: clamp01(num(raw.confidence)), ...(rawSpeaker ? { rawSpeaker } : {}) }
}

function normalizeHeader(raw: Record<string, unknown>, fallbackId: string): SpeakerTrackHeader {
  const speaker = str(raw.speaker)
  const attribution = normalizeAttribution(raw.attribution)
  return {
    id: str(raw.id) || fallbackId,
    ...(speaker ? { speaker } : {}),
    ...(attribution ? { attribution } : {}),
  }
}

function normalizeSetFields(o: Record<string, unknown>): SpeakerTrackSetFields {
  const detector = isObj(o.detector) ? o.detector : {}
  const detectorVersion = str(detector.version)
  return {
    // Only an ABSENT version defaults to 1. Any present value — another
    // number, "2", null — is kept as is so validate refuses it rather than
    // reading a newer (or broken) body as this one.
    version: (o.version === undefined ? SPEAKER_TRACKS_VERSION : o.version) as 1,
    sampleFps: num(o.sampleFps),
    detector: { id: str(detector.id) ?? "", ...(detectorVersion ? { version: detectorVersion } : {}) },
  }
}

function normalizeSources<T>(
  raw: unknown,
  track: (t: Record<string, unknown>, fallbackId: string) => T,
): Array<SpeakerTrackSourceFields & { readonly tracks: readonly T[] }> {
  if (!Array.isArray(raw)) return []
  return raw.map((r) => {
    const s = isObj(r) ? r : {}
    const sourceId = str(s.sourceId) ?? ""
    const frame = isObj(s.frame) ? s.frame : {}
    const cuts = normalizeCuts(s.cuts)
    const tracks = Array.isArray(s.tracks) ? s.tracks.map((t, k) => track(isObj(t) ? t : {}, `${sourceId}/t${k + 1}`)) : []
    return {
      sourceId,
      // A clock other than "source" cannot be repaired: boxes on another clock
      // would land offsetMs away from their frame. Keep it for validate to refuse.
      clock: (typeof s.clock === "string" ? s.clock : "source") as "source",
      frame: { w: int(num(frame.w)), h: int(num(frame.h)) },
      sampledSpans: normalizeSpans(s.sampledSpans),
      tracks,
      ...(cuts.length > 0 ? { cuts } : {}),
    }
  })
}

/**
 * Coerce an unknown value into a well-formed `SpeakerTrackSet` (the box body):
 * drop unknown keys and malformed boxes, crop every box to the frame (an
 * entirely off-frame box is dropped, an overhang keeps its visible part), clamp
 * scores and confidences to 0..1, round every time to integer ms, sort each
 * track's boxes by time (box order IS time, unlike EDL segment order), sort and
 * merge sampled spans, sort and de-duplicate cuts.
 *
 * It never repairs what would change meaning: a box outside every sampled
 * span, two boxes at one instant, a track across a cut, another version or
 * another clock all survive for `validateSpeakerTracks` to report.
 */
export function normalizeSpeakerTracks(input: unknown): SpeakerTrackSet {
  const o = isObj(input) ? input : {}
  return {
    ...normalizeSetFields(o),
    sources: normalizeSources(o.sources, (t, fallbackId) => {
      const boxes = Array.isArray(t.boxes) ? t.boxes.map(normalizeBox).filter((b): b is SpeakerTrackBox => b !== undefined) : []
      return { ...normalizeHeader(t, fallbackId), boxes: [...boxes].sort((a, b) => a.ms - b.ms) }
    }),
  }
}

/** Coerce an unknown value into a `SpeakerTrackSetDescriptor`, by the same rules
 *  as `normalizeSpeakerTracks`; a missing or broken `boxCount` becomes 0. */
export function normalizeSpeakerTrackSetDescriptor(input: unknown): SpeakerTrackSetDescriptor {
  const o = isObj(input) ? input : {}
  return {
    ...normalizeSetFields(o),
    sources: normalizeSources(o.sources, (t, fallbackId) => ({
      ...normalizeHeader(t, fallbackId),
      boxCount: Math.max(0, int(num(t.boxCount))),
    })),
    url: str(o.url) ?? "",
    sha256: str(o.sha256) ?? "",
    bytes: int(num(o.bytes)),
  }
}

/** The descriptor of a (normalized) set stored at `artifact.url`: every box
 *  removed, a `boxCount` per track. Pure; the caller hashes and stores the body. */
export function describeSpeakerTracks(
  set: SpeakerTrackSet,
  artifact: { readonly url: string; readonly sha256: string; readonly bytes: number },
): SpeakerTrackSetDescriptor {
  return {
    version: set.version,
    sampleFps: set.sampleFps,
    detector: { ...set.detector },
    sources: set.sources.map((s) => ({
      sourceId: s.sourceId,
      clock: s.clock,
      frame: { ...s.frame },
      sampledSpans: s.sampledSpans.map((sp) => ({ ...sp })),
      tracks: s.tracks.map((t) => ({
        id: t.id,
        ...(t.speaker !== undefined ? { speaker: t.speaker } : {}),
        ...(t.attribution ? { attribution: { ...t.attribution } } : {}),
        boxCount: t.boxes.length,
      })),
      ...(s.cuts && s.cuts.length > 0 ? { cuts: [...s.cuts] } : {}),
    })),
    url: artifact.url,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  The edit's speaker space
// ─────────────────────────────────────────────────────────────────────────

/** The speaker labels an edit uses: the union of `sources[].speakers`,
 *  `segments[].speaker` and `segments[].layout.slots[].speaker`, over every EDL
 *  given (a clip pack), sorted by code unit. Tracks must be labelled in this
 *  space, or no track ever matches a segment's speaker. */
export function edlSpeakerSpace(edl: Edl | readonly Edl[]): string[] {
  const out = new Set<string>()
  const add = (v: unknown) => {
    if (typeof v === "string" && v) out.add(v)
  }
  for (const e of edlList(edl)) {
    for (const s of Array.isArray(e.sources) ? e.sources : []) {
      for (const sp of Array.isArray(s?.speakers) ? s.speakers : []) add(sp)
    }
    for (const seg of Array.isArray(e.segments) ? e.segments : []) {
      add(seg?.speaker)
      for (const slot of Array.isArray(seg?.layout?.slots) ? seg.layout!.slots! : []) add(slot?.speaker)
    }
  }
  return [...out].sort()
}

function edlList(edl: Edl | readonly Edl[] | undefined): readonly Edl[] {
  if (!edl) return []
  const all: readonly unknown[] = Array.isArray(edl) ? edl : [edl]
  return all.filter((e): e is Edl => isObj(e))
}

// ─────────────────────────────────────────────────────────────────────────
//  Validation
// ─────────────────────────────────────────────────────────────────────────

export interface SpeakerTracksValidateOptions {
  /** The edit the tracks are for — one EDL, or every clip of a pack. When given,
   *  every source must resolve to one of its video sources, and attributed
   *  speakers must be in its speaker space (`edlSpeakerSpace`). */
  readonly edl?: Edl | readonly Edl[]
  /** Default `SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE`. */
  readonly maxBoxesPerSource?: number
  /** Default `SPEAKER_TRACKS_MAX_BYTES`. */
  readonly maxBytes?: number
  /** `validateSpeakerTracks` only: the body's known size in bytes (e.g. the
   *  fetched length), so a large body is not serialized again to measure it. */
  readonly serializedBytes?: number
}

const SHA256_HEX = /^[0-9a-f]{64}$/

type Findings = { issues: string[]; warnings: string[] }

/** The rules shared by the body and the descriptor. `perTrack` adds the body's
 *  box rules and returns the track's box count. */
function validateCommon<T extends SpeakerTrackHeader>(
  set: SpeakerTrackSetFields & { readonly sources: ReadonlyArray<SpeakerTrackSourceFields & { readonly tracks: readonly T[] }> },
  opts: SpeakerTracksValidateOptions,
  perTrack: (track: T, source: SpeakerTrackSourceFields, f: Findings) => number,
): Findings {
  const f: Findings = { issues: [], warnings: [] }
  const { issues, warnings } = f
  const sources = arr(set.sources)
  const maxBoxes = opts.maxBoxesPerSource ?? SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE

  if (set.version !== SPEAKER_TRACKS_VERSION) issues.push(`version must be ${SPEAKER_TRACKS_VERSION}`)
  if (!(isNum(set.sampleFps) && set.sampleFps > 0)) issues.push("sampleFps must be a finite number > 0")

  const edls = edlList(opts.edl)
  const edlSources = new Map<string, EdlSource>()
  for (const e of edls) {
    for (const s of Array.isArray(e.sources) ? e.sources : []) {
      if (s && typeof s.id === "string" && !edlSources.has(s.id)) edlSources.set(s.id, s)
    }
  }

  const sourceIds = new Set<string>()
  const trackIds = new Set<string>()
  sources.forEach((s, i) => {
    const sid = s.sourceId
    const at = `source "${sid}"`
    if (!sid) issues.push(`source[${i}]: sourceId is empty`)
    else if (sourceIds.has(sid)) issues.push(`duplicate source id "${sid}"`)
    sourceIds.add(sid)
    if (sid && edls.length > 0) {
      const es = edlSources.get(sid)
      if (!es) issues.push(`${at}: not a source of the EDL`)
      else if (es.kind !== "video") issues.push(`${at}: the EDL source is kind:"${es.kind}", tracks need a video source`)
    }
    if (s.clock !== "source") issues.push(`${at}: clock must be "source"`)
    if (!(isObj(s.frame) && isNum(s.frame.w) && isNum(s.frame.h) && s.frame.w > 0 && s.frame.h > 0)) {
      issues.push(`${at}: frame w/h must be positive`)
    }

    const spans = arr<SpeakerTrackSpan>(s.sampledSpans)
    spans.forEach((sp, j) => {
      const startMs: unknown = sp?.startMs
      const endMs: unknown = sp?.endMs
      if (!(isNum(startMs) && isNum(endMs) && endMs > startMs)) {
        issues.push(`${at}: sampledSpans[${j}] [${startMs},${endMs}) is not positive`)
        return
      }
      if (!(Number.isInteger(startMs) && Number.isInteger(endMs))) issues.push(`${at}: sampledSpans[${j}] [${startMs},${endMs}) is not integer ms`)
      if (startMs < 0) issues.push(`${at}: sampledSpans[${j}] starts before 0`)
      const prevEnd: unknown = spans[j - 1]?.endMs
      if (j > 0 && isNum(prevEnd) && startMs < prevEnd) {
        issues.push(`${at}: sampledSpans must be sorted and non-overlapping (span ${j})`)
      }
    })

    const cuts = s.cuts
    if (cuts !== undefined) {
      const okCuts = Array.isArray(cuts) && cuts.every((c, k) => Number.isInteger(c) && c >= 0 && (k === 0 || c > cuts[k - 1]))
      if (!okCuts) issues.push(`${at}: cuts must be ascending non-negative ms`)
    }

    let boxes = 0
    const tracks = arr<T>(s.tracks)
    tracks.forEach((t, k) => {
      if (!t?.id) issues.push(`${at} track[${k}]: id is empty`)
      else if (trackIds.has(t.id)) issues.push(`duplicate track id "${t.id}"`)
      if (t?.id) trackIds.add(t.id)
      const a = t?.attribution
      if (a) {
        if (!(isNum(a.confidence) && a.confidence >= 0 && a.confidence <= 1)) {
          issues.push(`track "${t.id}": attribution.confidence=${a.confidence} out of 0..1`)
        }
        if (!KNOWN_METHODS.has(a.method)) {
          warnings.push(`track "${t.id}": unknown attribution method "${a.method}" (known: ${SPEAKER_TRACK_ATTRIBUTION_METHODS.join(", ")})`)
        }
      }
      boxes += perTrack(t, s, f)
    })
    if (boxes > maxBoxes) issues.push(`${at}: ${boxes} boxes is over the cap of ${maxBoxes}`)
  })

  // The speaker name space: labels from the raw transcript against an edit
  // that uses display names (or the reverse) match nothing, and every slot
  // would silently fall back to static framing.
  if (edls.length > 0) {
    const space = edlSpeakerSpace(edls)
    const attributed = sources.flatMap((s) => (Array.isArray(s.tracks) ? s.tracks : [])).filter((t) => !!t?.speaker)
    if (space.length > 0 && attributed.length > 0) {
      const inSpace = new Set(space)
      const matches = (t: T) => inSpace.has(t.speaker!) || (!!t.attribution?.rawSpeaker && inSpace.has(t.attribution.rawSpeaker))
      if (!attributed.some(matches)) {
        const labels = [...new Set(attributed.map((t) => t.speaker!))].sort()
        issues.push(
          `no tracked speaker is in the edit's speaker set: the tracks are labelled ${labels.map((l) => `"${l}"`).join(", ")}` +
            ` and the edit uses ${space.map((l) => `"${l}"`).join(", ")} — wire Speaker Frames to the same transcript as Camera Switch`,
        )
      } else {
        for (const t of attributed) {
          if (!matches(t)) warnings.push(`track "${t.id}": speaker "${t.speaker}" is not in the edit's speaker set`)
        }
      }
    }
  }
  return f
}

/** Per-box findings listed per track and rule before the rest are summarized
 *  in one line, and the most issues a validation lists before one truncation
 *  line. A systematic producer bug (a clock off by `offsetMs`, say) puts EVERY
 *  box out of span; the refusal must stay readable wherever it is shown. */
const BOX_FINDINGS_PER_RULE = 5
const MAX_LISTED_FINDINGS = 100

/** A per-box finding: the rule (what the per-track summary line counts, as
 *  "N more boxes <rule>") and the message for one box. */
type BoxFinding = readonly [rule: string, message: string]

function boxIssues(b: SpeakerTrackBox, at: string): BoxFinding[] {
  const out: BoxFinding[] = []
  for (const k of ["x", "y", "w", "h"] as const) {
    const v = b?.[k]
    if (!isNum(v) || v < 0 || v > 1) out.push([`with ${k} out of 0..1`, `${at}: ${k}=${v} out of 0..1`])
  }
  if (out.length > 0) return out
  // The same edge tolerance as validateEdl's regions, so the two never disagree.
  if (b.w <= 0 || b.h <= 0) out.push(["with a non-positive w/h", `${at}: non-positive w/h`])
  if (b.x + b.w > 1 + 1e-9) out.push(["extending past the right edge", `${at}: extends past the right edge (x+w>1)`])
  if (b.y + b.h > 1 + 1e-9) out.push(["extending past the bottom edge", `${at}: extends past the bottom edge (y+h>1)`])
  if (b.score !== undefined && !(isNum(b.score) && b.score >= 0 && b.score <= 1)) out.push(["with a score out of 0..1", `${at}: score=${b.score} out of 0..1`])
  return out
}

/** Cap a findings list at `MAX_LISTED_FINDINGS`, ending in one line that counts
 *  the rest. Never empties a non-empty list, so `ok` is unchanged. */
function capListed(list: readonly string[], noun: "issues" | "warnings"): string[] {
  if (list.length <= MAX_LISTED_FINDINGS) return [...list]
  return [...list.slice(0, MAX_LISTED_FINDINGS), `${list.length - MAX_LISTED_FINDINGS} more ${noun} not listed`]
}

/** Is `ms` inside one of `spans` (sorted, half-open)? Binary search. */
function inSpans(spans: readonly SpeakerTrackSpan[], ms: number): boolean {
  let lo = 0
  let hi = spans.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const sp = spans[mid]
    if (ms < sp.startMs) hi = mid - 1
    else if (ms >= sp.endMs) lo = mid + 1
    else return true
  }
  return false
}

/**
 * Structural validation of a track set (the box body). Normalization is
 * `normalizeSpeakerTracks`'s job; this reports what is still wrong after it.
 * Issues are facts intrinsic to the set (or to the set against the EDL);
 * warnings are judgements an older validator must not turn into a refusal
 * (an unknown attribution method, one stray speaker label).
 *
 * Rules: version; a positive sample rate; unique source ids that resolve to
 * the EDL's video sources; the source clock; a positive frame; sorted,
 * non-overlapping, positive, integer-ms spans; ascending integer cuts; unique
 * track ids; every box in-frame, at an integer ms, strictly after the previous
 * one and inside a sampled span; no track across a cut; the speaker name
 * space; the box and byte caps.
 *
 * The listing is bounded: per track, the first few boxes breaking each rule
 * are listed and the rest counted in one line; past a fixed total, one line
 * counts the issues (or warnings) not listed. `ok` counts every finding.
 */
export function validateSpeakerTracks(set: SpeakerTrackSet, opts: SpeakerTracksValidateOptions = {}): EdlValidation {
  const safe = isObj(set) ? set : ({} as SpeakerTrackSet)
  const f = validateCommon(safe, opts, (t, source, { issues }) => {
    const boxes = Array.isArray(t?.boxes) ? t.boxes : []
    const spans = Array.isArray(source.sampledSpans) ? source.sampledSpans : []
    let first = Infinity
    let last = -Infinity
    // The first few findings of each rule are listed; the rest are counted.
    const seen = new Map<string, number>()
    const report = ([rule, message]: BoxFinding) => {
      const n = (seen.get(rule) ?? 0) + 1
      seen.set(rule, n)
      if (n <= BOX_FINDINGS_PER_RULE) issues.push(message)
    }
    const outside = `outside every sampled span of source "${source.sourceId}"`
    boxes.forEach((b, j) => {
      const at = `track "${t.id}" box[${j}]`
      boxIssues(b, at).forEach(report)
      if (!isNum(b?.ms)) {
        report(["whose ms is not a number", `${at}: ms is not a number`])
        return
      }
      if (!Number.isInteger(b.ms)) report(["whose ms is not an integer", `${at}: ms ${b.ms} is not an integer`])
      const prev = boxes[j - 1]?.ms
      if (j > 0 && isNum(prev) && !(b.ms > prev)) report(["not after the previous box", `${at}: ms ${b.ms} is not after the previous box (${prev})`])
      if (!inSpans(spans, b.ms)) report([outside, `${at}: ms ${b.ms} is ${outside}`])
      first = Math.min(first, b.ms)
      last = Math.max(last, b.ms)
    })
    for (const [rule, n] of seen) {
      if (n > BOX_FINDINGS_PER_RULE) issues.push(`track "${t.id}": ${n - BOX_FINDINGS_PER_RULE} more boxes ${rule}`)
    }
    const cut = (Array.isArray(source.cuts) ? source.cuts : []).find((c) => first < c && c <= last)
    if (cut !== undefined) issues.push(`track "${t.id}": spans the cut at ${cut} ms (boxes ${first}..${last})`)
    return boxes.length
  })
  const maxBytes = opts.maxBytes ?? SPEAKER_TRACKS_MAX_BYTES
  const bytes = opts.serializedBytes ?? new TextEncoder().encode(JSON.stringify(safe)).length
  if (bytes > maxBytes) f.issues.push(`the track set is ${bytes} bytes, over the cap of ${maxBytes}`)
  return { ok: f.issues.length === 0, issues: capListed(f.issues, "issues"), warnings: capListed(f.warnings, "warnings") }
}

/**
 * Structural validation of a descriptor (the node's output): the same rules as
 * `validateSpeakerTracks` minus the per-box ones (it has no boxes; `boxCount`
 * feeds the per-source cap), plus a non-empty `url`, a well-formed `sha256`
 * and a positive `bytes` within the byte cap.
 */
export function validateSpeakerTrackSetDescriptor(
  d: SpeakerTrackSetDescriptor,
  opts: Omit<SpeakerTracksValidateOptions, "serializedBytes"> = {},
): EdlValidation {
  const safe = isObj(d) ? d : ({} as SpeakerTrackSetDescriptor)
  const f = validateCommon(safe, opts, (t, _source, { issues }) => {
    if (!(Number.isInteger(t?.boxCount) && t.boxCount >= 0)) {
      issues.push(`track "${t?.id}": boxCount must be a non-negative integer`)
      return 0
    }
    return t.boxCount
  })
  if (!(typeof safe.url === "string" && safe.url.trim())) f.issues.push("url is empty")
  if (!(typeof safe.sha256 === "string" && SHA256_HEX.test(safe.sha256))) f.issues.push("sha256 must be 64 lowercase hex characters")
  const maxBytes = opts.maxBytes ?? SPEAKER_TRACKS_MAX_BYTES
  if (!(Number.isInteger(safe.bytes) && safe.bytes > 0)) f.issues.push("bytes must be a positive integer")
  else if (safe.bytes > maxBytes) f.issues.push(`the track set is ${safe.bytes} bytes, over the cap of ${maxBytes}`)
  return { ok: f.issues.length === 0, issues: capListed(f.issues, "issues"), warnings: capListed(f.warnings, "warnings") }
}
