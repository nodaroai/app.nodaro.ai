/**
 * Speaker View's render rule (SV19, C3.2): the ONE check of what the renderer
 * will refuse, run by the backend's ingresses before any credit is reserved
 * and by the editor's badge before the run. It MIRRORS the cloud plugin's
 * refusals — the same checks, in the same order, with the same answers — and
 * `speaker-view-parity.test.ts` fails the build when a fixture the plugin
 * generated is judged differently here.
 *
 * What it refuses (each one a plugin 400 before the reserve):
 *   - an edit that is not one master-clock EDL with a picture on every segment
 *     (a clip set, an output-clock EDL, a source with no url, a segment with
 *     no video);
 *   - one `validateEdl` refuses (its warnings never refuse);
 *   - a region too small to crop, a layout / switch / emphasis / accent colour
 *     the renderer does not know;
 *   - an output over the 180-minute cap;
 *   - on two or more cameras, speakers it cannot read (SV24, RELAXED decided
 *     2026-10-07: a fully named edit is never refused for its transcript; a
 *     transcript naming exactly one speaker passes; no speaker on any segment
 *     with two or more labels → "wire Camera Switch"; a partly unnamed edit
 *     with no transcript, or one with no labels, is refused);
 *   - a speaker no camera places, and — after the late-camera SNAP — a segment
 *     whose OWN picture or sound has not begun (a multi-slot segment that
 *     merely reads a late camera is snapped and counted in `notes`, never
 *     refused: decided 2026-10-06).
 *
 * It is NOT part of the public contract (decided 2026-10-04): the structural
 * EDL contract is Apache `@nodaro/shared`; this is what one renderer draws
 * today. It judges the edit AS GIVEN — the plugin's turn split is its own
 * taste — so the notes count segments, not the pieces a split makes of them.
 */
import { edlDurationMs, transcriptSpeakerLabels, validateEdl, type Edl, type EdlRegion, type EdlSegment } from "@nodaro/shared"
import { sourcesReadBy, layOutSpeakerView, speakerViewSlotSet } from "./speaker-view-layout.js"
import { speakerViewSettingProblems, type SpeakerViewSettings } from "./speaker-view-settings-check.js"
import {
  SPEAKER_VIEW_DEFAULT_ASPECT,
  SPEAKER_VIEW_MAX_OUTPUT_MS,
  SPEAKER_VIEW_MIN_REGION,
  isSpeakerViewAspect,
} from "./speaker-view-settings.js"

/** The plugin's refusal codes: what the REST caller's 400 carries. */
export type SpeakerViewRefusal = "invalid_edl" | "unsupported_setting" | "too_long"

/**
 * Which check refused, so a caller can say WHY without reading the message.
 *  - "edit": not one master-clock EDL (a clip set, an output clock, a source
 *    with no url, a segment out of order or with no picture).
 *  - "structural": the shared contract's `validateEdl`.
 *  - "region": a region too small to crop, or outside the frame.
 *  - "setting": a layout / switch / emphasis / accent / duration the renderer
 *    does not draw.
 *  - "output-cap": more than 180 minutes of output.
 *  - "wire-camera-switch" / "no-transcript" / "no-speaker-labels": SV24.
 *  - "unplaced-speaker": a speaker no camera shows.
 *  - "reads-before-source": a segment's own picture or sound has not begun.
 */
export type SpeakerViewIssueCode =
  | "edit"
  | "structural"
  | "region"
  | "setting"
  | "output-cap"
  | "wire-camera-switch"
  | "no-transcript"
  | "no-speaker-labels"
  | "unplaced-speaker"
  | "reads-before-source"

export interface SpeakerViewIssue {
  readonly code: SpeakerViewIssueCode
  /** The plugin's refusal code for this check. */
  readonly refusal: SpeakerViewRefusal
  readonly message: string
}

export interface SpeakerViewVerdict {
  /** True when the plugin will not refuse the edit. */
  readonly ok: boolean
  readonly issues: readonly SpeakerViewIssue[]
  /** What the render does that differs from the EDL (the late-camera snap). */
  readonly notes: readonly string[]
  /** The edit as coerced (ids minted, JSON parsed); undefined when it could not be read. */
  readonly edl?: Edl
}

export interface SpeakerViewRuleInput {
  /** One edit: an object or its JSON string. */
  readonly edl: unknown
  /** The wired transcript (an object or its JSON string), if any. */
  readonly transcript?: unknown
  readonly settings?: SpeakerViewSettings
}

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const issue = (code: SpeakerViewIssueCode, message: string, refusal: SpeakerViewRefusal = "invalid_edl"): SpeakerViewIssue => ({ code, refusal, message })

/** The edit as the renderer reads it, or why it cannot be: every field kept as
 *  given, a missing segment id minted, a picture on every segment. */
export function coerceSpeakerViewEdl(raw: unknown): { edl: Edl } | { problem: string } {
  const v = parse(raw) as Record<string, unknown> | undefined
  if (!v || typeof v !== "object" || Array.isArray(v)) return { problem: "`edl` must be one edit (an EDL object)." }
  if (Array.isArray(v.clips)) return { problem: "`edl` is a clip set — pass one clip's EDL (a clip set fans out one run per clip on the canvas)." }
  if (!Array.isArray(v.sources) || !Array.isArray(v.segments)) return { problem: "`edl` needs `sources` and `segments`." }
  if (v.clock === "output") return { problem: "the edit must be on the master clock (an edit-plan EDL), not a rendered output's." }
  for (const [i, row] of (v.sources as unknown[]).entries()) {
    const s = row as Record<string, unknown> | null
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !s.id) return { problem: `source ${i} needs a string \`id\`.` }
    if (typeof s.url !== "string" || !s.url.trim()) return { problem: `source "${s.id}" needs a non-empty string \`url\`.` }
  }
  const videoIds = new Set((v.sources as Array<{ id: string; kind?: string }>).filter((s) => s.kind === "video").map((s) => s.id))
  const segments: EdlSegment[] = []
  for (const [i, row] of (v.segments as unknown[]).entries()) {
    const s = row as Record<string, unknown> | null
    const inMs = num(s?.inMs)
    const outMs = num(s?.outMs)
    if (!s || typeof s !== "object" || inMs === undefined || outMs === undefined || !(outMs > inMs)) return { problem: `segment ${i} needs a numeric inMs < outMs.` }
    const id = typeof s.id === "string" && s.id ? s.id : `seg-${i}`
    if (typeof s.video !== "string" || !videoIds.has(s.video)) return { problem: `segment "${id}" has no picture — its \`video\` must name a video source of the edit.` }
    segments.push({ ...(s as unknown as EdlSegment), id, inMs, outMs })
  }
  if (segments.length === 0) return { problem: "`edl` has no segments." }
  return { edl: { ...(v as unknown as Edl), version: 1, clock: "master", segments } }
}

/** Why `region` cannot be cropped, or undefined when it can. */
function regionProblem(region: unknown): string | undefined {
  const r = region as Partial<Record<keyof EdlRegion, unknown>> | null
  if (!r || typeof r !== "object") return "is not a region"
  const [x, y, w, h] = [r.x, r.y, r.w, r.h].map(num)
  if (x === undefined || y === undefined || w === undefined || h === undefined) return "needs numeric x, y, w, h"
  if (x < 0 || y < 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9) return "must lie inside the frame"
  if (w < SPEAKER_VIEW_MIN_REGION || h < SPEAKER_VIEW_MIN_REGION) {
    return `is too small to crop (w=${w}, h=${h}; each side must be at least ${SPEAKER_VIEW_MIN_REGION} of the frame)`
  }
  return undefined
}

/** Every region on the edit's sources, segments, slots, and in `speakerRegions`
 *  that cannot be cropped, naming where. */
function regionIssues(edl: Edl, speakerRegions: unknown): SpeakerViewIssue[] {
  const out: SpeakerViewIssue[] = []
  const check = (region: unknown, where: string) => {
    if (region === undefined || region === null) return
    const problem = regionProblem(region)
    if (problem) out.push(issue("region", `${where}: region ${problem}.`))
  }
  for (const s of edl.sources) check(s.region, `source "${s.id}"`)
  for (const seg of edl.segments) {
    check(seg.region, `segment "${seg.id}"`)
    for (const slot of seg.layout?.slots ?? []) check(slot.region, `segment "${seg.id}" slot "${slot.source}"`)
  }
  if (speakerRegions === undefined || speakerRegions === null) return out
  if (!Array.isArray(speakerRegions)) return [...out, issue("region", "`speakerRegions` must be a list.")]
  speakerRegions.forEach((row, i) => {
    const problem = regionProblem(row && typeof row === "object" ? (row as { region?: unknown }).region : undefined)
    if (problem) out.push(issue("region", `speakerRegions[${i}]: region ${problem}.`))
  })
  return out
}

const isNamed = (seg: EdlSegment) => typeof seg.speaker === "string" && seg.speaker.length > 0
const transcriptGiven = (raw: unknown) => raw !== undefined && raw !== null && raw !== ""

/** SV24, relaxed (decided 2026-10-07): an edit with two or more cameras whose
 *  speakers cannot be read. */
function speakersReadableIssues(edl: Edl, rawTranscript: unknown): SpeakerViewIssue[] {
  const cameras = edl.sources.filter((s) => s.kind === "video").length
  if (cameras < 2) return []
  if (edl.segments.every(isNamed)) return []
  const labels = transcriptGiven(rawTranscript) ? transcriptSpeakerLabels(rawTranscript) : []
  if (!edl.segments.some(isNamed) && labels.length !== 1) {
    return [issue("wire-camera-switch", `this edit has ${cameras} cameras but no speaker on any segment. Wire Camera Switch between Edit Plan and Speaker View.`)]
  }
  if (!transcriptGiven(rawTranscript)) {
    const unnamed = edl.segments.find((seg) => !isNamed(seg))
    return [issue("no-transcript", `Wire a transcript — Speaker View needs to know who speaks when (segment "${unnamed?.id}" names no speaker).`)]
  }
  if (labels.length === 0) return [issue("no-speaker-labels", "This transcript has no speaker labels. Transcribe with speaker detection on.")]
  return []
}

/** The aspect the edit is drawn at: the request's, else the edit's own, else 16:9. */
export function resolveSpeakerViewAspect(requested: unknown, edl: { meta?: { targetAspect?: unknown } }) {
  if (isSpeakerViewAspect(requested)) return requested
  const own = edl.meta?.targetAspect
  return isSpeakerViewAspect(own) ? own : SPEAKER_VIEW_DEFAULT_ASPECT
}

/**
 * The render rule's verdict on an edit and its settings, with every issue in
 * the order the plugin would refuse them, and the notes of what the render
 * will do differently. Pure; never throws.
 */
export function findSpeakerViewIssues(input: SpeakerViewRuleInput): SpeakerViewVerdict {
  const settings = input.settings ?? {}
  const coerced = coerceSpeakerViewEdl(input.edl)
  if ("problem" in coerced) return { ok: false, issues: [issue("edit", coerced.problem)], notes: [] }
  const edl = coerced.edl

  let structural: readonly string[]
  try {
    structural = validateEdl(edl).issues
  } catch (err) {
    structural = [`the edit could not be read (${err instanceof Error ? err.message : String(err)})`]
  }
  if (structural.length > 0) {
    return { ok: false, issues: structural.map((m) => issue("structural", m)), notes: [], edl }
  }

  const issues: SpeakerViewIssue[] = [
    ...regionIssues(edl, settings.speakerRegions),
    ...speakerViewSettingProblems(edl, settings).map((p) => issue("setting", p.message, p.refusal)),
  ]
  const outputMs = edlDurationMs(edl)
  if (outputMs > SPEAKER_VIEW_MAX_OUTPUT_MS) {
    issues.push(issue("output-cap", `the edit renders ${(outputMs / 60_000).toFixed(1)} minutes — over the 180-minute limit for one render.`, "too_long"))
  }
  issues.push(...speakersReadableIssues(edl, input.transcript))
  if (issues.length > 0) return { ok: false, issues, notes: [], edl }

  // The layout stage, on the edit as given: who fills a tile is the edit's
  // speakers (the transcript's labels when it names none).
  const aspect = resolveSpeakerViewAspect(settings.targetAspect, edl)
  const labels = transcriptGiven(input.transcript) ? transcriptSpeakerLabels(input.transcript) : []
  const laid = layOutSpeakerView(edl, {
    aspect,
    ...(typeof settings.layout === "string" ? { layout: settings.layout } : {}),
    speakers: speakerViewSlotSet(edl, labels),
  })
  for (const speaker of laid.unplaced) {
    issues.push(issue("unplaced-speaker", `no camera places speaker "${speaker}" — no segment shows them and no video source lists them in \`speakers\`. Wire Camera Switch between the edit and Speaker View, or list the speaker on their camera's source.`))
  }
  if (laid.unplaced.length === 0) {
    const originOf = (id: string) => num(edl.sources.find((s) => s.id === id)?.offsetMs) ?? 0
    laid.drawn.segments.forEach((seg, i) => {
      for (const id of sourcesReadBy(laid.drawn, seg)) {
        const origin = originOf(id)
        if (seg.inMs >= origin) continue
        issues.push(issue("reads-before-source", `segment[${i}] "${seg.id}" starts at ${(seg.inMs / 1000).toFixed(3)}s on the master clock, before source "${id}" begins (its offsetMs is ${origin}) — start the segment later or check the source's offsetMs.`))
      }
    })
    let drawnIssues: readonly string[]
    try {
      drawnIssues = validateEdl(laid.drawn).issues
    } catch (err) {
      drawnIssues = [`the edit could not be read (${err instanceof Error ? err.message : String(err)})`]
    }
    if (issues.length === 0) for (const m of drawnIssues) issues.push(issue("structural", m))
  }
  return { ok: issues.length === 0, issues, notes: issues.length === 0 ? laid.notes : [], edl }
}

/** The verdict as messages: what every ingress returns in its 400. */
export function validateSpeakerView(input: SpeakerViewRuleInput): { readonly ok: boolean; readonly issues: readonly string[]; readonly notes: readonly string[] } {
  const v = findSpeakerViewIssues(input)
  return { ok: v.ok, issues: v.issues.map((i) => i.message), notes: v.notes }
}
