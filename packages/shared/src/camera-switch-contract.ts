/**
 * camera-switch (podcast B5, decided 2026-10-03) — the structural pieces every
 * caller shares: the canvas engines, the editor, MCP and the SDK. WHO is on
 * screen is decided by the Cloud plugin; these only read the inputs it needs
 * and pre-fill the speaker table. Pure, no I/O.
 */

/** The settings and their decided defaults (the plugin holds its own copy, D13). */
export const CAMERA_SWITCH_DEFAULTS = Object.freeze({
  /** The shortest shot; a shorter turn (an interjection) holds the shot. */
  minShotMs: 2_500,
  /** Cut this long before the new speaker starts. */
  leadMs: 200,
  /** With a `wide` camera: break to it after this long on one camera. */
  maxShotMs: 20_000,
  /** With a `wide` camera: every N-th cut goes to the wide (0 = off). */
  wideEvery: 0,
  /** Overlapping speech → a side-by-side / stacked layout hint. */
  layoutHints: false,
})

/** The flat credit id and price (decided 2026-10-03). */
export const CAMERA_SWITCH_CREDIT_ID = "camera-switch"

const parseMaybe = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

/** Distinct speaker labels of a transcript (an object or its JSON string), in
 *  order of first appearance. Empty → camera-switch refuses before charging. */
export function transcriptSpeakerLabels(transcript: unknown): string[] {
  const words = (parseMaybe(transcript) as { words?: unknown } | null | undefined)?.words
  if (!Array.isArray(words)) return []
  const seen = new Set<string>()
  for (const w of words) {
    const s = (w as { speaker?: unknown } | null)?.speaker
    if (typeof s === "string" && s && !seen.has(s)) seen.add(s)
  }
  return [...seen]
}

/** The cameras a speaker can be given: an EDL's video sources in order,
 *  without the `wide` / `screen` angles (those are not anyone's close-up). */
export function cameraSwitchCameras(edl: unknown): Array<{ id: string; role?: string }> {
  const sources = (parseMaybe(edl) as { sources?: unknown } | null | undefined)?.sources
  if (!Array.isArray(sources)) return []
  return sources
    .filter((s): s is { id: string; kind?: string; role?: string } => !!s && typeof (s as { id?: unknown }).id === "string")
    .filter((s) => s.kind !== "audio" && s.role !== "wide" && s.role !== "screen" && s.role !== "master-audio")
    .map((s) => ({ id: s.id, ...(s.role ? { role: s.role } : {}) }))
}

/** The settings' accepted ranges — exactly the Cloud route's (it answers 400
 *  outside them), so every caller clamps to the same numbers before sending. */
export const CAMERA_SWITCH_BOUNDS = Object.freeze({
  minShotMs: Object.freeze({ min: 500, max: 60_000 }),
  leadMs: Object.freeze({ min: 0, max: 5_000 }),
  maxShotMs: Object.freeze({ min: 0, max: 600_000 }),
  wideEvery: Object.freeze({ min: 0, max: 20 }),
})

/** The longest display name a speaker can be given. */
export const CAMERA_SWITCH_NAME_MAX = 80

export type CameraSwitchNumericSetting = keyof typeof CAMERA_SWITCH_BOUNDS

/** A setting as a whole number inside its range; undefined when unset. */
export function clampCameraSwitchSetting(key: CameraSwitchNumericSetting, value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  const { min, max } = CAMERA_SWITCH_BOUNDS[key]
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Display names trimmed, empty ones dropped, each cut to
 *  `CAMERA_SWITCH_NAME_MAX` characters. */
export function cleanSpeakerNames(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [label, name] of Object.entries(raw as Record<string, unknown>)) {
    const trimmed = typeof name === "string" ? name.trim() : ""
    if (label && trimmed) out[label] = trimmed.slice(0, CAMERA_SWITCH_NAME_MAX)
  }
  return out
}

/** Why camera-switch would refuse this edit (the route's 400 `invalid_edl`),
 *  or null. One edit (an object or its JSON string) on the master clock, with
 *  sources and at least one segment of numeric inMs < outMs; a clip SET is
 *  refused — on the canvas each clip fans out to its own run. */
export function cameraSwitchEdlProblem(edl: unknown): string | null {
  const v = parseMaybe(edl) as Record<string, unknown> | null | undefined
  if (!v || typeof v !== "object" || Array.isArray(v)) return "camera-switch: `edl` must be one edit (an EDL object)."
  if (Array.isArray(v.clips)) return "camera-switch: `edl` is a clip set — pass one clip's EDL (a clip set fans out one run per clip on the canvas)."
  if (!Array.isArray(v.sources) || !Array.isArray(v.segments)) return "camera-switch: `edl` needs `sources` and `segments`."
  if (v.segments.length === 0) return "camera-switch: `edl` has no segments."
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined)
  for (const [i, row] of (v.segments as unknown[]).entries()) {
    const seg = row as { inMs?: unknown; outMs?: unknown } | null
    const inMs = num(seg?.inMs), outMs = num(seg?.outMs)
    if (inMs === undefined || outMs === undefined || !(outMs > inMs)) return `camera-switch: segment ${i} needs a numeric inMs < outMs.`
  }
  if (v.clock === "output") return "camera-switch: the edit must be on the master clock (an edit-plan EDL), not a rendered output's."
  return null
}

/** The speaker table pre-filled by order (decided 2026-10-03): speaker 1 →
 *  camera 1, speaker 2 → camera 2 … A speaker past the last camera stays
 *  unmapped (the wide shows them, else any camera with picture). `existing`
 *  entries are kept as the person set them — an explicit `""` means "no
 *  camera of their own" and is SENT as `""`, so it also beats a source whose
 *  `speakers` list names them. */
export function defaultSpeakerMap(
  labels: readonly string[],
  cameraIds: readonly string[],
  existing: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  labels.forEach((label, i) => {
    if (Object.prototype.hasOwnProperty.call(existing, label)) {
      const kept = existing[label]
      if (typeof kept === "string") out[label] = kept
      return
    }
    if (i < cameraIds.length) out[label] = cameraIds[i]!
  })
  return out
}

/** What a Camera Switch node sends besides its two inputs — ONE funnel for the
 *  canvas executor and the orchestrator, so both send the same clamped
 *  settings and the same pre-filled speaker table. */
export interface CameraSwitchNodeSettings {
  readonly speakerMap?: Readonly<Record<string, string>>
  readonly speakerNames?: Readonly<Record<string, string>>
  readonly minShotMs?: number
  readonly leadMs?: number
  readonly maxShotMs?: number
  readonly wideEvery?: number
  readonly layoutHints?: boolean
}
export function cameraSwitchSettingsPayload(
  data: CameraSwitchNodeSettings,
  edl: unknown,
  transcript: unknown,
): {
  speakerMap: Record<string, string>
  speakerNames: Record<string, string>
  minShotMs?: number
  leadMs?: number
  maxShotMs?: number
  wideEvery?: number
  layoutHints: boolean
} {
  const existing = data.speakerMap && typeof data.speakerMap === "object" ? data.speakerMap : {}
  const out: ReturnType<typeof cameraSwitchSettingsPayload> = {
    speakerMap: defaultSpeakerMap(transcriptSpeakerLabels(transcript), cameraSwitchCameras(edl).map((c) => c.id), existing),
    speakerNames: cleanSpeakerNames(data.speakerNames),
    layoutHints: data.layoutHints === true,
  }
  for (const key of Object.keys(CAMERA_SWITCH_BOUNDS) as CameraSwitchNumericSetting[]) {
    const v = clampCameraSwitchSetting(key, data[key])
    if (v !== undefined) out[key] = v
  }
  return out
}
