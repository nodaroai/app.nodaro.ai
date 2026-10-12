/**
 * Speaker View v3 in the app (P3.9): the face tracks a render reads, as both
 * engines, the editor's badge and the region editor read them. Pure.
 *
 * WHAT TRAVELS (P3-22 (a); round 2, decided 2026-10-09): Speaker Frames'
 * output DESCRIPTOR — the set without its boxes, plus the stored body's url,
 * sha256 and bytes. The plugin fetches the body and checks it; the box body is
 * never sent inline.
 *
 * WHOSE LABELS (round 3, decided 2026-10-09): the labels the app sends
 * override the stored file's, matched by track id; everything structural must
 * still match the file. The app's labels are, in this order:
 *  1. the CURRENT rename map (Camera Switch's `speakerNames` on the transcript
 *     Speaker View reads): an attributed track's raw label re-maps to today's
 *     display name, so a rename after Speaker Frames ran does not orphan it
 *     (P3-4 "Labels and the name space");
 *  2. the manual corrections on the Speaker Frames node (`trackAssignments`,
 *     P3-18 (a)) — a correction always wins, and one whose track a re-run no
 *     longer has is listed, never dropped. A correction keeps the raw label
 *     behind the name it was saved with (`rawSpeaker`), so its speaker too is
 *     resolved through the current rename map;
 *  3. the read-time region match (P3-21 (a)): an unattributed, uncorrected
 *     track whose median centre lies inside exactly ONE drawn region of its own
 *     camera takes that region's speaker. Default thirds never label (P3-4
 *     rung 2; decided 2026-10-10): the region editor marks the rows it saved
 *     as untouched defaults (`defaultRegionKeys`), and a row exactly equal to
 *     the default thirds counts as a default too (older saves, API and MCP
 *     writes); only the others count as drawn. This rung needs the boxes, so
 *     it runs only where the body was fetched.
 *
 * WHEN TRACKS ARE STALE (P3-20 (a); its split decided 2026-10-09): by
 * coverage, never by the edit's fingerprint. The plugin refuses only a camera
 * a non-pinned slot follows that the tracks never sampled (mirrored in the
 * rule). Whether such a camera changed FILE or OFFSET since Speaker Frames
 * ran is the app's check, read from the Speaker Frames job's own inputs
 * (`speakerViewTracksProvenanceIssues`); it covers the same cameras as the
 * no-coverage refusal (decided 2026-10-10): a camera only region-pinned slots
 * show renders from its static region and never reads its tracks.
 *
 * WHERE THE TRACKS COME FROM: the `tracks` wire only (§5: no tracks wired →
 * v1 exactly). A wire whose Speaker Frames has no output — it failed, or a
 * single Run reached Speaker View before it ran — is refused, never rendered
 * as v1 (`SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE`). Render final reads the
 * saved tracks and never re-runs Speaker Frames (P3-20 (i); `renderFinalRunSet`).
 */
import {
  normalizeSpeakerTrackSetDescriptor,
  normalizeSpeakerTracks,
  normalizeTranscript,
  resolveEdlSegmentSlots,
  validateSpeakerTrackSetDescriptor,
  type Edl,
  type EdlRegion,
  type ResolveEdlSlotsOptions,
  type SpeakerTrackSet,
  type SpeakerTrackSetDescriptor,
} from "@nodaro/shared"
import { applySpeakerTrackAssignments, SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID, type SpeakerTrackAssignment } from "./speaker-frames.js"
import { isDefaultSpeakerRegion } from "./speaker-view-default-regions.js"

/** What `motion` may be (P3-10): one region per segment, or the follow. */
export const SPEAKER_VIEW_MOTIONS = ["static", "glide"] as const
export type SpeakerViewMotion = (typeof SPEAKER_VIEW_MOTIONS)[number]

/** The motion a node takes when tracks are first wired (P3-10 (a), set once,
 *  never over a person's choice) — and what a run sends when none is set. */
export const SPEAKER_VIEW_TRACKED_DEFAULT_MOTION: SpeakerViewMotion = "glide"

/** Below this share of a slot's on-screen time sampled, the badge notes it (§4). */
export const SPEAKER_VIEW_TRACK_COVERAGE_NOTE_BELOW = 0.6

export function isSpeakerViewMotion(v: unknown): v is SpeakerViewMotion {
  return typeof v === "string" && (SPEAKER_VIEW_MOTIONS as readonly string[]).includes(v)
}

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}
const blankValue = (v: unknown) => v === undefined || v === null || v === ""
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/** The key a (camera, speaker) region row is known by — the region editor's too. */
export const speakerRegionKey = (source: string, speaker: string): string => JSON.stringify([source, speaker])

export type SpeakerRegionRow = { readonly source: string; readonly speaker: string; readonly region: EdlRegion }

const isRegion = (r: unknown): r is EdlRegion => isObj(r) && [r.x, r.y, r.w, r.h].every((v) => num(v) !== undefined)

/**
 * The regions a person DREW (P3-4 rung 2; decided 2026-10-10): every
 * `speakerRegions` row except the defaults, which never label a track:
 *  - the rows the region editor saved as untouched defaults (`defaultRegionKeys`,
 *    on every new save);
 *  - a row exactly equal to the default thirds (an older save, an API or MCP
 *    write). The camera's aspect is its frame in the face tracks (`frames`), so
 *    a camera the tracks hold no row for is never judged (it labels nothing
 *    either); the canvas may be any Speaker View canvas; and the k-th of n
 *    boxes is the camera's rows in saved order — the order the region editor
 *    saves them in (camera, then speaker). One row on a camera is never a
 *    default (one speaker gets no default box).
 */
export function drawnSpeakerRegions(
  speakerRegions: unknown,
  defaultRegionKeys: unknown,
  frames?: Pick<SpeakerTrackSetDescriptor, "sources">,
): SpeakerRegionRow[] {
  if (!Array.isArray(speakerRegions)) return []
  const marked = new Set(Array.isArray(defaultRegionKeys) ? defaultRegionKeys.filter((k): k is string => typeof k === "string") : [])
  const rows = speakerRegions.flatMap((row): SpeakerRegionRow[] =>
    isObj(row) && typeof row.source === "string" && typeof row.speaker === "string" && isRegion(row.region)
      ? [{ source: row.source, speaker: row.speaker, region: row.region }]
      : [],
  )
  const aspectOf = new Map(
    (frames?.sources ?? []).flatMap((s) => (s.frame?.w > 0 && s.frame?.h > 0 ? [[s.sourceId, s.frame.w / s.frame.h] as const] : [])),
  )
  const onCamera = (source: string) => rows.filter((r) => r.source === source)
  return rows.filter((row) => {
    if (marked.has(speakerRegionKey(row.source, row.speaker))) return false
    const aspect = aspectOf.get(row.source)
    if (aspect === undefined) return true
    const peers = onCamera(row.source)
    return !isDefaultSpeakerRegion(row.region, peers.indexOf(row), peers.length, aspect)
  })
}

/** The manual corrections a Speaker Frames node holds, as the resolver reads them. */
export function speakerTrackAssignmentsOf(raw: unknown): SpeakerTrackAssignment[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a) =>
    isObj(a) && typeof a.trackId === "string" && a.trackId && (a.speaker === null || typeof a.speaker === "string")
      ? [{ trackId: a.trackId, speaker: a.speaker as string | null, ...(typeof a.rawSpeaker === "string" && a.rawSpeaker ? { rawSpeaker: a.rawSpeaker } : {}) }]
      : [],
  )
}

/**
 * A correction as the region editor saves it: the name the person picked and
 * the transcript's raw label behind it in the CURRENT rename map, so a later
 * rename re-maps the correction (P3-4). A name no rename map renames is its own
 * raw label; a name two raw labels share records none (it is kept as written).
 */
export function speakerTrackAssignmentFor(trackId: string, speaker: string | null, transcript: unknown): SpeakerTrackAssignment {
  if (speaker === null || speaker === "") return { trackId, speaker: null }
  const names = speakerRenameMapOf(transcript) ?? {}
  const raws = Object.keys(names).filter((raw) => names[raw] === speaker)
  if (raws.length > 1) return { trackId, speaker }
  return { trackId, speaker, rawSpeaker: raws[0] ?? speaker }
}

/** A correction's speaker today: its raw label through the current rename map
 *  (as an auto-attributed track's is), else the name it was saved with. */
function resolvedAssignment(a: SpeakerTrackAssignment, names: Readonly<Record<string, string>> | undefined): SpeakerTrackAssignment {
  if (!a.speaker || !a.rawSpeaker || !names || !Object.hasOwn(names, a.rawSpeaker)) return a
  const display = names[a.rawSpeaker]
  return display && display !== a.speaker ? { ...a, speaker: display } : a
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Each track's median box centre (fractions of the frame): what the region
 *  match reads (P3-21 (a)). A track with no boxes has none. */
export function speakerTrackCentres(body: SpeakerTrackSet): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  for (const s of body.sources ?? []) {
    for (const t of s.tracks ?? []) {
      if (!t.boxes || t.boxes.length === 0) continue
      out.set(t.id, { x: median(t.boxes.map((b) => b.x + b.w / 2)), y: median(t.boxes.map((b) => b.y + b.h / 2)) })
    }
  }
  return out
}

const inside = (p: { x: number; y: number }, r: EdlRegion) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

/** Whether the region match can label anything here, i.e. whether the body is
 *  worth fetching: an unattributed, uncorrected track on a camera with a drawn region. */
export function speakerViewTracksNeedBody(
  descriptor: SpeakerTrackSetDescriptor,
  drawnRegions: readonly SpeakerRegionRow[],
  trackAssignments?: unknown,
): boolean {
  const drawnOn = new Set(drawnRegions.map((r) => r.source))
  if (drawnOn.size === 0) return false
  const corrected = new Set(speakerTrackAssignmentsOf(trackAssignments).map((a) => a.trackId))
  return descriptor.sources.some((s) => drawnOn.has(s.sourceId) && s.tracks.some((t) => !t.speaker && !corrected.has(t.id)))
}

export interface SpeakerViewTrackLabelsInput {
  /** The Speaker Frames node's `trackAssignments` (P3-18). */
  readonly trackAssignments?: unknown
  /** The transcript Speaker View reads: its `speakerNames` is the current rename map. */
  readonly transcript?: unknown
  /** The regions the person drew (`drawnSpeakerRegions`). */
  readonly drawnRegions?: readonly SpeakerRegionRow[]
  /** Each track's median centre, from the fetched body; without it the region match abstains. */
  readonly centres?: ReadonlyMap<string, { readonly x: number; readonly y: number }>
}

export interface SpeakerViewTrackLabels {
  readonly descriptor: SpeakerTrackSetDescriptor
  /** Corrections whose track the tracks no longer have (a re-run changed ids). */
  readonly unmatched: SpeakerTrackAssignment[]
  /** Tracks the drawn regions labelled, in set order. */
  readonly regionLabelled: Array<{ readonly trackId: string; readonly source: string; readonly speaker: string }>
}

/** The rename map a transcript carries (raw label → display name). */
export function speakerRenameMapOf(transcript: unknown): Readonly<Record<string, string>> | undefined {
  const t = parse(transcript)
  if (!isObj(t)) return undefined
  try {
    return normalizeTranscript(t).speakerNames
  } catch {
    return undefined
  }
}

/**
 * The labels the app sends, by track id (see the file header for the order).
 * Pure; the descriptor given is never mutated.
 */
export function labelSpeakerViewTracks(descriptor: SpeakerTrackSetDescriptor, input: SpeakerViewTrackLabelsInput = {}): SpeakerViewTrackLabels {
  const names = speakerRenameMapOf(input.transcript)
  const renamed: SpeakerTrackSetDescriptor = names
    ? {
        ...descriptor,
        sources: descriptor.sources.map((s) => ({
          ...s,
          tracks: s.tracks.map((t) => {
            if (!t.speaker || t.attribution?.method === "manual") return t
            const raw = t.attribution?.rawSpeaker ?? t.speaker
            const display = Object.hasOwn(names, raw) ? names[raw] : undefined
            return display && display !== t.speaker ? { ...t, speaker: display } : t
          }),
        })),
      }
    : descriptor
  const assignments = speakerTrackAssignmentsOf(input.trackAssignments).map((a) => resolvedAssignment(a, names))
  const corrected = applySpeakerTrackAssignments(renamed, assignments)
  const assigned = new Set(assignments.map((a) => a.trackId))

  const regionLabelled: Array<{ trackId: string; source: string; speaker: string }> = []
  const drawn = input.drawnRegions ?? []
  const centres = input.centres
  if (!centres || drawn.length === 0) return { descriptor: corrected.descriptor, unmatched: corrected.unmatched, regionLabelled }
  const sources = corrected.descriptor.sources.map((s) => {
    const regions = drawn.filter((r) => r.source === s.sourceId)
    if (regions.length === 0) return s
    return {
      ...s,
      tracks: s.tracks.map((t) => {
        if (t.speaker || assigned.has(t.id)) return t
        const c = centres.get(t.id)
        if (!c) return t
        const hits = regions.filter((r) => inside(c, r.region))
        if (hits.length !== 1) return t
        regionLabelled.push({ trackId: t.id, source: s.sourceId, speaker: hits[0]!.speaker })
        return { ...t, speaker: hits[0]!.speaker, attribution: { method: "region", confidence: 1 } }
      }),
    }
  })
  return { descriptor: { ...corrected.descriptor, sources }, unmatched: corrected.unmatched, regionLabelled }
}

/**
 * The tracked half of the route's body (P3-10): nothing without tracks (v1
 * exactly, whatever `motion` the node holds), else the descriptor and the
 * motion — `glide` when none is set. An unknown motion is passed through, so
 * the rule (and the plugin) refuse it by name.
 */
export function speakerViewTrackedWire(tracks: unknown, motion: unknown): { readonly tracks?: unknown; readonly motion?: unknown } {
  if (blankValue(tracks)) return {}
  return { tracks, motion: motion === undefined || motion === null || motion === "" ? SPEAKER_VIEW_TRACKED_DEFAULT_MOTION : motion }
}

/** What of the tracks a render's `renderBasis` covers (`speakerViewRenderBasis`). */
export interface SpeakerViewTrackedBasis {
  readonly sha256: string
  readonly motion: unknown
  /** Every track's label as sent BEFORE the region match, by id. */
  readonly labels: ReadonlyArray<readonly [string, string | null]>
  /** The drawn region keys: with the body (sha256), they decide the region match. */
  readonly drawn: readonly string[]
}

/**
 * The tracks' part of the render basis: which body, the motion, the labels
 * after the rename map and the corrections, and which regions count as drawn.
 * The region labels themselves are a pure function of the body and the drawn
 * regions, so the basis is the same in the editor (which never fetches the
 * body to judge staleness) and on the server.
 */
export function speakerViewTrackedBasis(
  labelled: SpeakerTrackSetDescriptor,
  motion: unknown,
  drawnRegions: readonly SpeakerRegionRow[],
): SpeakerViewTrackedBasis {
  return {
    sha256: labelled.sha256,
    motion: motion ?? SPEAKER_VIEW_TRACKED_DEFAULT_MOTION,
    labels: labelled.sources.flatMap((s) => s.tracks.map((t) => [t.id, t.speaker ?? null] as const)),
    drawn: drawnRegions.map((r) => speakerRegionKey(r.source, r.speaker)).sort(),
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  The Speaker Frames job behind the tracks (P3-20, the app's half)
// ─────────────────────────────────────────────────────────────────────────

/** The job id a stored track file is keyed by (`…/speaker-tracks/<jobId>.json`,
 *  on nodaro.ai and in a self-host's own copy alike). */
export function speakerFramesJobIdOfTracksUrl(url: unknown): string | undefined {
  if (typeof url !== "string" || !url) return undefined
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    path = url.split(/[?#]/)[0] ?? ""
  }
  const m = /\/speaker-tracks\/([^/]+)\.json$/.exec(path)
  if (!m) return undefined
  // A malformed escape names no job: the tracks are refused as no run's, never thrown.
  try {
    return decodeURIComponent(m[1]!)
  } catch {
    return undefined
  }
}

/** One source a Speaker Frames job read: its id, file and offset. */
export interface SpeakerFramesSampledSource {
  readonly id: string
  readonly url: string
  readonly offsetMs: number
}

/**
 * The sources a Speaker Frames job read, from its stored inputs (`input_data`):
 * every source of its edit — one, a clip pack, or a clip set — or the bare
 * video. Undefined when the inputs hold neither.
 */
export function speakerFramesSampledSources(inputData: unknown): SpeakerFramesSampledSource[] | undefined {
  const d = isObj(inputData) ? inputData : {}
  const raw = parse(d.edl)
  const list: unknown[] | undefined = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.clips) ? raw.clips : isObj(raw) ? [raw] : undefined
  if (list) {
    const out = new Map<string, SpeakerFramesSampledSource>()
    for (const one of list) {
      const e = parse(one)
      if (!isObj(e) || !Array.isArray(e.sources)) continue
      for (const s of e.sources) {
        if (!isObj(s) || typeof s.id !== "string" || typeof s.url !== "string" || out.has(s.id)) continue
        out.set(s.id, { id: s.id, url: s.url, offsetMs: num(s.offsetMs) ?? 0 })
      }
    }
    return out.size > 0 ? [...out.values()] : undefined
  }
  if (typeof d.videoUrl === "string" && d.videoUrl) return [{ id: SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID, url: d.videoUrl, offsetMs: 0 }]
  return undefined
}

/**
 * P3-20's file-and-offset half: for each camera the tracks hold that this edit
 * names and a non-pinned slot follows, it must be the file Speaker Frames sampled, at the same offset —
 * otherwise every box lands on another picture, or `offsetMs` late. `null`:
 * no Speaker Frames run of this account is behind the tracks.
 */
export function speakerViewTracksProvenanceIssues(
  edl: Pick<Edl, "sources">,
  descriptor: Pick<SpeakerTrackSetDescriptor, "sources">,
  sampled: readonly SpeakerFramesSampledSource[] | null,
  /** The cameras a non-pinned slot follows (decided 2026-10-10: the same scope
   *  as the no-coverage refusal; `speakerViewFollowedTrackCameras`). Required:
   *  a caller that cannot lay the edit out checks no camera's file (the edit
   *  itself is refused) rather than every camera. */
  reads: ReadonlySet<string>,
): string[] {
  if (sampled === null) {
    return ["These face tracks are not from a Speaker Frames run on this account — wire Speaker Frames' Face tracks output into Speaker View."]
  }
  const byId = new Map(sampled.map((s) => [s.id, s] as const))
  const issues: string[] = []
  for (const row of descriptor.sources) {
    if (!reads.has(row.sourceId)) continue
    const now = edl.sources.find((s) => s.id === row.sourceId)
    if (!now) continue
    const then = byId.get(row.sourceId)
    if (!then || then.url !== now.url) {
      issues.push(`Face tracks for "${row.sourceId}" were made from a different file — re-run Speaker Frames on this edit.`)
      continue
    }
    const offset = num(now.offsetMs) ?? 0
    if (offset !== then.offsetMs) {
      issues.push(`Face tracks for "${row.sourceId}" were made with the camera at offset ${then.offsetMs} ms; it is now at ${offset} ms — re-run Speaker Frames on this edit.`)
    }
  }
  return issues
}


// ─────────────────────────────────────────────────────────────────────────
//  The rule's tracked checks (the plugin's, mirrored, then the app's own)
// ─────────────────────────────────────────────────────────────────────────

/** One finding of the tracked checks; the rule turns it into its own issue. */
export interface SpeakerViewTrackFinding {
  readonly code: "setting" | "tracks"
  readonly refusal: "unsupported_setting" | "invalid_tracks"
  readonly message: string
}

/**
 * A read the plugin's turn split could ADD to the edit as the app lays it out
 * (round 5, decided 2026-10-11: for unnamed segments the app assumes every
 * camera a non-pinned slot could follow IS followed): the camera, on the master
 * clock, from when it has begun. See `speakerViewSplitReads`.
 */
export interface SpeakerViewPossibleRead {
  readonly source: string
  readonly inMs: number
  readonly outMs: number
}

export interface SpeakerViewTracksCheckInput {
  /** The edit as given (the descriptor is validated against it, as the plugin does). */
  readonly edl: Edl
  /** The edit as laid out (coverage is judged on what each slot reads). */
  readonly drawn: Edl
  /** What the plugin's turn split could add to `drawn` (`speakerViewSplitReads`):
   *  these cameras are followed too, for coverage and for the file-and-offset
   *  check; they add no coverage note (no slot is known to show them). */
  readonly splitReads?: readonly SpeakerViewPossibleRead[]
  readonly tracks: unknown
  readonly motion?: unknown
  readonly speakerRegions?: unknown
  /** The sources the Speaker Frames job behind the tracks read; `null` when
   *  none was found; undefined when not checked here. */
  readonly provenance?: { readonly sources: readonly SpeakerFramesSampledSource[] } | null
  /** The `tracks` wire is there but its Speaker Frames has no output (§5). */
  readonly unproduced?: boolean
}

/** The refusal for a `tracks` wire whose Speaker Frames has no output (§5:
 *  never a silent v1 render the person wired tracking for). */
export const SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE =
  "Face tracks are wired, but Speaker Frames has no output yet — run Speaker Frames first, or remove the wire to render without face tracking."

/** Whether a tracks value carries boxes (a body, not a descriptor). */
function carriesBoxes(v: Record<string, unknown>): boolean {
  const sources = v.sources
  if (!Array.isArray(sources)) return false
  return sources.some((s) => {
    const tracks = isObj(s) ? s.tracks : undefined
    return Array.isArray(tracks) && tracks.some((t) => isObj(t) && "boxes" in t)
  })
}

const pct = (n: number) => `${Math.round(n * 100)} %`

/** What each (camera, speaker) slot reads, on the camera's own clock, and how
 *  much of it the tracks sampled; only slots the track rung can follow (not
 *  region-pinned) of cameras the tracks hold a row for. */
function followedReads(
  drawn: Edl,
  rows: ReadonlyMap<string, { readonly sampledSpans: ReadonlyArray<{ readonly startMs: number; readonly endMs: number }> }>,
  speakerRegions: unknown,
  splitReads: readonly SpeakerViewPossibleRead[] = [],
) {
  const opts: ResolveEdlSlotsOptions = Array.isArray(speakerRegions) ? { speakerRegions: speakerRegions as ResolveEdlSlotsOptions["speakerRegions"] } : {}
  const offsetOf = (id: string) => num(drawn.sources.find((s) => s.id === id)?.offsetMs) ?? 0
  const bySource = new Map<string, Array<[number, number]>>()
  const bySlot = new Map<string, { source: string; speaker?: string; readMs: number; sampledMs: number }>()
  for (const seg of drawn.segments) {
    const slots = resolveEdlSegmentSlots(drawn, seg, opts).filter((sl) => sl.regionFrom !== "slot" && sl.regionFrom !== "segment" && rows.has(sl.source))
    for (const sl of slots) {
      const off = offsetOf(sl.source)
      const a = seg.inMs - off
      const b = seg.outMs - off
      const list = bySource.get(sl.source) ?? []
      list.push([a, b])
      bySource.set(sl.source, list)
      const sampled = rows.get(sl.source)!.sampledSpans.reduce((n, sp) => n + Math.max(0, Math.min(b, sp.endMs) - Math.max(a, sp.startMs)), 0)
      const key = speakerRegionKey(sl.source, sl.speaker ?? "")
      const at = bySlot.get(key) ?? { source: sl.source, ...(sl.speaker !== undefined ? { speaker: sl.speaker } : {}), readMs: 0, sampledMs: 0 }
      bySlot.set(key, { ...at, readMs: at.readMs + (b - a), sampledMs: at.sampledMs + sampled })
    }
  }
  // Reads the turn split could add: followed for coverage and provenance, with
  // no slot of their own to note.
  for (const read of splitReads) {
    if (!rows.has(read.source)) continue
    const off = offsetOf(read.source)
    const list = bySource.get(read.source) ?? []
    list.push([read.inMs - off, read.outMs - off])
    bySource.set(read.source, list)
  }
  return { bySource, bySlot }
}

/**
 * The cameras whose tracks a render follows: those a non-pinned slot shows
 * that the tracks hold a row for, on the edit as laid out. The scope of the
 * no-coverage refusal and of the file-and-offset check (decided 2026-10-10).
 */
export function speakerViewFollowedCameras(
  drawn: Edl,
  descriptor: Pick<SpeakerTrackSetDescriptor, "sources">,
  speakerRegions: unknown,
  splitReads: readonly SpeakerViewPossibleRead[] = [],
): Set<string> {
  const rows = new Map(descriptor.sources.map((s) => [s.sourceId, s] as const))
  return new Set(followedReads(drawn, rows, speakerRegions, splitReads).bySource.keys())
}

/**
 * The tracked checks, in the plugin's order (`readSpeakerViewTracks`, then
 * `assertTracksCoverSources`), then the app's own file-and-offset check
 * (P3-20). Issues refuse before anything is reserved; notes say what the
 * render will do differently (a slot under 60 % sampled; the descriptor's
 * warnings). Nothing is read without tracks — `motion` included (v1 exactly).
 */
export function findSpeakerViewTrackIssues(input: SpeakerViewTracksCheckInput): { readonly issues: SpeakerViewTrackFinding[]; readonly notes: string[] } {
  const raw = input.tracks
  const refuse = (message: string) => ({ issues: [{ code: "tracks" as const, refusal: "invalid_tracks" as const, message }], notes: [] })
  if (raw === undefined || raw === null || raw === "") return input.unproduced ? refuse(SPEAKER_VIEW_TRACKS_UNPRODUCED_MESSAGE) : { issues: [], notes: [] }
  if (input.motion !== undefined && !isSpeakerViewMotion(input.motion)) {
    return { issues: [{ code: "setting", refusal: "unsupported_setting", message: `motion ${JSON.stringify(input.motion)} is not "static" or "glide".` }], notes: [] }
  }
  const parsed = parse(raw)
  if (!isObj(parsed)) return refuse("`tracks` must be one face-track descriptor (Speaker Frames' output).")
  if (carriesBoxes(parsed)) return refuse("`tracks` must be Speaker Frames' output descriptor (url, sha256, bytes) — the box body is never sent inline.")
  const descriptor = normalizeSpeakerTrackSetDescriptor(parsed)
  const { issues, warnings } = validateSpeakerTrackSetDescriptor(descriptor, { edl: input.edl })
  if (issues.length > 0) {
    return refuse(`the face tracks are not valid — ${issues.slice(0, 5).join("; ")}${issues.length > 5 ? `; and ${issues.length - 5} more` : ""}.`)
  }
  const rows = new Map(descriptor.sources.map((s) => [s.sourceId, s] as const))
  const { bySource, bySlot } = followedReads(input.drawn, rows, input.speakerRegions, input.splitReads)
  for (const [id, spans] of bySource) {
    const covered = rows.get(id)!.sampledSpans.some((sp) => spans.some(([a, b]) => sp.startMs < b && a < sp.endMs))
    if (!covered) return refuse(`Face tracks don't cover "${id}" — re-run Speaker Frames on this edit.`)
  }
  if (input.provenance !== undefined) {
    // The cameras a non-pinned slot follows: the no-coverage refusal's scope (decided 2026-10-10).
    const found = speakerViewTracksProvenanceIssues(input.edl, descriptor, input.provenance === null ? null : input.provenance.sources, new Set(bySource.keys()))
    if (found.length > 0) return { issues: found.map((message) => ({ code: "tracks" as const, refusal: "invalid_tracks" as const, message })), notes: [] }
  }
  const notes: string[] = [...warnings]
  for (const slot of bySlot.values()) {
    if (!(slot.readMs > 0)) continue
    const share = slot.sampledMs / slot.readMs
    if (share >= SPEAKER_VIEW_TRACK_COVERAGE_NOTE_BELOW) continue
    const who = slot.speaker !== undefined ? `"${slot.speaker}" on "${slot.source}"` : `"${slot.source}"`
    notes.push(`${who}: tracked ${pct(share)} — the rest uses the static framing`)
  }
  return { issues: [], notes }
}

// ─────────────────────────────────────────────────────────────────────────
//  One funnel for a run (both engines) and for the badge
// ─────────────────────────────────────────────────────────────────────────

/** What a Speaker View run or its badge reads of the tracks. */
export interface SpeakerViewTracksInput {
  /** The `tracks` wire's value (Speaker Frames' descriptor, or its JSON string). */
  readonly tracks: unknown
  /** Whether a `tracks` wire is there at all: with nothing on it, the run is
   *  refused (`unproduced`), never rendered as v1. */
  readonly wired?: boolean
  /** The Speaker Frames node's corrections (P3-18). */
  readonly trackAssignments?: unknown
  /** The transcript Speaker View reads (the current rename map). */
  readonly transcript?: unknown
  /** The Speaker View node's data: `motion`, `speakerRegions`, `defaultRegionKeys`. */
  readonly data: Readonly<Record<string, unknown>>
}

export interface SpeakerViewTracksResolved {
  /** What the route's `tracks` carries: the descriptor with the app's labels,
   *  or — when the wire holds no descriptor — the value as given, which the
   *  rule refuses in the plugin's own words. */
  readonly tracks: unknown
  /** The node's motion, as `speakerViewTrackedWire` sends it. */
  readonly motion: unknown
  /** The tracks' part of the render basis (absent for a value that is no descriptor). */
  readonly basis?: SpeakerViewTrackedBasis
  /** P3-20's file-and-offset input for the rule; absent where not checked. */
  readonly provenance?: { readonly sources: readonly SpeakerFramesSampledSource[] } | null
  /** What the labels did that the person should know (a correction whose
   *  track is gone, a track a drawn region labelled). */
  readonly notes: readonly string[]
  /** A `tracks` wire whose Speaker Frames has no output: the rule refuses. */
  readonly unproduced?: true
}

/** The motion a run sends: the node's, as the normalizer keeps it — an
 *  unknown one is dropped, so a tracked run glides as the panel shows. */
const motionOf = (data: Readonly<Record<string, unknown>>): SpeakerViewMotion | undefined => (isSpeakerViewMotion(data.motion) ? data.motion : undefined)

/**
 * What the tracks add to the rule's input, for every caller (both engines,
 * the badge, the review): the body's `tracks` + `motion` (`wire`), and the
 * app's own checks (`rule`: the Speaker Frames job's sources; a wire with
 * no output).
 */
export function speakerViewTrackedRuleInput(tracked: SpeakerViewTracksResolved | undefined): {
  readonly wire: { readonly tracks?: unknown; readonly motion?: unknown }
  readonly rule: { readonly tracksProvenance?: { readonly sources: readonly SpeakerFramesSampledSource[] } | null; readonly tracksUnproduced?: true }
} {
  if (!tracked) return { wire: {}, rule: {} }
  return {
    wire: speakerViewTrackedWire(tracked.tracks, tracked.motion),
    rule: {
      ...(tracked.provenance !== undefined ? { tracksProvenance: tracked.provenance } : {}),
      ...(tracked.unproduced ? { tracksUnproduced: true as const } : {}),
    },
  }
}

export interface SpeakerViewTracksRunDeps {
  /** The stored request and result of a Speaker Frames job OF THIS ACCOUNT
   *  (owner-scoped), or null when there is none. */
  readonly loadFramesJob: (jobId: string) => Promise<{ readonly input_data?: unknown; readonly output_data?: unknown } | null>
  /** The stored box body the descriptor names, checked against its `bytes`
   *  and `sha256` (throws when it cannot be read or does not match). */
  readonly readTrackBody: (descriptor: SpeakerTrackSetDescriptor) => Promise<unknown>
}

function descriptorOf(raw: unknown): SpeakerTrackSetDescriptor | undefined {
  const parsed = parse(raw)
  if (!isObj(parsed) || carriesBoxes(parsed)) return undefined
  return normalizeSpeakerTrackSetDescriptor(parsed)
}

function labelNotes(out: SpeakerViewTrackLabels): string[] {
  return [
    ...out.unmatched.map((a) => `track "${a.trackId}": the correction${a.speaker ? ` to "${a.speaker}"` : ""} names a track this Speaker Frames run no longer has`),
    ...out.regionLabelled.map((r) => `track "${r.trackId}" on "${r.source}": labelled "${r.speaker}" by its drawn region`),
  ]
}

/**
 * The tracks as the badge and the review read them, with no fetch: the rename
 * map and the corrections applied; the region match abstains (it needs the
 * body), and the file-and-offset check is not asked. The render basis is the
 * same as a run's (`speakerViewTrackedBasis` never reads the region labels).
 */
export function speakerViewTracksAtRest(input: SpeakerViewTracksInput): SpeakerViewTracksResolved | undefined {
  const motion = motionOf(input.data)
  if (blankValue(input.tracks)) return input.wired ? { tracks: undefined, motion, notes: [], unproduced: true } : undefined
  const descriptor = descriptorOf(input.tracks)
  if (!descriptor) return { tracks: parse(input.tracks) ?? input.tracks, motion, notes: [] }
  const labelled = labelSpeakerViewTracks(descriptor, { trackAssignments: input.trackAssignments, transcript: input.transcript })
  const drawn = drawnSpeakerRegions(input.data.speakerRegions, input.data.defaultRegionKeys, descriptor)
  return {
    tracks: labelled.descriptor,
    motion,
    basis: speakerViewTrackedBasis(labelled.descriptor, motion, drawn),
    notes: labelNotes(labelled),
  }
}

/**
 * The tracks as a RUN sends them (both engines; P3.9): the app's labels —
 * the region match too, from the stored body when a drawn region can label a
 * track — and the sources of the Speaker Frames job behind them, for the
 * rule's file-and-offset check. That job is found by the track file's key and
 * must be this account's and must have produced this very file (its output's
 * `sha256`); otherwise the provenance is `null` and the rule refuses.
 */
export async function resolveSpeakerViewTracksForRun(input: SpeakerViewTracksInput, deps: SpeakerViewTracksRunDeps): Promise<SpeakerViewTracksResolved | undefined> {
  const atRest = speakerViewTracksAtRest(input)
  if (!atRest || !atRest.basis) return atRest
  const descriptor = descriptorOf(input.tracks)!
  const drawn = drawnSpeakerRegions(input.data.speakerRegions, input.data.defaultRegionKeys, descriptor)
  let labelled = labelSpeakerViewTracks(descriptor, { trackAssignments: input.trackAssignments, transcript: input.transcript })
  if (speakerViewTracksNeedBody(labelled.descriptor, drawn, input.trackAssignments)) {
    const body = normalizeSpeakerTracks(await deps.readTrackBody(descriptor))
    labelled = labelSpeakerViewTracks(descriptor, { trackAssignments: input.trackAssignments, transcript: input.transcript, drawnRegions: drawn, centres: speakerTrackCentres(body) })
  }
  return {
    tracks: labelled.descriptor,
    motion: atRest.motion,
    basis: atRest.basis,
    provenance: await speakerFramesProvenanceOf(descriptor, deps.loadFramesJob),
    notes: labelNotes(labelled),
  }
}

/**
 * The sources the Speaker Frames job behind a descriptor read (P3-20, the
 * app's half): the job named by the track file's key, of this account
 * (`loadFramesJob` is owner-scoped), that produced this very file (its
 * output's `sha256`). `null` when there is no such job — the rule refuses.
 */
export async function speakerFramesProvenanceOf(
  descriptor: Pick<SpeakerTrackSetDescriptor, "url" | "sha256">,
  loadFramesJob: SpeakerViewTracksRunDeps["loadFramesJob"],
): Promise<{ readonly sources: readonly SpeakerFramesSampledSource[] } | null> {
  const jobId = speakerFramesJobIdOfTracksUrl(descriptor.url)
  const job = jobId ? await loadFramesJob(jobId) : null
  const produced = job ? descriptorOf((isObj(job.output_data) ? job.output_data : {}).json) : undefined
  const sources = produced && produced.sha256 === descriptor.sha256 ? speakerFramesSampledSources(job!.input_data) : undefined
  return sources ? { sources } : null
}

/** The descriptor a `tracks` value holds (normalized), or undefined when it holds none. */
export function speakerViewTracksDescriptor(raw: unknown): SpeakerTrackSetDescriptor | undefined {
  return blankValue(raw) ? undefined : descriptorOf(raw)
}
