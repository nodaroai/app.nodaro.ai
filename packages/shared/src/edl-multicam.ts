/**
 * Multicam helpers over the EDL contract (`edl.ts`): folding measured source
 * offsets into an EDL (D19) and resolving what each on-screen slot of a
 * segment shows (D20). Pure — no I/O. Type-only imports from `edl.ts` keep the
 * module graph free of runtime cycles.
 */
import type { Edl, EdlRegion, EdlSegment, EdlSource } from "./edl.js"

// ─────────────────────────────────────────────────────────────────────────
//  D19 — source offsets
// ─────────────────────────────────────────────────────────────────────────

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** audio-sync → EDL source offsets (D19: masterMs = sourceMs + offsetMs).
 *  `offsets` are measured against ONE common reference (audio-sync's `reference`, which need not be the master).
 *  ANCHORED SET: anchor = opts.anchor ?? the unique role:"master-audio" source ?? none.
 *   - The anchor's own offsetMs is NEVER changed (the segments are on its clock).
 *   - Every other provided source s: offsetMs = round((anchor.offsetMs ?? 0) + offsets[s] − (offsets[anchor] ?? 0)).
 *   - No anchor: offsetMs = round(offsets[s]) verbatim (offsets already relative to the master clock).
 *  SET, never ADD (re-running is idempotent). Returns a new Edl; never mutates; never throws.
 *  `ignored[].reason` is a documented open string: "unknown-source" | "not-finite" | "anchor-unknown" | "anchor-not-finite".
 *  opts.anchor not in edl.sources → NOTHING applied, ignored = [{ sourceId: anchor, reason: "anchor-unknown" }].
 *  offsets[anchor] present but non-finite → NOTHING applied, ignored = [{ sourceId: anchor, reason: "anchor-not-finite" }]. */
export function mergeEdlSourceOffsets(
  edl: Edl,
  offsets: Readonly<Record<string, number>>,
  opts?: { readonly anchor?: string },
): {
  readonly edl: Edl
  /** The source the offsets were anchored to — present whenever one resolved (it exists in `edl.sources`). */
  readonly anchor?: string
  /** Source ids whose `offsetMs` was set, in `offsets` key order. */
  readonly applied: readonly string[]
  readonly ignored: ReadonlyArray<{ readonly sourceId: string; readonly reason: string }>
} {
  const sources: readonly EdlSource[] = Array.isArray(edl?.sources) ? edl.sources : []
  const rows: Readonly<Record<string, unknown>> = offsets && typeof offsets === "object" ? offsets : {}
  const byId = new Map<string, EdlSource>()
  for (const s of sources) if (s && typeof s === "object" && !byId.has(s.id)) byId.set(s.id, s)

  let anchor: string | undefined
  if (opts?.anchor !== undefined) {
    if (!byId.has(opts.anchor)) {
      return { edl: { ...edl }, applied: [], ignored: [{ sourceId: opts.anchor, reason: "anchor-unknown" }] }
    }
    anchor = opts.anchor
  } else {
    const masters = sources.filter((s) => s && typeof s === "object" && s.role === "master-audio")
    if (masters.length === 1) anchor = masters[0].id
  }

  // The anchor's own measurement is the rebase point; an absent one reads as 0.
  let reference = 0
  if (anchor !== undefined && hasOwn(rows, anchor)) {
    const a = rows[anchor]
    if (!isFiniteNumber(a)) {
      return { edl: { ...edl }, anchor, applied: [], ignored: [{ sourceId: anchor, reason: "anchor-not-finite" }] }
    }
    reference = a
  }
  const anchorOffsetMs = anchor !== undefined ? (byId.get(anchor)?.offsetMs ?? 0) : 0

  const next = new Map<string, number>()
  const applied: string[] = []
  const ignored: Array<{ sourceId: string; reason: string }> = []
  for (const sourceId of Object.keys(rows)) {
    if (sourceId === anchor) continue // never changed: the segments are on its clock
    if (!byId.has(sourceId)) {
      ignored.push({ sourceId, reason: "unknown-source" })
      continue
    }
    const measured = rows[sourceId]
    const offsetMs = isFiniteNumber(measured)
      ? Math.round(anchor !== undefined ? anchorOffsetMs + measured - reference : measured)
      : Number.NaN
    // A non-finite result (the measurement, or a non-finite anchor offsetMs it
    // is rebased onto) is never written.
    if (!Number.isFinite(offsetMs)) {
      ignored.push({ sourceId, reason: "not-finite" })
      continue
    }
    next.set(sourceId, offsetMs)
    applied.push(sourceId)
  }

  const merged: Edl = Array.isArray(edl?.sources)
    ? { ...edl, sources: edl.sources.map((s) => (s && typeof s === "object" && next.has(s.id) ? { ...s, offsetMs: next.get(s.id)! } : s)) }
    : { ...edl }
  return { edl: merged, ...(anchor !== undefined ? { anchor } : {}), applied, ignored }
}

// ─────────────────────────────────────────────────────────────────────────
//  B4 — audio-sync offsets onto a planner's sources
// ─────────────────────────────────────────────────────────────────────────

/** Below this, a measured offset is not trusted (audio-sync's own
 *  "check it by ear" line). */
export const AUDIO_SYNC_MIN_CONFIDENCE = 0.5

/** One source row as a planner (edit-plan) sends it. */
export interface AudioSyncOffsetSource {
  readonly id: string
  readonly role?: string
  /** Set = a hand-set offset, which always wins over a measured one. */
  readonly offsetMs?: number
}

/** Why measured offsets could not be applied. Every code names the source to
 *  fix, so a caller can phrase it with its own label (`describeAudioSyncOffsetIssue`). */
export type AudioSyncOffsetIssue =
  | { readonly code: "not-audio-sync" }
  | { readonly code: "invalid-offset"; readonly sourceId: string }
  | { readonly code: "anchor-offset"; readonly sourceId: string; readonly offsetMs: number }
  | { readonly code: "anchor-unmeasured"; readonly sourceId: string }
  | { readonly code: "weak-match"; readonly sourceId: string; readonly confidence: number; readonly anchor: boolean }
  | { readonly code: "unmeasured"; readonly sourceId: string }

export type AudioSyncOffsetsResult<S> =
  | {
      readonly ok: true
      /** The sources, with the measured offsets written onto `offsetMs`. */
      readonly sources: S[]
      /** The source whose clock the offsets are anchored to. */
      readonly anchor?: string
      /** Source ids that took a measured offset. */
      readonly applied: readonly string[]
    }
  | { readonly ok: false; readonly issues: readonly AudioSyncOffsetIssue[] }

interface SyncRow { readonly offsetMs: number; readonly confidence: number }

/** audio-sync's result (an object, or the JSON string a canvas handle carries)
 *  → its rows by source id, the reference included; null when it is not one. */
function readAudioSyncRows(sync: unknown): Map<string, SyncRow> | null {
  let value = sync
  if (typeof value === "string") {
    try { value = JSON.parse(value) } catch { return null }
  }
  if (!value || typeof value !== "object") return null
  const { reference, offsets } = value as { reference?: unknown; offsets?: unknown }
  if (!Array.isArray(offsets)) return null
  const rows = new Map<string, SyncRow>()
  for (const row of offsets) {
    if (!row || typeof row !== "object") return null
    const { sourceId, offsetMs, confidence } = row as Record<string, unknown>
    if (typeof sourceId !== "string" || !isFiniteNumber(offsetMs)) return null
    if (!rows.has(sourceId)) rows.set(sourceId, { offsetMs, confidence: isFiniteNumber(confidence) ? confidence : 0 })
  }
  // The reference is measured by definition (its own offset is 0).
  if (typeof reference === "string" && reference && !rows.has(reference)) rows.set(reference, { offsetMs: 0, confidence: 1 })
  return rows
}

const handSet = (s: AudioSyncOffsetSource): boolean => isFiniteNumber(s.offsetMs)

/** The source whose clock a planner's plan is on: the `master-audio` source,
 *  else the first (edit-plan's `masterProbeSource`). */
function plannerClockSource<S extends AudioSyncOffsetSource>(sources: readonly S[]): S | undefined {
  return sources.find((s) => s.role === "master-audio") ?? sources[0]
}

/** B4 — audio-sync's measured offsets → a planner's `sources[].offsetMs`
 *  (decided 2026-09-25). The planner makes its plan on its MASTER's clock:
 *  the `master-audio` source, else its first source (edit-plan's own rule) —
 *  the ANCHOR. Every other source gets `offsetMs = measured(s) − measured(anchor)`
 *  (D19 via `mergeEdlSourceOffsets`), so audio-sync's reference need not be the
 *  master. Never out of sync silently — each of these is an issue instead:
 *   - a source with a hand-set `offsetMs` keeps it (it always wins);
 *   - a source audio-sync did not measure → "unmeasured";
 *   - a measured source under `AUDIO_SYNC_MIN_CONFIDENCE` → "weak-match";
 *   - the anchor unmeasured / weak, when any source needs it → "anchor-…";
 *   - a hand-set non-zero offset on the anchor → "anchor-offset" (its clock is the plan's).
 *  Rows for sources the planner does not have are ignored. Pure; never throws. */
export function applyAudioSyncOffsets<S extends AudioSyncOffsetSource>(
  sources: readonly S[],
  sync: unknown,
): AudioSyncOffsetsResult<S> {
  const rows = readAudioSyncRows(sync)
  if (!rows) return { ok: false, issues: [{ code: "not-audio-sync" }] }
  const list = Array.isArray(sources) ? sources.filter((s): s is S => !!s && typeof s === "object") : []
  const anchor = plannerClockSource(list)
  if (!anchor) return { ok: true, sources: [...list], applied: [] }

  const issues: AudioSyncOffsetIssue[] = []
  // A hand-set offset that is not a number (a "500" from a JSON file) would
  // otherwise be read as absent, or summed as a string.
  for (const s of list) if (s.offsetMs !== undefined && !handSet(s)) issues.push({ code: "invalid-offset", sourceId: s.id })
  if (handSet(anchor) && anchor.offsetMs !== 0) {
    issues.push({ code: "anchor-offset", sourceId: anchor.id, offsetMs: anchor.offsetMs! })
  }
  const measured: Record<string, number> = {}
  for (const s of list) {
    if (s.id === anchor.id || handSet(s)) continue
    const row = rows.get(s.id)
    if (!row) issues.push({ code: "unmeasured", sourceId: s.id })
    else if (!(row.confidence >= AUDIO_SYNC_MIN_CONFIDENCE)) issues.push({ code: "weak-match", sourceId: s.id, confidence: row.confidence, anchor: false })
    else measured[s.id] = row.offsetMs
  }
  // The anchor's own measurement is the rebase point — needed only when some
  // source takes a measured offset.
  if (Object.keys(measured).length > 0) {
    const row = rows.get(anchor.id)
    if (!row) issues.push({ code: "anchor-unmeasured", sourceId: anchor.id })
    else if (!(row.confidence >= AUDIO_SYNC_MIN_CONFIDENCE)) issues.push({ code: "weak-match", sourceId: anchor.id, confidence: row.confidence, anchor: true })
    else measured[anchor.id] = row.offsetMs
  }
  if (issues.length > 0) return { ok: false, issues }
  if (Object.keys(measured).length === 0) return { ok: true, sources: [...list], anchor: anchor.id, applied: [] }

  // One arithmetic implementation: the D19 anchored SET.
  const pseudo = { version: 1, clock: "master", sources: list, segments: [] } as unknown as Edl
  const merged = mergeEdlSourceOffsets(pseudo, measured, { anchor: anchor.id })
  const byId = new Map(merged.edl.sources.map((s) => [s.id, s.offsetMs]))
  const applied = new Set(merged.applied)
  return {
    ok: true,
    sources: list.map((s) => (applied.has(s.id) ? { ...s, offsetMs: byId.get(s.id)! } : s)),
    anchor: anchor.id,
    applied: merged.applied,
  }
}

/** Why edit-plan's sources cannot be planned as given: an audio-sync issue,
 *  or a transcript made from a recording that is off the plan's clock. */
export type EditPlanSourceIssue =
  | AudioSyncOffsetIssue
  | { readonly code: "transcript-off-clock"; readonly sourceId: string; readonly masterId: string; readonly offsetMs: number }

/** B4 — the ONE check every edit-plan caller runs before dispatch (the
 *  orchestrator, the editor, MCP, the SDK), so a plan that would render out of
 *  sync fails before charging (decided 2026-09-25):
 *   - `offsets` given (audio-sync's result; null/"" when wired but empty) →
 *     `applyAudioSyncOffsets`;
 *   - the master's own offset must be 0 (the plan follows its clock);
 *   - `transcriptSourceId` (the recording the transcript was made from, when
 *     known) must be on the master's clock: the master itself, or a source
 *     whose offset is 0. Unknown → assumed the master's.
 *  `transcriptSourceId` is echoed back only when it names one of the sources,
 *  for the caller to stamp on the transcript. Pure; never throws. */
export function resolveEditPlanSources<S extends AudioSyncOffsetSource>(
  sources: readonly S[],
  opts: { readonly offsets?: unknown; readonly transcriptSourceId?: string } = {},
):
  | { readonly ok: true; readonly sources: S[]; readonly transcriptSourceId?: string }
  | { readonly ok: false; readonly issues: readonly EditPlanSourceIssue[] } {
  const list = Array.isArray(sources) ? sources.filter((s): s is S => !!s && typeof s === "object") : []
  const anchor = plannerClockSource(list)
  const issues: EditPlanSourceIssue[] = []
  let planned: S[] = [...list]
  if (opts.offsets !== undefined) {
    const synced = applyAudioSyncOffsets(list, opts.offsets)
    if (synced.ok) planned = synced.sources
    else issues.push(...synced.issues)
  } else {
    for (const s of list) if (s.offsetMs !== undefined && !handSet(s)) issues.push({ code: "invalid-offset", sourceId: s.id })
    if (anchor && handSet(anchor) && anchor.offsetMs !== 0) {
      issues.push({ code: "anchor-offset", sourceId: anchor.id, offsetMs: anchor.offsetMs! })
    }
  }
  const spoken = opts.transcriptSourceId ? planned.find((s) => s.id === opts.transcriptSourceId) : undefined
  if (spoken && anchor && spoken.id !== anchor.id && handSet(spoken) && spoken.offsetMs !== 0) {
    issues.push({ code: "transcript-off-clock", sourceId: spoken.id, masterId: anchor.id, offsetMs: spoken.offsetMs! })
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, sources: planned, ...(spoken ? { transcriptSourceId: spoken.id } : {}) }
}

/** The recording a transcript was made from, traced on a canvas: the node
 *  feeding the transcribing node, through clock-preserving hops (extract-audio).
 *  Undefined when the producer is not a transcriber or the trace is ambiguous
 *  (more than one upstream) — the caller then assumes the master's clock. */
export function editPlanTranscriptOrigin(
  producerId: string,
  typeOf: (nodeId: string) => string | undefined,
  edges: ReadonlyArray<{ readonly source: string; readonly target: string }>,
): string | undefined {
  if (typeOf(producerId) !== "transcribe") return undefined
  let current = producerId
  for (let hop = 0; hop < 4; hop++) {
    const upstream = [...new Set(edges.filter((e) => e.target === current).map((e) => e.source))]
    if (upstream.length !== 1) return undefined
    const up = upstream[0]!
    if (typeOf(up) !== "extract-audio") return up
    current = up
  }
  return undefined
}

/** A plain-language line for one issue; `labelOf` turns a source id into the
 *  name the user sees (a canvas node's label, say). */
export function describeAudioSyncOffsetIssue(issue: EditPlanSourceIssue, labelOf: (sourceId: string) => string = (id) => id): string {
  switch (issue.code) {
    case "transcript-off-clock":
      return `the transcript was made from "${labelOf(issue.sourceId)}", which is ${issue.offsetMs} ms off the master "${labelOf(issue.masterId)}" — the plan follows the master's clock, so transcribe "${labelOf(issue.masterId)}", or mark "${labelOf(issue.sourceId)}" as master audio`
    case "not-audio-sync":
      return "the offsets carry no Audio Sync result — pass its job's output_data.json (on the canvas: connect Audio Sync's Offsets output and run it)"
    case "invalid-offset":
      return `the offset set on "${labelOf(issue.sourceId)}" is not a number of milliseconds`
    case "anchor-offset":
      return `"${labelOf(issue.sourceId)}" is the master (the plan follows its clock), so its offset must be 0, not ${issue.offsetMs} ms`
    case "anchor-unmeasured":
      return `audio-sync did not measure "${labelOf(issue.sourceId)}", the master the other sources are timed against — add it to audio-sync's sources`
    case "weak-match":
      return issue.anchor
        ? `audio-sync's match for "${labelOf(issue.sourceId)}", the master the other sources are timed against, is too weak to trust (confidence ${issue.confidence}; ${AUDIO_SYNC_MIN_CONFIDENCE} needed) — set the other sources' offsets by hand, or mark a better-recorded source as master audio`
        : `audio-sync's match for "${labelOf(issue.sourceId)}" is too weak to trust (confidence ${issue.confidence}; ${AUDIO_SYNC_MIN_CONFIDENCE} needed) — set its offset by hand`
    case "unmeasured":
      return `"${labelOf(issue.sourceId)}" was not measured by audio-sync — wire it into audio-sync, or set its offset by hand (0 if it started with the master)`
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  D20 — slot resolution
// ─────────────────────────────────────────────────────────────────────────

export const EDL_FULL_FRAME: EdlRegion = Object.freeze({ x: 0, y: 0, w: 1, h: 1 })

export interface EdlResolvedSlot {
  readonly source: string
  readonly region: EdlRegion
  /** "resolver" = the caller's `regionFor` (v3 per-segment tracks). */
  readonly regionFrom: "slot" | "segment" | "resolver" | "speaker" | "source" | "full"
  readonly speaker?: string
  readonly weight?: number
}

export interface ResolveEdlSlotsOptions {
  /** speaker-view's per-speaker framing table (a node SETTING, not an EDL field), keyed by (source, speaker) so a
   *  wide-shot region never lands on a close-up camera framing the same person. */
  readonly speakerRegions?: ReadonlyArray<{ readonly source: string; readonly speaker: string; readonly region: EdlRegion }>
  /** v3 hook: a per-(segment, slot) region, e.g. from a face track. Undefined = no opinion. */
  readonly regionFor?: (q: { readonly segment: EdlSegment; readonly source: string; readonly speaker?: string }) => EdlRegion | undefined
}

/** A valid in-frame box: finite, 0..1, w/h > 0, x+w ≤ 1, y+h ≤ 1 — with the
 *  same edge tolerance `validateEdl` accepts, so the two never disagree. */
function isInFrameRegion(r: unknown): r is EdlRegion {
  if (!r || typeof r !== "object") return false
  const { x, y, w, h } = r as Record<string, unknown>
  for (const v of [x, y, w, h]) if (!isFiniteNumber(v) || v < 0 || v > 1) return false
  const box = r as EdlRegion
  return box.w > 0 && box.h > 0 && box.x + box.w <= 1 + 1e-9 && box.y + box.h <= 1 + 1e-9
}

type Rung = EdlResolvedSlot["regionFrom"]

/** D20 — the ONE region-precedence implementation:
 *  slot.region ▷ segment.region (single-slot only) ▷ regionFor ▷ speakerRegions[(source, speaker)] ▷ source.region ▷ full frame.
 *  Slots = layout.slots when non-empty, else ONE implicit slot from segment.video (no video → []).
 *  A slot's speaker = slot.speaker ?? (single slot ? segment.speaker : undefined); no speaker → the speaker rung is skipped.
 *  A rung whose region is not a valid in-frame box (finite, 0..1, w/h > 0, x+w ≤ 1, y+h ≤ 1) falls through to the next.
 *  Unknown source id → the source rung is skipped. Pure; never throws on its own. */
export function resolveEdlSegmentSlots(edl: Edl, segment: EdlSegment, opts?: ResolveEdlSlotsOptions): readonly EdlResolvedSlot[] {
  if (!segment || typeof segment !== "object") return []
  const sources: readonly EdlSource[] = Array.isArray(edl?.sources) ? edl.sources : []
  const layoutSlots = Array.isArray(segment.layout?.slots) ? segment.layout!.slots! : []
  const slots: NonNullable<NonNullable<EdlSegment["layout"]>["slots"]> =
    layoutSlots.length > 0
      ? layoutSlots
      : typeof segment.video === "string" && segment.video
        ? [{ source: segment.video }]
        : []
  const single = slots.length === 1

  const out: EdlResolvedSlot[] = []
  for (const slot of slots) {
    if (!slot || typeof slot !== "object") continue
    const source = slot.source
    const speaker = slot.speaker ?? (single ? segment.speaker : undefined)

    // Each rung is evaluated lazily, top-down; the first valid box wins.
    const rungs: ReadonlyArray<readonly [Rung, () => unknown]> = [
      ["slot", () => slot.region],
      ["segment", () => (single ? segment.region : undefined)],
      ["resolver", () => opts?.regionFor?.({ segment, source, ...(speaker !== undefined ? { speaker } : {}) })],
      ["speaker", () =>
        speaker === undefined
          ? undefined
          : Array.isArray(opts?.speakerRegions)
            ? opts.speakerRegions.find((row) => row && row.source === source && row.speaker === speaker)?.region
            : undefined],
      ["source", () => sources.find((s) => s && typeof s === "object" && s.id === source)?.region],
    ]
    let region: EdlRegion = EDL_FULL_FRAME
    let regionFrom: Rung = "full"
    for (const [from, read] of rungs) {
      const candidate = read()
      if (isInFrameRegion(candidate)) {
        region = candidate
        regionFrom = from
        break
      }
    }
    out.push({
      source,
      region,
      regionFrom,
      ...(speaker !== undefined ? { speaker } : {}),
      ...(slot.weight !== undefined ? { weight: slot.weight } : {}),
    })
  }
  return out
}
