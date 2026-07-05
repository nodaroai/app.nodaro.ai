/**
 * Canonical catalog of Exposure Settings choices.
 *
 * Exposure Settings is a multi-category dimension covering the core photographic
 * triangle that controls exposure and visual character: aperture (depth of field
 * and subject isolation), shutter speed (motion treatment), and ISO sensitivity
 * (grain quality and noise). Independent of optics (lens), lighting, framing,
 * camera motion, and capture medium (camera-format).
 *
 * Each picked entry contributes a focused descriptive clause — the whole point
 * is to give the model a strong technical hint about what the photographer
 * "set the dial to", and the visual consequence of that choice.
 *
 * Typical applications: portraiture wide-aperture isolation, action freeze with
 * fast shutter, gritty high-ISO grain, light-trail long exposure, etc.
 *
 * Shared between the picker UI, the standalone Exposure Settings parameter
 * node, and the prompt-hint injection on both the frontend DAG executor and
 * the backend orchestrator.
 */

export type ExposureCategory = "aperture" | "shutter-speed" | "iso"

export interface ExposureSettings {
  readonly id: string
  readonly label: string
  readonly category: ExposureCategory
  readonly description: string
  readonly promptHint: string
}

export const EXPOSURE_SETTINGS: ReadonlyArray<ExposureSettings> = [
  // ---------------------------- Aperture ----------------------------
  // Wide-open primes through medium tele, then deep landscape stops.
  { id: "aperture-f1-2",  label: "f/1.2",  category: "aperture", description: "Razor-thin DOF, dreamy bokeh",   promptHint: "shot wide open at f/1.2 — paper-thin depth of field with the subject's eyes in razor focus and everything else dissolving into creamy bokeh" },
  { id: "aperture-f1-4",  label: "f/1.4",  category: "aperture", description: "Aggressive subject isolation",  promptHint: "shot at f/1.4 — extremely shallow depth of field, aggressive subject isolation against a smoothly melted background" },
  { id: "aperture-f1-8",  label: "f/1.8",  category: "aperture", description: "Classic portrait separation",   promptHint: "shot at f/1.8 — shallow depth of field with the classic portrait separation between subject and softly defocused background" },
  { id: "aperture-f2-8",  label: "f/2.8",  category: "aperture", description: "Subject sharp, BG soft",         promptHint: "shot at f/2.8 — subject crisply sharp with a gently defocused background, working aperture for low-light portraiture" },
  { id: "aperture-f4",    label: "f/4",    category: "aperture", description: "Balanced everyday DOF",          promptHint: "shot at f/4 — balanced depth of field where the subject is fully in focus and the background is suggested rather than detailed" },
  { id: "aperture-f5-6",  label: "f/5.6",  category: "aperture", description: "Sharp across the subject",      promptHint: "shot at f/5.6 — comfortable working aperture with edge-to-edge subject sharpness and a moderately rendered background" },
  { id: "aperture-f8",    label: "f/8",    category: "aperture", description: "Sweet-spot sharpness",           promptHint: "shot at f/8 — peak optical sharpness across the frame, the photographer's sweet spot for storytelling and editorial work" },
  { id: "aperture-f11",   label: "f/11",   category: "aperture", description: "Deep landscape DOF",             promptHint: "shot at f/11 — deep depth of field with foreground and distant elements both rendered crisply, classic landscape stop" },
  { id: "aperture-f16",   label: "f/16",   category: "aperture", description: "Hyperfocal, sun-stars",          promptHint: "shot stopped down to f/16 — hyperfocal depth of field with everything sharp, sunlight rendered as crisp diffraction stars on bright highlights" },

  // ---------------------------- Shutter Speed ----------------------------
  { id: "shutter-1-30",       label: "1/30 (handheld blur)", category: "shutter-speed", description: "Hint of handheld motion",  promptHint: "captured at 1/30s — a hint of handheld motion blur on moving subjects, slight camera shake suggesting an in-the-moment documentary feel" },
  { id: "shutter-1-60",       label: "1/60",                 category: "shutter-speed", description: "Standard everyday shutter", promptHint: "captured at 1/60s — standard everyday shutter speed, sharp on still subjects with subtle blur on fast motion" },
  { id: "shutter-1-200",      label: "1/200",                category: "shutter-speed", description: "Crisp on most subjects",    promptHint: "captured at 1/200s — crisp on most subjects, the working shutter speed for portraits and general photography" },
  { id: "shutter-1-500",      label: "1/500",                category: "shutter-speed", description: "Sharp on quick action",     promptHint: "captured at 1/500s — sharp rendering of quick human action, hair and fabric mid-motion frozen with clean edges" },
  { id: "shutter-1-1000",     label: "1/1000 (action freeze)", category: "shutter-speed", description: "Frozen sports/wildlife",  promptHint: "captured at 1/1000s — frozen mid-air action, water droplets suspended in space, every fast motion crystallized with clinical sharpness" },
  { id: "shutter-long-1s",    label: "Long exposure (1s)",   category: "shutter-speed", description: "Streaks and motion trails", promptHint: "captured with a one-second long exposure — flowing motion rendered as smooth light trails and streaks, static subjects sharp while moving elements paint across the frame" },

  // ---------------------------- ISO ----------------------------
  { id: "iso-100",   label: "ISO 100 (clean)",        category: "iso", description: "Minimal noise, fine grain",         promptHint: "ISO 100 — pristinely clean image with virtually no noise, ultra-fine grain structure and rich tonal latitude" },
  { id: "iso-400",   label: "ISO 400",                category: "iso", description: "Slight texture, daily-driver ISO", promptHint: "ISO 400 — subtle film-like grain texture, the daily-driver sensitivity that retains detail with a hint of organic noise" },
  { id: "iso-800",   label: "ISO 800",                category: "iso", description: "Visible but pleasant grain",       promptHint: "ISO 800 — visible but pleasant grain pattern, evening-indoor sensitivity with a touch of analog character" },
  { id: "iso-1600",  label: "ISO 1600 (visible grain)", category: "iso", description: "Editorial low-light texture",   promptHint: "ISO 1600 — clearly visible grain, editorial low-light feel with rich texture and slightly muted shadows" },
  { id: "iso-3200",  label: "ISO 3200 (heavy grain)", category: "iso", description: "Pushed, gritty documentary feel", promptHint: "ISO 3200 — heavy push-processed grain, gritty documentary character with elevated shadow noise and a raw, journalistic texture" },
] as const

export const EXPOSURE_CATEGORY_ORDER: ReadonlyArray<ExposureCategory> = [
  "aperture",
  "shutter-speed",
  "iso",
]

export const EXPOSURE_CATEGORY_LABELS: Record<ExposureCategory, string> = {
  aperture: "Aperture",
  "shutter-speed": "Shutter Speed",
  iso: "ISO",
}

const exposureById = new Map<string, ExposureSettings>(
  EXPOSURE_SETTINGS.map((e) => [e.id, e]),
)

export function getExposure(id: string | undefined | null): ExposureSettings | undefined {
  if (!id) return undefined
  return exposureById.get(id)
}

export function getExposureLabel(id: string | undefined | null, fallback?: string): string {
  const e = getExposure(id)
  if (e) return e.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getExposurePromptHint(id: string | undefined | null): string {
  return getExposure(id)?.promptHint ?? ""
}

export const EXPOSURE_IDS: ReadonlyArray<string> = EXPOSURE_SETTINGS.map((e) => e.id)

/**
 * Maps each ExposureCategory to the consumer data field name that holds the
 * selected entry id for that category. Multi-category exposure: a consumer
 * (image/video) can independently set a value in each of the 3 dimensions.
 */
export const EXPOSURE_FIELD_BY_CATEGORY: Record<
  ExposureCategory,
  "aperture" | "shutterSpeed" | "isoValue"
> = {
  aperture: "aperture",
  "shutter-speed": "shutterSpeed",
  iso: "isoValue",
}

/**
 * Shape of the per-category exposure fields on ExposureSettingsData and any
 * consumer that opts in. All fields optional — user may set zero, one, or
 * all categories.
 */
export interface ExposureValue {
  aperture?: string
  shutterSpeed?: string
  isoValue?: string
}

const EXPOSURE_FIELDS_IN_ORDER: ReadonlyArray<readonly [keyof ExposureValue, ExposureCategory]> =
  EXPOSURE_CATEGORY_ORDER.map((cat) => [EXPOSURE_FIELD_BY_CATEGORY[cat], cat] as const)

/**
 * Aggregate all enabled per-category exposure prompt hints from a consumer's
 * data, in canonical category order (aperture, shutter-speed, iso).
 */
export function buildExposureHints(
  data: Record<string, unknown> & {
    aperture?: unknown
    shutterSpeed?: unknown
    isoValue?: unknown
  },
): string[] {
  const hints: string[] = []
  for (const [field] of EXPOSURE_FIELDS_IN_ORDER) {
    const id = data[field]
    if (typeof id !== "string" || id.length === 0) continue
    const hint = getExposurePromptHint(id)
    if (hint) hints.push(hint)
  }
  return hints
}
