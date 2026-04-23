/**
 * Canonical catalog of lighting choices.
 *
 * Lighting is a multi-category dimension of a shot — light comes from a
 * direction, has a stylistic intent (three-point, Rembrandt, low-key, etc.),
 * and is anchored to a time of day. Independent of optics (lens), framing,
 * camera motion, and capture medium (camera-format).
 *
 * Shared between the picker UI and the prompt-hint injection on both the
 * frontend DAG executor and the backend orchestrator.
 */

export type LightingCategory = "time-of-day" | "style" | "direction"

export interface Lighting {
  readonly id: string
  readonly label: string
  readonly category: LightingCategory
  readonly description: string
  readonly promptHint: string
}

export const LIGHTINGS: ReadonlyArray<Lighting> = [
  // Time of day (8)
  { id: "sunrise",       label: "Sunrise",       category: "time-of-day", description: "Warm low sun, long shadows",   promptHint: "sunrise lighting, warm low-angle sun with long shadows and soft golden tones" },
  { id: "golden-hour",   label: "Golden Hour",   category: "time-of-day", description: "Warm sunset glow",              promptHint: "golden hour lighting, warm sunset glow with soft directional sunlight and saturated golden tones" },
  { id: "noon",          label: "Noon",          category: "time-of-day", description: "Harsh overhead midday sun",     promptHint: "midday noon lighting, harsh overhead sun with high contrast and strong vertical shadows" },
  { id: "overcast",      label: "Overcast",      category: "time-of-day", description: "Soft diffused daylight",        promptHint: "overcast daylight, soft diffused light from a uniformly cloudy sky with no harsh shadows" },
  { id: "blue-hour",     label: "Blue Hour",     category: "time-of-day", description: "Cool dusk twilight",            promptHint: "blue hour twilight lighting, cool desaturated tones just after sunset with soft ambient light" },
  { id: "night",         label: "Night",         category: "time-of-day", description: "Deep night, low ambient",       promptHint: "night lighting, deep dark scene with minimal ambient illumination and high contrast highlights" },
  { id: "moonlight",     label: "Moonlight",     category: "time-of-day", description: "Cool blue moonlit scene",       promptHint: "moonlight, cool blue ambient illumination with soft directional moonlit highlights and deep shadows" },
  { id: "neon-night",    label: "Neon Night",    category: "time-of-day", description: "Saturated neon city night",     promptHint: "neon night lighting, saturated magenta and cyan neon glow against deep night ambient, urban cyberpunk feel" },

  // Style (10)
  { id: "three-point",   label: "Three-Point",   category: "style",       description: "Classic key + fill + back",    promptHint: "three-point lighting setup, balanced key light with fill and rim back-light, classical studio look" },
  { id: "rembrandt",     label: "Rembrandt",     category: "style",       description: "Triangle of light on cheek",   promptHint: "Rembrandt lighting, distinctive triangle of light on the shadow-side cheek, painterly chiaroscuro" },
  { id: "chiaroscuro",   label: "Chiaroscuro",   category: "style",       description: "Strong light/dark contrast",   promptHint: "chiaroscuro lighting, dramatic strong contrast between deep shadows and bright highlights" },
  { id: "silhouette",    label: "Silhouette",    category: "style",       description: "Subject as pure shape",        promptHint: "silhouette lighting, subject rendered as a pure dark shape against a much brighter background" },
  { id: "high-key",      label: "High-Key",      category: "style",       description: "Bright, low-contrast",         promptHint: "high-key lighting, bright low-contrast scene with minimal shadows and a light overall tone" },
  { id: "low-key",       label: "Low-Key",       category: "style",       description: "Dark, high-contrast",          promptHint: "low-key lighting, dark high-contrast scene with deep shadows and selective highlights" },
  { id: "split",         label: "Split",         category: "style",       description: "Half-lit half-shadow face",    promptHint: "split lighting, light hitting only one half of the face with the other half in deep shadow" },
  { id: "hard",          label: "Hard",          category: "style",       description: "Sharp-edged shadows",          promptHint: "hard lighting, sharp-edged crisp shadows from an undiffused direct light source" },
  { id: "soft",          label: "Soft",          category: "style",       description: "Diffused gentle light",        promptHint: "soft diffused lighting, gentle wraparound light with smooth shadow transitions" },
  { id: "practical",     label: "Practical",     category: "style",       description: "In-scene visible lights",      promptHint: "practical lighting, illumination from visible in-scene sources (lamps, windows, screens, candles)" },
  // Modern social-video lighting styles
  { id: "ring-light",        label: "Ring Light",        category: "style", description: "Beauty/vlog ring catchlight",  promptHint: "ring light setup, even frontal illumination with the unmistakable circular catchlight in the eyes typical of beauty and vlog content" },
  { id: "phone-screen-glow", label: "Phone Screen Glow", category: "style", description: "Cool screen underlight",       promptHint: "phone screen glow lighting, cool blue underlighting from a phone screen casting upward onto the subject's face" },
  { id: "selfie-natural",    label: "Selfie Natural",    category: "style", description: "Window-light selfie",          promptHint: "window-light selfie aesthetic, soft natural daylight from a single window with casual handheld framing" },
  { id: "natural",           label: "Natural",           category: "style", description: "Available ambient light",       promptHint: "natural lighting, available ambient light with no artificial setup, organic and unpolished" },
  { id: "volumetric",        label: "Volumetric",        category: "style", description: "Visible light beams in haze",  promptHint: "volumetric lighting, visible god-ray light beams cutting through hazy atmosphere with strong directional shafts" },
  { id: "noir",              label: "Noir",              category: "style", description: "High-contrast B&W film noir",  promptHint: "film noir lighting, high-contrast black-and-white aesthetic with hard chiaroscuro shadows, venetian-blind slat shadows, and crushed deep blacks" },

  // Direction (6)
  { id: "front",         label: "Front",         category: "direction",   description: "Light from camera direction",  promptHint: "front lighting, light coming from the camera direction, flat even illumination across the subject" },
  { id: "side",          label: "Side",          category: "direction",   description: "Light from one side",          promptHint: "side lighting, light coming from the side of the subject, emphasizing texture and form" },
  { id: "back-rim",      label: "Back / Rim",    category: "direction",   description: "Backlight rim around subject", promptHint: "back-light or rim-light, light coming from behind the subject creating a bright rim around their silhouette" },
  { id: "top-overhead",  label: "Top / Overhead",category: "direction",   description: "Light from directly above",    promptHint: "top-down overhead lighting, light coming from directly above the subject creating shadows under the eyes and chin" },
  { id: "under-uplight", label: "Under / Uplight",category: "direction",  description: "Light from below",             promptHint: "uplighting from below, light coming from below the subject creating an unsettling theatrical look" },
  { id: "window",        label: "Window",        category: "direction",   description: "Soft sidelight from window",   promptHint: "window lighting, soft directional light from a single window source with natural falloff" },
] as const

export const LIGHTING_CATEGORY_ORDER: ReadonlyArray<LightingCategory> = [
  "time-of-day",
  "style",
  "direction",
]

export const LIGHTING_CATEGORY_LABELS: Record<LightingCategory, string> = {
  "time-of-day": "Time of Day",
  style: "Style",
  direction: "Direction",
}

const lightingById = new Map<string, Lighting>(LIGHTINGS.map((l) => [l.id, l]))

export function getLighting(id: string | undefined | null): Lighting | undefined {
  if (!id) return undefined
  return lightingById.get(id)
}

export function getLightingLabel(id: string | undefined | null, fallback?: string): string {
  const l = getLighting(id)
  if (l) return l.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getLightingPromptHint(id: string | undefined | null): string {
  return getLighting(id)?.promptHint ?? ""
}

export const LIGHTING_IDS: ReadonlyArray<string> = LIGHTINGS.map((l) => l.id)

/**
 * Maps each LightingCategory to the consumer data field name that holds the
 * selected entry id for that category. Multi-category lighting: a consumer
 * (image/video) can independently set a value in each of the 3 dimensions.
 *
 * Field names use 'lighting' prefix where the category name is generic or
 * would collide with other dimensions (e.g. Temporal also has a 'direction'
 * category; 'style' is generic across many dims).
 */
export const LIGHTING_FIELD_BY_CATEGORY: Record<
  LightingCategory,
  "timeOfDay" | "lightingStyle" | "lightingDirection"
> = {
  "time-of-day": "timeOfDay",
  style: "lightingStyle",
  direction: "lightingDirection",
}

/**
 * Shape of the per-category lighting fields on LightingData and all 9 consumer
 * data types. All fields optional — user may set zero, one, or all categories.
 */
export interface LightingValue {
  timeOfDay?: string
  lightingStyle?: string
  lightingDirection?: string
}

/**
 * Aggregate all enabled per-category lighting prompt hints from a consumer's
 * data, in canonical category order (time-of-day, style, direction).
 *
 * Accepts a loosely typed record (the helper is shared between strongly typed
 * frontend node data and the backend's `Record<string, unknown>` workflow
 * data). Non-string values are ignored.
 *
 * @param data the consumer data record (must include optional timeOfDay /
 *   lightingStyle / lightingDirection fields)
 */
export function buildLightingHints(
  data: Record<string, unknown> & {
    timeOfDay?: unknown
    lightingStyle?: unknown
    lightingDirection?: unknown
  },
): string[] {
  const hints: string[] = []
  for (const category of LIGHTING_CATEGORY_ORDER) {
    const field = LIGHTING_FIELD_BY_CATEGORY[category]
    const id = data[field]
    if (typeof id !== "string" || id.length === 0) continue
    const hint = getLightingPromptHint(id)
    if (hint) hints.push(hint)
  }
  return hints
}
