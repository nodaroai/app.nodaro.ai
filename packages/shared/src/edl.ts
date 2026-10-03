import { speakerSwitchOverlaps, speakerPresentationWarnings } from "./speaker-layouts.js"
import type { EdlTargetAspect } from "./speaker-layouts.js"

/**
 * EDL — the edit decision list contract.
 *
 * WHY THIS EXISTS
 * The podcast-editing primitives (transcript-driven cut, clip finding,
 * multicam, speaker view) compose because they share ONE data shape: every
 * analysis node produces an EDL, every render node consumes one. This module
 * is that shape plus the pure functions that read it. It is structural
 * vocabulary — no prompts, no heuristics, no editorial judgment — which is why
 * it lives in the Apache-licensed `@nodaro/shared` (the wire shape of
 * `/v1/edl/*`, an SDK type, an MCP output). Every published version is an
 * irrevocable grant, so the three resolved decisions (see below) all land in
 * version 1: renaming a field, or adding a REQUIRED one, later would be a
 * breaking major bump — so every later field is optional and additive.
 *
 * This module is PURE — no I/O, no ffmpeg, no network. The executors
 * (`apply-edl`, `speaker-view`) turn an EDL into pixels; they live in the app
 * and the plugins.
 *
 * DESIGN DECISIONS baked into v1 (so multicam and speaker view extend the
 * contract additively rather than with a breaking bump):
 *  - D17 OVERLAP: a crossfade consumes time from the outgoing segment (ffmpeg
 *    `xfade`, as combine-videos already does), so the rendered timeline is
 *    SHORTER than the sum of segment durations. `edlDurationMs` subtracts the
 *    overlap transitions; cut/pan/zoom consume no time (pan: a geometry tween
 *    inside ONE source; zoom: a tween inside each segment); only the `xfade:*`
 *    family and a segment `crossfade` overlap.
 *  - D19 CLOCK/SOURCE/SIGN: `Edl.clock` says whether `segments` are on the
 *    source master clock or an output clock; `Transcript.sourceId` says which
 *    source a transcript came from; the offset sign is `masterMs = sourceMs +
 *    offsetMs(source)`, applied by the remap functions.
 *  - D20 PRECEDENCE/RENAME: region precedence
 *    `slot.region ▷ segment.region (single-slot only) ▷ a caller's per-slot
 *    resolver (v3 tracks) ▷ regions[(source, speaker)] ▷ source.region ▷ full
 *    frame`, implemented ONCE by `resolveEdlSegmentSlots` (edl-multicam.ts);
 *    `segment.region` is invalid when the segment's layout has more than one
 *    slot; `slots[].weight` (0..1, active = 1) replaces the design's
 *    `slots[].emphasis` so it no longer collides with `layout.emphasis`
 *    ({ style, durationMs }).
 *
 * Time is INTEGER MILLISECONDS everywhere. There is no seconds→ms guessing
 * (`normalizeEdl` never reinterprets a unit — an implausible value is a
 * validation error, not a silent 1000× edit).
 */

export const EDL_VERSION = 1 as const

/** A crop region, as fractions 0..1 of the source frame. */
export interface EdlRegion {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export const EDL_SOURCE_ROLES = ["master-audio", "camera", "wide", "screen"] as const
export type EdlSourceRole = (typeof EDL_SOURCE_ROLES)[number]

const KNOWN_SOURCE_ROLES: ReadonlySet<string> = new Set(EDL_SOURCE_ROLES)

/** A media input to the edit. Ids are minted once (by `edit-plan`) and never
 *  re-derived, so downstream nodes resolve media from `url` in the data, not
 *  from canvas handle order. Keep the `url` key: the cloud relay re-hosts
 *  private media by walking `url`-suffixed fields. */
export interface EdlSource {
  readonly id: string
  readonly url: string
  readonly kind: "video" | "audio"
  /** This source's origin on the master clock. `masterMs = sourceMs + offsetMs`. Default 0. */
  readonly offsetMs?: number
  /** Known roles: EDL_SOURCE_ROLES. Open (`string & {}`) so an EDL written by a newer producer still type-checks
   *  and still validates — an unknown role is a WARNING (validateEdl); an executor that cannot honour it refuses it. */
  readonly role?: EdlSourceRole | (string & {})
  /** Speaker labels this source frames (multicam). Empty = unknown. */
  readonly speakers?: readonly string[]
  /** A static crop for this source (speaker-view v1 framing). */
  readonly region?: EdlRegion
}

/** How a segment is presented on screen (speaker-view, phase 2). `mode` and
 *  `transition.type` are ids from the `SPEAKER_LAYOUTS` / `SPEAKER_SWITCHES`
 *  registries (speaker-layouts.ts); `emphasis.style` is a `+`-joined set of
 *  atomic `SPEAKER_EMPHASIS_STYLES` (e.g. "scale+border"). Unknown ids are
 *  validation WARNINGS, and `mode` stays an open string on purpose. v1 leaves
 *  layout undefined (single camera). */
export interface EdlLayout {
  /** "single" | "side-by-side" | "stacked" | "grid" | "pip" | … */
  readonly mode: string
  readonly slots?: ReadonlyArray<{
    readonly source: string
    readonly region?: EdlRegion
    readonly speaker?: string
    /** D20: 0..1, the active slot = 1. (Was `emphasis`; renamed to avoid
     *  colliding with `layout.emphasis`.) */
    readonly weight?: number
  }>
  /** A "+"-joined set of "none" | "scale" | "border" | "dim" | …, eased over durationMs. */
  readonly emphasis?: { readonly style: string; readonly durationMs: number }
  /** Into THIS segment. "cut" | "pan" | "zoom" consume no time; "xfade:<id>" overlaps (D17).
   *  `durationMs` never consumes timeline time for the non-overlap types: it
   *  is the tween length for `pan` / `zoom` and is ignored for `cut`. */
  readonly transition?: { readonly type: string; readonly durationMs?: number }
}

export interface EdlSegment {
  readonly id: string
  /** On the MASTER clock. */
  readonly inMs: number
  /** Exclusive, > inMs. */
  readonly outMs: number
  /** `EdlSource.id` supplying picture. Omit = audio-only EDL. */
  readonly video?: string
  /** `EdlSource.id` supplying sound. Default: the unique `role:"master-audio"` source, else `video`. */
  readonly audio?: string
  /** Dominant speaker label (informational). */
  readonly speaker?: string
  /** Into THIS segment. Only "crossfade" consumes time (D17); never on segments[0].
   *  `durationMs` is optional and inert for "cut". */
  readonly transition?: { readonly type: "cut" | "crossfade"; readonly durationMs?: number }
  /** Per-segment crop override — SINGLE-slot only (D20). */
  readonly region?: EdlRegion
  readonly layout?: EdlLayout
  /** Free tags: "hook", "chapter:2", … (removed spans live in `Edl.dropped`). */
  readonly labels?: readonly string[]
}

export interface EdlDropped {
  readonly inMs: number
  readonly outMs: number
  readonly reason: "silence" | "filler" | "false-start" | "tangent" | "manual" | string
}

export interface Edl {
  readonly version: 1
  /** D19: are `segments` on the source master clock, or an already-rendered output clock? */
  readonly clock: "master" | "output"
  readonly sources: readonly EdlSource[]
  /** The ordered output timeline. Output time = cumulative segment durations, less overlap transitions. */
  readonly segments: readonly EdlSegment[]
  readonly dropped?: readonly EdlDropped[]
  /** Set when this EDL was re-cut from a rendered output (speaker-view after apply-edl). */
  readonly derivedFrom?: { readonly edlId: string; readonly clock: "output" }
  readonly meta?: {
    readonly title?: string
    readonly hook?: string
    /** Known aspects: `EDL_TARGET_ASPECTS`. Open (`string & {}`) so an EDL
     *  written by a newer producer still type-checks — an unknown aspect is a
     *  validation WARNING (validateEdl), never an issue. */
    readonly targetAspect?: EdlTargetAspect | (string & {})
    readonly platform?: string
    readonly notes?: string
  }
}

/** The `clips` mode's response/SDK shape. On the canvas the node emits a bare
 *  `Edl[]` (T5: the `list` fan-out reads a top-level JSON array), and the
 *  cloud relay writes `output_data` as this object — the unwrap to the bare
 *  array happens in the output extractors, never in `output_data`. */
export interface EdlClipSet {
  readonly version: 1
  readonly clips: readonly Edl[]
}

/** The `chapters` mode's `output_data` shape — a plain `data` list. */
export interface ChapterSet {
  readonly version: 1
  readonly chapters: ReadonlyArray<{ readonly startMs: number; readonly title: string }>
}

/** The normalized JSON form of a transcribe result. */
export interface Transcript {
  readonly version: 1
  /** D19: which `EdlSource` this transcript was made from (drives the offset in remap). */
  readonly sourceId?: string
  readonly language?: string
  readonly words: ReadonlyArray<{
    readonly text: string
    readonly startMs: number
    readonly endMs: number
    readonly speaker?: string
    readonly confidence?: number
  }>
  readonly segments?: ReadonlyArray<{
    readonly startMs: number
    readonly endMs: number
    readonly text: string
    readonly speaker?: string
  }>
}

/** Duration (seconds) implied by a transcript — the LATEST word/segment `endMs`
 *  across the whole transcript, in seconds. The edit-plan reserve's duration
 *  fallback BENEATH the master-source ffprobe (`computeEditPlanReserveId`): the
 *  authoritative reserve basis is a probe of the master media, exactly like the
 *  plugin route; this transcript clock is used only in `buildPayload` (which
 *  cannot ffprobe) and when that probe can't run, for a MASTER source node that
 *  exposes no length of its own (a `reference-audio`/youtube or direct-URL
 *  master carries its length in neither `data.duration` nor
 *  `metadata.durationSeconds` — see `editPlanSourceDurationSec` — and its live
 *  orchestrator output is a bare URL). The transcript is a REQUIRED edit-plan
 *  input and is the timing map of that same master, so its last word's `endMs`
 *  is a lower bound on the source's own clock.
 *
 *  Accepts `unknown` because the cloud plugin's Zod is the transcript's schema
 *  authority; this reads defensively and returns `undefined` for any shape it
 *  can't measure (so the caller falls back to the ceiling bucket — the safe
 *  over-reserve direction). Takes the MAX endMs rather than the last element so
 *  an out-of-order words array can't under-report. NOTE the direction: a
 *  transcript's last spoken word ends at or before the true media end (trailing
 *  music/silence is not transcribed), so this can UNDER-estimate; bucket
 *  round-up is the headroom, and the cloud re-probe money-gate refuses (never
 *  overcharges) if the probed master still exceeds the reserved bucket. */
export function transcriptDurationSec(transcript: unknown): number | undefined {
  if (!transcript || typeof transcript !== "object") return undefined
  const t = transcript as { words?: unknown; segments?: unknown }
  let maxEndMs = 0
  const scan = (rows: unknown): void => {
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      const endMs = (row as { endMs?: unknown } | null)?.endMs
      if (typeof endMs === "number" && Number.isFinite(endMs) && endMs > maxEndMs) {
        maxEndMs = endMs
      }
    }
  }
  // Max over BOTH words AND segments — a segment tail can extend past the last
  // word (mirrors the plugin's own `transcriptDurationMs`, which maxes both), so
  // scanning segments only when words is empty would under-report.
  scan(t.words)
  scan(t.segments)
  return maxEndMs > 0 ? maxEndMs / 1000 : undefined
}

// ─────────────────────────────────────────────────────────────────────────
//  Pure functions
// ─────────────────────────────────────────────────────────────────────────

/** Is this segment-transition an OVERLAP (time-consuming) one? Only a
 *  crossfade is. */
function segmentTransitionOverlaps(t: EdlSegment["transition"]): boolean {
  return !!t && t.type === "crossfade" && (t.durationMs ?? 0) > 0
}

/** Is this layout-transition an OVERLAP one? Only the `xfade:*` family
 *  (a real cross-source blend) — THE one rule, `speakerSwitchOverlaps`;
 *  `cut`/`pan`/`zoom` consume no output time. */
function layoutTransitionOverlaps(t: EdlLayout["transition"]): boolean {
  return !!t && speakerSwitchOverlaps(t.type) && (t.durationMs ?? 0) > 0
}

/** The overlap duration consumed at the boundary INTO this segment (D17).
 *  A segment may carry at most one of the two transition fields
 *  (validated), so we take whichever is present. */
function overlapMsInto(seg: EdlSegment): number {
  if (segmentTransitionOverlaps(seg.transition)) return seg.transition!.durationMs ?? 0
  if (layoutTransitionOverlaps(seg.layout?.transition)) return seg.layout!.transition!.durationMs ?? 0
  return 0
}

/** Rendered duration of the edit, in ms. Σ segment durations minus the
 *  overlap transitions (D17: an `xfade`/`crossfade` compresses the timeline
 *  by its duration per boundary; `cut`/`pan`/`zoom` do not). Total over BOTH
 *  the segment- and layout-transition fields.
 *
 *  Derived FROM `segmentOutputStarts` so the invariant
 *  `outputStart(last) + dur(last) === edlDurationMs` holds by construction on
 *  every input — including a normalized-but-not-yet-validated EDL (the reserve
 *  runs this before validate). The two must never be two independent overlap
 *  implementations that can drift. */
export function edlDurationMs(edl: Edl): number {
  const starts = segmentOutputStarts(edl)
  if (starts.length === 0) return 0
  const last = edl.segments[edl.segments.length - 1]
  return Math.max(0, Math.round(starts[starts.length - 1] + Math.max(0, last.outMs - last.inMs)))
}

/** The output-clock start time of each segment (index-aligned to
 *  `edl.segments`), accounting for D17 overlap: the transition INTO segment k
 *  pulls its duration back from the boundary. `outputStart(0) = 0`;
 *  `outputStart(n) + dur(n) === edlDurationMs`. */
function segmentOutputStarts(edl: Edl): number[] {
  const starts: number[] = []
  let cursor = 0
  edl.segments.forEach((seg, i) => {
    // The transition into THIS segment overlaps the previous one.
    if (i > 0) cursor -= overlapMsInto(seg)
    starts.push(Math.max(0, Math.round(cursor)))
    cursor += Math.max(0, seg.outMs - seg.inMs)
  })
  return starts
}

const inRange = (v: number, lo = 0, hi = 1) => v >= lo && v <= hi

function regionIssues(r: EdlRegion, where: string): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(r) as Array<[keyof EdlRegion, number]>) {
    if (!Number.isFinite(v) || !inRange(v)) out.push(`${where}: region.${k}=${v} out of 0..1`)
  }
  if (r.w <= 0 || r.h <= 0) out.push(`${where}: region has non-positive w/h`)
  if (r.x + r.w > 1 + 1e-9) out.push(`${where}: region extends past right edge (x+w>1)`)
  if (r.y + r.h > 1 + 1e-9) out.push(`${where}: region extends past bottom edge (y+h>1)`)
  return out
}

/** Library-produced (never construct one yourself — fields may be added). `ok` is `issues.length === 0`;
 *  warnings never flip it. Issues = facts intrinsic to the EDL. Warnings = judgements against a REGISTRY
 *  (source roles, speaker layouts/switches/emphasis, target aspects) that a newer version may widen — so an
 *  older validator never rejects a newer EDL. */
export interface EdlValidation {
  readonly ok: boolean
  readonly issues: readonly string[]
  readonly warnings: readonly string[]
}

/** Structural validation. Coercion (defaults, clamping) is `normalizeEdl`'s
 *  job; this reports what is still wrong after normalization. Segment ORDER is
 *  the output timeline order and is NOT required to be monotonic on the master
 *  clock — a legitimate multicam/clips EDL revisits earlier source time — so
 *  the only per-segment ordering rule is `outMs > inMs`.
 *
 *  The transition duration bound is the per-boundary ffmpeg-`xfade` limit: the
 *  blend must be shorter than the adjacent material, so we validate at
 *  `0.9 · min(the two adjacent segments)`. (combine-videos uses a more
 *  conservative GLOBAL `0.9 · min(all clips)`; the per-boundary bound here is
 *  the correct one, and the `apply-edl` executor must clamp per-boundary too —
 *  copying combine's global-min would let validate pass a transition the
 *  renderer then silently shortens, the R5 silent-edit this bound prevents.)
 *  It applies only to overlap transitions; `cut`/`pan`/`zoom` are unbounded. */
export function validateEdl(edl: Edl): EdlValidation {
  const issues: string[] = []
  const warnings: string[] = []

  // A public validator reports, it does not throw: guard a raw object that
  // skipped normalizeEdl (missing/typed-wrong sources/segments).
  if (!Array.isArray(edl.segments) || !Array.isArray(edl.sources)) {
    edl = {
      ...edl,
      sources: Array.isArray(edl.sources) ? edl.sources : [],
      segments: Array.isArray(edl.segments) ? edl.segments : [],
    }
  }

  if (edl.version !== EDL_VERSION) issues.push(`version must be ${EDL_VERSION}`)
  if (edl.clock !== "master" && edl.clock !== "output") issues.push(`clock must be "master" or "output"`)

  const sourceIds = new Set<string>()
  let masterAudioCount = 0
  for (const s of edl.sources) {
    if (sourceIds.has(s.id)) issues.push(`duplicate source id "${s.id}"`)
    sourceIds.add(s.id)
    if (!s.url || !s.url.trim()) issues.push(`source "${s.id}": url is empty (media resolves from url)`)
    if (s.role === "master-audio") masterAudioCount++
    else if (s.role != null && !KNOWN_SOURCE_ROLES.has(s.role)) {
      warnings.push(`source "${s.id}": unknown role "${s.role}" (known: ${EDL_SOURCE_ROLES.join(", ")})`)
    }
    if (s.region) issues.push(...regionIssues(s.region, `source "${s.id}"`))
    if (s.offsetMs !== undefined && !Number.isFinite(s.offsetMs)) issues.push(`source "${s.id}": offsetMs not finite`)
  }
  if (masterAudioCount > 1) issues.push(`more than one source has role:"master-audio" (${masterAudioCount})`)

  if (edl.segments.length === 0) issues.push("segments is empty")

  edl.segments.forEach((seg, i) => {
    const at = `segment[${i}] "${seg.id}"`
    if (!(seg.outMs > seg.inMs)) issues.push(`${at}: outMs (${seg.outMs}) must be > inMs (${seg.inMs})`)
    if (seg.inMs < 0) issues.push(`${at}: inMs negative`)
    if (seg.video && !sourceIds.has(seg.video)) issues.push(`${at}: video source "${seg.video}" not in sources`)
    else if (seg.video) {
      const vs = edl.sources.find(s => s.id === seg.video)
      if (vs && vs.kind !== "video") issues.push(`${at}: video source "${seg.video}" is kind:"${vs.kind}", must be video`)
    }
    if (seg.audio && !sourceIds.has(seg.audio)) issues.push(`${at}: audio source "${seg.audio}" not in sources`)
    // A segment with no explicit audio must have a fallback: a master-audio source or its own video.
    if (!seg.audio && masterAudioCount === 0 && !seg.video) {
      issues.push(`${at}: no audio source and no master-audio/video fallback`)
    }

    // Transition rules.
    if (i === 0 && (seg.transition || seg.layout?.transition)) {
      issues.push(`${at}: segments[0] cannot have a transition ("into this segment" has no predecessor)`)
    }
    if (seg.transition && seg.layout?.transition) {
      issues.push(`${at}: both EdlSegment.transition and EdlLayout.transition set (pick one)`)
    }
    // The 0.9·min(adjacent) bound is the ffmpeg-xfade constraint and applies
    // ONLY to overlap transitions (crossfade / xfade:*). `cut`/`pan`/`zoom`
    // consume no time (overlapMsInto === 0) and their durationMs is inert, so
    // they are never bounded here.
    const ov = overlapMsInto(seg)
    if (ov > 0 && i > 0) {
      const prev = edl.segments[i - 1]
      const minAdj = Math.min(seg.outMs - seg.inMs, prev.outMs - prev.inMs)
      if (ov > 0.9 * minAdj + 1e-9) {
        issues.push(`${at}: overlap transition durationMs (${ov}) exceeds 0.9·min(adjacent segment)=${(0.9 * minAdj).toFixed(1)} — ffmpeg xfade would error / be clamped`)
      }
    }

    // Region rules (D20).
    if (seg.region) {
      issues.push(...regionIssues(seg.region, at))
      if (seg.layout?.slots && seg.layout.slots.length > 1) {
        issues.push(`${at}: segment.region is invalid when the layout has >1 slot (put the region on the slot)`)
      }
    }

    // Layout slot rules.
    for (const slot of seg.layout?.slots ?? []) {
      if (!sourceIds.has(slot.source)) issues.push(`${at}: slot source "${slot.source}" not in sources`)
      else {
        const src = edl.sources.find(s => s.id === slot.source)
        if (src && src.kind !== "video") issues.push(`${at}: slot source "${slot.source}" is kind:"${src.kind}", slots must be video`)
      }
      if (slot.weight !== undefined && !inRange(slot.weight)) issues.push(`${at}: slot.weight=${slot.weight} out of 0..1`)
      if (slot.region) issues.push(...regionIssues(slot.region, `${at} slot "${slot.source}"`))
    }
  })

  // segments ∩ dropped = ∅ (on the master clock).
  for (const d of edl.dropped ?? []) {
    if (!(d.outMs > d.inMs)) issues.push(`dropped range [${d.inMs},${d.outMs}) is not positive`)
    for (const seg of edl.segments) {
      if (seg.inMs < d.outMs && d.inMs < seg.outMs) {
        issues.push(`dropped range [${d.inMs},${d.outMs}) overlaps kept segment "${seg.id}" [${seg.inMs},${seg.outMs})`)
        break
      }
    }
  }

  // Registry-class findings (layouts, switches, emphasis, target aspect).
  warnings.push(...speakerPresentationWarnings(edl))

  return { ok: issues.length === 0, issues, warnings }
}

/** Validate a clip set (the `clips` mode output). */
export function validateEdlClipSet(set: EdlClipSet): EdlValidation {
  const issues: string[] = []
  const warnings: string[] = []
  if (set.version !== EDL_VERSION) issues.push(`clipset version must be ${EDL_VERSION}`)
  if (set.clips.length === 0) issues.push("clipset has no clips")
  set.clips.forEach((clip, i) => {
    const r = validateEdl(clip)
    if (!r.ok) issues.push(...r.issues.map(m => `clip[${i}]: ${m}`))
    warnings.push(...r.warnings.map(m => `clip[${i}]: ${m}`))
  })
  return { ok: issues.length === 0, issues, warnings }
}

function offsetFor(edl: Edl, sourceId: string | undefined): number {
  if (!sourceId) return 0
  return edl.sources.find(s => s.id === sourceId)?.offsetMs ?? 0
}

/**
 * Map an instant on `sourceId`'s clock to the rendered output clock, or `null`
 * if that instant was dropped (falls in no kept segment). Applies the D19
 * offset (`masterMs = sourceMs + offsetMs`) and the D17 overlap compression.
 * `sourceId` omitted ⇒ the instant is already on the master clock.
 */
export function remapMsThroughEdl(edl: Edl, sourceMs: number, sourceId?: string): number | null {
  const masterMs = sourceMs + offsetFor(edl, sourceId)
  const starts = segmentOutputStarts(edl)
  for (let i = 0; i < edl.segments.length; i++) {
    const seg = edl.segments[i]
    if (masterMs >= seg.inMs && masterMs < seg.outMs) {
      return Math.round(starts[i] + (masterMs - seg.inMs))
    }
  }
  return null
}

/**
 * Remap a transcript onto the rendered output: drop words that fall entirely
 * in removed material, clip a word that straddles a cut to its kept part, and
 * apply the source offset (via `transcript.sourceId`). Captions, chapters and
 * clip offsets all depend on this one function.
 */
export function remapTranscriptThroughEdl(edl: Edl, transcript: Transcript): Transcript {
  const off = offsetFor(edl, transcript.sourceId)
  const starts = segmentOutputStarts(edl)

  const mapWord = (w: Transcript["words"][number]): (Transcript["words"][number]) | null => {
    const startMaster = w.startMs + off
    const endMaster = w.endMs + off
    // A zero-width word is a point: keep it if the instant is kept (consistent
    // with remapMsThroughEdl, which returns non-null for a kept instant).
    if (startMaster === endMaster) {
      for (let i = 0; i < edl.segments.length; i++) {
        const seg = edl.segments[i]
        if (startMaster >= seg.inMs && startMaster < seg.outMs) {
          const out = Math.round(starts[i] + (startMaster - seg.inMs))
          return { ...w, startMs: out, endMs: out }
        }
      }
      return null
    }
    // Find the first kept segment that intersects [startMaster, endMaster) and
    // clip the word to that kept part.
    for (let i = 0; i < edl.segments.length; i++) {
      const seg = edl.segments[i]
      const lo = Math.max(startMaster, seg.inMs)
      const hi = Math.min(endMaster, seg.outMs)
      if (lo < hi) {
        return {
          ...w,
          startMs: Math.round(starts[i] + (lo - seg.inMs)),
          endMs: Math.round(starts[i] + (hi - seg.inMs)),
        }
      }
    }
    return null
  }

  const words: Transcript["words"][number][] = []
  for (const w of transcript.words) {
    const mapped = mapWord(w)
    if (mapped) words.push(mapped)
  }

  // A transcript SEGMENT (chapter-ish span) can straddle a cut and/or several
  // kept ranges. Take the ENVELOPE of every kept intersection: the earliest
  // kept output start to the latest kept output end. Endpoint-probing (map
  // start and end independently) inverts across a crossfade and collapses a
  // straddler to ~1ms; the envelope avoids both.
  const mapSegment = (s: NonNullable<Transcript["segments"]>[number]) => {
    const startMaster = s.startMs + off
    const endMaster = s.endMs + off
    let outLo: number | null = null
    let outHi: number | null = null
    for (let i = 0; i < edl.segments.length; i++) {
      const seg = edl.segments[i]
      const lo = Math.max(startMaster, seg.inMs)
      const hi = Math.min(endMaster, seg.outMs)
      if (lo < hi) {
        const a = Math.round(starts[i] + (lo - seg.inMs))
        const b = Math.round(starts[i] + (hi - seg.inMs))
        if (outLo === null || a < outLo) outLo = a
        if (outHi === null || b > outHi) outHi = b
      }
    }
    if (outLo === null || outHi === null) return null
    return { ...s, startMs: outLo, endMs: outHi }
  }

  const segments = transcript.segments
    ?.map(mapSegment)
    .filter((s): s is NonNullable<typeof s> => s !== null)

  return { ...transcript, words, ...(segments ? { segments } : {}) }
}

/** Speaker turns: consecutive same-speaker words merged across gaps shorter
 *  than `mergeGapMs`, then turns shorter than `minTurnMs` dropped. */
export function speakerTurns(
  transcript: Transcript,
  opts: { minTurnMs: number; mergeGapMs: number },
): Array<{ speaker: string; startMs: number; endMs: number }> {
  const turns: Array<{ speaker: string; startMs: number; endMs: number }> = []
  for (const w of transcript.words) {
    const speaker = w.speaker ?? "spk"
    const last = turns[turns.length - 1]
    if (last && last.speaker === speaker && w.startMs - last.endMs <= opts.mergeGapMs) {
      last.endMs = Math.max(last.endMs, w.endMs)
    } else {
      turns.push({ speaker, startMs: w.startMs, endMs: w.endMs })
    }
  }
  return turns.filter(t => t.endMs - t.startMs >= opts.minTurnMs)
}

// ─────────────────────────────────────────────────────────────────────────
//  Normalization (coerce, never reject; runs at every write site)
// ─────────────────────────────────────────────────────────────────────────

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

function normalizeRegion(r: unknown): EdlRegion | undefined {
  if (!r || typeof r !== "object") return undefined
  const o = r as Record<string, unknown>
  if (["x", "y", "w", "h"].some(k => typeof o[k] !== "number")) return undefined
  const x = clamp01(num(o.x))
  const y = clamp01(num(o.y))
  // Fit the box inside the frame so the result always passes validateEdl
  // (per-axis clamping alone can leave x+w>1). A degenerate box is dropped.
  const w = Math.min(clamp01(num(o.w)), 1 - x)
  const h = Math.min(clamp01(num(o.h)), 1 - y)
  if (w <= 0 || h <= 0) return undefined
  return { x, y, w, h }
}

/**
 * Coerce an unknown value into a well-formed `Edl`: fill defaults, drop unknown
 * fields, clamp regions to 0..1. All times are integer ms — there is NO
 * seconds→ms guessing (an integer-seconds EDL would silently become a
 * 1000×-longer edit; the contract is ms-only and a value that cannot be a
 * plausible ms EDL is a validation error, not a reinterpretation).
 *
 * Segment ORDER is preserved verbatim: it is the output timeline order, and a
 * multicam/clips EDL legitimately revisits earlier source time, so re-sorting
 * would corrupt it. (`dropped` has no ordering semantics and is left as-is.)
 */
export function normalizeEdl(input: unknown): Edl {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>

  const sources: EdlSource[] = Array.isArray(o.sources)
    ? o.sources.map((raw, i) => {
        const s = (raw ?? {}) as Record<string, unknown>
        const src: EdlSource = {
          id: str(s.id) ?? `src-${i}`,
          url: str(s.url) ?? "",
          kind: s.kind === "audio" ? "audio" : "video",
          ...(s.offsetMs !== undefined ? { offsetMs: Math.round(num(s.offsetMs)) } : {}),
          ...(str(s.role) ? { role: s.role as EdlSource["role"] } : {}),
          ...(Array.isArray(s.speakers) ? { speakers: s.speakers.filter((x): x is string => typeof x === "string") } : {}),
          ...(normalizeRegion(s.region) ? { region: normalizeRegion(s.region) } : {}),
        }
        return src
      })
    : []

  const segments: EdlSegment[] = Array.isArray(o.segments)
    ? o.segments.map((raw, i) => {
        const s = (raw ?? {}) as Record<string, unknown>
        const region = normalizeRegion(s.region)
        // A transition "into" segments[0] carries no information (no
        // predecessor), so strip it here rather than letting validateEdl 400 a
        // fixable EDL — LLM/hand-written EDLs routinely attach one to every
        // segment. Same for a layout transition on the first segment.
        const isFirst = i === 0
        const t = isFirst ? undefined : (s.transition as Record<string, unknown> | undefined)
        const layout = normalizeLayout(s.layout, isFirst)
        const seg: EdlSegment = {
          id: str(s.id) ?? `seg-${i}`,
          inMs: Math.round(num(s.inMs)),
          outMs: Math.round(num(s.outMs)),
          ...(str(s.video) ? { video: str(s.video) } : {}),
          ...(str(s.audio) ? { audio: str(s.audio) } : {}),
          ...(str(s.speaker) ? { speaker: str(s.speaker) } : {}),
          ...(t && (t.type === "cut" || t.type === "crossfade")
            ? { transition: { type: t.type as "cut" | "crossfade", durationMs: t.type === "cut" ? 0 : Math.round(num(t.durationMs)) } }
            : {}),
          ...(region ? { region } : {}),
          ...(layout ? { layout } : {}),
          ...(Array.isArray(s.labels) ? { labels: s.labels.filter((x): x is string => typeof x === "string") } : {}),
        }
        return seg
      })
    : []

  const dropped: EdlDropped[] | undefined = Array.isArray(o.dropped)
    ? o.dropped.map(raw => {
        const d = (raw ?? {}) as Record<string, unknown>
        return { inMs: Math.round(num(d.inMs)), outMs: Math.round(num(d.outMs)), reason: str(d.reason) ?? "manual" }
      })
    : undefined

  const meta = o.meta && typeof o.meta === "object" ? (o.meta as Edl["meta"]) : undefined

  return {
    version: EDL_VERSION,
    clock: o.clock === "output" ? "output" : "master",
    sources,
    segments,
    ...(dropped ? { dropped } : {}),
    ...(o.derivedFrom && typeof o.derivedFrom === "object"
      ? { derivedFrom: { edlId: str((o.derivedFrom as Record<string, unknown>).edlId) ?? "", clock: "output" } }
      : {}),
    ...(meta ? { meta } : {}),
  }
}

function normalizeLayout(input: unknown, dropTransition = false): EdlLayout | undefined {
  if (!input || typeof input !== "object") return undefined
  const o = input as Record<string, unknown>
  // Default the mode to "single" rather than dropping the whole layout — a
  // layout with slots/transition but no mode would otherwise lose them (and an
  // omitted xfade would silently lengthen the timeline).
  const mode = str(o.mode) || "single"
  const slots = Array.isArray(o.slots)
    ? o.slots
        .map(raw => {
          const s = (raw ?? {}) as Record<string, unknown>
          const source = str(s.source)
          if (!source) return null
          const region = normalizeRegion(s.region)
          return {
            source,
            ...(region ? { region } : {}),
            ...(str(s.speaker) ? { speaker: str(s.speaker) } : {}),
            ...(s.weight !== undefined ? { weight: clamp01(num(s.weight)) } : {}),
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    : undefined
  const emphasis = o.emphasis && typeof o.emphasis === "object"
    ? { style: str((o.emphasis as Record<string, unknown>).style) ?? "none", durationMs: Math.round(num((o.emphasis as Record<string, unknown>).durationMs)) }
    : undefined
  const transition = !dropTransition && o.transition && typeof o.transition === "object"
    ? { type: str((o.transition as Record<string, unknown>).type) ?? "cut", durationMs: Math.round(num((o.transition as Record<string, unknown>).durationMs)) }
    : undefined
  return {
    mode,
    ...(slots ? { slots } : {}),
    ...(emphasis ? { emphasis } : {}),
    ...(transition ? { transition } : {}),
  }
}

/** Coerce an unknown value into a `Transcript`. ms-only, same rule as `normalizeEdl`. */
export function normalizeTranscript(input: unknown): Transcript {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const words: Transcript["words"][number][] = Array.isArray(o.words)
    ? o.words.map(raw => {
        const w = (raw ?? {}) as Record<string, unknown>
        const startMs = Math.round(num(w.startMs))
        return {
          text: str(w.text) ?? "",
          startMs,
          // Never inverted: an endMs < startMs (garbage upstream) would be
          // silently dropped at remap; clamp it to a non-negative width.
          endMs: Math.max(startMs, Math.round(num(w.endMs))),
          ...(str(w.speaker) ? { speaker: str(w.speaker) } : {}),
          ...(typeof w.confidence === "number" ? { confidence: w.confidence } : {}),
        }
      })
    : []
  const segments = Array.isArray(o.segments)
    ? o.segments.map(raw => {
        const s = (raw ?? {}) as Record<string, unknown>
        const startMs = Math.round(num(s.startMs))
        return { startMs, endMs: Math.max(startMs, Math.round(num(s.endMs))), text: str(s.text) ?? "", ...(str(s.speaker) ? { speaker: str(s.speaker) } : {}) }
      })
    : undefined
  return {
    version: EDL_VERSION,
    ...(str(o.sourceId) ? { sourceId: str(o.sourceId) } : {}),
    ...(str(o.language) ? { language: str(o.language) } : {}),
    words,
    ...(segments ? { segments } : {}),
  }
}
