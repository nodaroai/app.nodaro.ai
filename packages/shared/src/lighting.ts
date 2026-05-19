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

export type LightingCategory =
  | "time-of-day"
  | "style"
  | "direction"
  | "lighting-ratio"
  | "color-temperature"

export interface Lighting {
  readonly id: string
  readonly label: string
  readonly category: LightingCategory
  readonly description: string
  readonly promptHint: string
}

export const LIGHTINGS: ReadonlyArray<Lighting> = [
  // Time of day (15)
  { id: "dawn",          label: "Dawn",          category: "time-of-day", description: "Pre-sunrise pale glow",         promptHint: "dawn lighting, the pre-sunrise pale glow with deep blue ambient tones transitioning to soft pink and orange at the horizon, low contrast, cool ambient" },
  { id: "sunrise",       label: "Sunrise",       category: "time-of-day", description: "Warm low sun, long shadows",   promptHint: "sunrise lighting, warm low-angle sun with long shadows and soft golden tones" },
  { id: "morning",       label: "Morning",       category: "time-of-day", description: "Bright fresh morning light",    promptHint: "morning lighting, bright fresh ambient daylight with soft directional sun, warm white tones and clean shadows" },
  { id: "noon",          label: "Noon",          category: "time-of-day", description: "Harsh overhead midday sun",     promptHint: "midday noon lighting, harsh overhead sun with high contrast and strong vertical shadows" },
  { id: "harsh-midday",  label: "Harsh Midday",  category: "time-of-day", description: "Bleached white-sun zenith",     promptHint: "harsh midday white-sun lighting, sun directly overhead at zenith, blown-out white highlights and short hard shadows pooled directly beneath the subject" },
  { id: "afternoon",     label: "Afternoon",     category: "time-of-day", description: "Warm late afternoon glow",      promptHint: "afternoon lighting, warm directional late-afternoon sun with elongated shadows, saturated amber tones leading into golden hour" },
  { id: "overcast",      label: "Overcast",      category: "time-of-day", description: "Soft diffused daylight",        promptHint: "overcast daylight, soft diffused light from a uniformly cloudy sky with no harsh shadows" },
  { id: "golden-hour",   label: "Golden Hour",   category: "time-of-day", description: "Warm sunset glow",              promptHint: "golden hour lighting, warm sunset glow with soft directional sunlight and saturated golden tones" },
  { id: "dusk",          label: "Dusk",          category: "time-of-day", description: "Post-sunset fading light",      promptHint: "dusk lighting, the post-sunset fading light with deepening blue sky, residual warm horizon glow, and rising ambient cool tones" },
  { id: "blue-hour",     label: "Blue Hour",     category: "time-of-day", description: "Cool dusk twilight",            promptHint: "blue hour twilight lighting, cool desaturated tones just after sunset with soft ambient light" },
  { id: "twilight",      label: "Twilight",      category: "time-of-day", description: "Between blue hour and night",   promptHint: "twilight lighting, the transitional dusk between blue hour and full night, deep indigo sky with the last residual ambient glow on the horizon and emerging artificial city lights" },
  { id: "night",         label: "Night",         category: "time-of-day", description: "Deep night, low ambient",       promptHint: "night lighting, deep dark scene with minimal ambient illumination and high contrast highlights" },
  { id: "midnight",      label: "Midnight",      category: "time-of-day", description: "Deepest night, near-black sky", promptHint: "midnight lighting, the deepest part of night with a near-black sky, minimal ambient illumination, scattered cool moonlight or starlight as the only natural source" },
  { id: "moonlight",     label: "Moonlight",     category: "time-of-day", description: "Cool blue moonlit scene",       promptHint: "moonlight, cool blue ambient illumination with soft directional moonlit highlights and deep shadows" },
  { id: "neon-night",    label: "Neon Night",    category: "time-of-day", description: "Saturated neon city night",     promptHint: "neon night lighting, saturated magenta and cyan neon glow against deep night ambient, urban cyberpunk feel" },

  // Style (31)
  { id: "three-point",   label: "Three-Point",   category: "style",       description: "Classic key + fill + back",    promptHint: "three-point lighting setup, balanced key light with fill and rim back-light, classical studio look" },
  { id: "rembrandt",     label: "Rembrandt",     category: "style",       description: "Triangle of light on cheek",   promptHint: "Rembrandt lighting, distinctive triangle of light on the shadow-side cheek, painterly chiaroscuro" },
  { id: "chiaroscuro",   label: "Chiaroscuro",   category: "style",       description: "Strong light/dark contrast",   promptHint: "chiaroscuro lighting, dramatic strong contrast between deep shadows and bright highlights" },
  { id: "silhouette",    label: "Silhouette",    category: "style",       description: "Subject as pure shape",        promptHint: "silhouette lighting, subject rendered as a pure dark shape against a much brighter background" },
  { id: "high-key",      label: "High-Key",      category: "style",       description: "Bright, low-contrast",         promptHint: "high-key lighting, bright low-contrast scene with minimal shadows and a light overall tone" },
  { id: "low-key",       label: "Low-Key",       category: "style",       description: "Dark, high-contrast",          promptHint: "low-key lighting, dark high-contrast scene with deep shadows and selective highlights" },
  { id: "split",         label: "Split",         category: "style",       description: "Half-lit half-shadow face",    promptHint: "split lighting, light hitting only one half of the face with the other half in deep shadow" },
  // Classical portrait lighting setups
  { id: "butterfly",     label: "Butterfly",     category: "style",       description: "Glamour, nose-shadow butterfly", promptHint: "butterfly portrait lighting, key light placed directly above and slightly in front of the subject casting a small symmetrical butterfly-shaped shadow under the nose, classic Hollywood glamour with even illumination across both cheeks" },
  { id: "loop",          label: "Loop",          category: "style",       description: "Most natural portrait setup",   promptHint: "loop portrait lighting, key light slightly to one side and above eye level casting a small loop-shaped nose shadow on the cheek that does not touch the shadow side, the most natural and flattering classical portrait setup" },
  { id: "broad",         label: "Broad",         category: "style",       description: "Wider face, friendly key",      promptHint: "broad portrait lighting, key light striking the side of the face turned toward the camera so the larger lit cheek dominates the frame, makes the face appear wider and more open with a friendly approachable feel" },
  { id: "short",         label: "Short",         category: "style",       description: "Slimming, dramatic key",        promptHint: "short portrait lighting, key light striking the side of the face turned away from the camera so the larger plane of the face falls into shadow, slims the face and adds dramatic dimension favored in editorial and male portraiture" },
  { id: "hatchet",       label: "Hatchet",       category: "style",       description: "Overhead skim, deep side shadow", promptHint: "hatchet portrait lighting, hard overhead light skimming the face from one side and leaving the opposite side in deep unrelieved shadow, theatrical and severe with a sharply divided contour" },
  { id: "clamshell",     label: "Clamshell",     category: "style",       description: "Beauty key + bottom reflector", promptHint: "clamshell beauty lighting, soft key light above the subject paired with a reflector or fill below the chin sandwiching the face evenly between two light sources, glossy commercial beauty look with twin catchlights and minimal shadow under the jaw" },
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
  // Flash & camera-flash styles
  { id: "on-camera-flash",   label: "On-Camera Flash",   category: "style", description: "Paparazzi/iPhone direct flash", promptHint: "on-camera flash lighting, harsh direct frontal flash with blown-out highlights on skin, hard shadow falloff behind the subject and a darkened background, paparazzi and iPhone-flash signature" },
  { id: "mirror-bounce-flash", label: "Mirror-Bounce Flash", category: "style", description: "Mirror-selfie flash bounce", promptHint: "mirror-selfie flash lighting, yellowish uneven LED-or-flash bouncing off the mirror surface with a hot flare spot, partially obscured face by the phone, classic mirror-selfie aesthetic" },
  { id: "bounced-flash",     label: "Bounced Flash",     category: "style", description: "Soft ceiling-bounced fill",   promptHint: "bounced flash lighting, on-camera flash redirected off a ceiling or wall to create soft top-down fill with gentle shadows, even skin tones and natural ambient feel" },
  { id: "softbox-key",       label: "Softbox Key",       category: "style", description: "Large diffused fashion key",   promptHint: "softbox key lighting, large diffused fashion-studio key light producing gentle wraparound illumination, soft falloff and clean even skin rendering" },
  { id: "beauty-dish",       label: "Beauty Dish",       category: "style", description: "Hero light, crisp falloff",    promptHint: "beauty dish lighting, semi-hard hero light with crisp shadow falloff and a distinctive round catchlight, slightly punchy contour and contrast favored in beauty and editorial portraits" },
  { id: "gridded-snoot",     label: "Gridded Snoot",     category: "style", description: "Tight focused pool of light",  promptHint: "gridded snoot lighting, tightly focused circular pool of light isolating the subject's face or shoulders against deep surrounding shadow, theatrical and controlled" },
  { id: "silk-diffusion",    label: "Silk Diffusion",    category: "style", description: "Silk-softened gentle key",     promptHint: "silk diffusion lighting, gentle key light passed through a large silk to soften shadow edges, producing creamy gradients and flattering skin tones" },
  { id: "kicker-rim",        label: "Kicker / Rim Accent", category: "style", description: "Low-side accent separator",   promptHint: "kicker rim accent lighting, low side-rear accent light skimming the subject's edge to separate them from a darker background, adds dimension and depth" },
  { id: "candlelight",       label: "Candlelight",       category: "style", description: "Warm flickering firelight",    promptHint: "candlelight or firelight, warm flickering tungsten glow with soft falloff, low color temperature and gentle dancing shadows on nearby surfaces" },
  { id: "edison-tungsten",   label: "Edison Tungsten",   category: "style", description: "Cozy warm globe-bulb glow",    promptHint: "Edison-bulb tungsten lighting, warm low-CRI globe-bulb glow with visible filament hot-spots, cozy bar or cafe atmosphere with amber-orange ambient" },
  { id: "dappled-light",     label: "Dappled / Leaf-Filtered", category: "style", description: "Speckled foliage light",  promptHint: "dappled leaf-filtered lighting, sunlight broken into a speckled pattern of bright spots and soft shadows as it passes through overhead foliage, organic and painterly" },
  { id: "raking-sidelight",  label: "Raking Sidelight",  category: "style", description: "Extreme low side, texture",    promptHint: "raking sidelight, extreme low-angle side light skimming across the surface to exaggerate texture and microcontour, long parallel shadows reveal every detail" },
  { id: "stage-spotlight",   label: "Stage Spotlight",   category: "style", description: "Single hard overhead spot",    promptHint: "stage spotlight lighting, single hard overhead theatre spotlight isolating the subject in a circular pool of light against pure black surroundings, dust motes catching the beam" },
  { id: "underwater-caustics", label: "Underwater Caustics", category: "style", description: "Rippled refracted patterns", promptHint: "underwater caustics lighting, rippled wavy refracted light patterns dancing across the subject and surroundings, cool aquatic blue-green palette with shimmering highlights" },
  { id: "bioluminescence",   label: "Bioluminescence",   category: "style", description: "Cool eerie biological glow",   promptHint: "bioluminescence lighting, cool eerie cyan-green glow emanating from biological sources, soft self-illuminated highlights against deep ambient darkness, otherworldly atmosphere" },

  // Direction (8)
  { id: "front",         label: "Front",         category: "direction",   description: "Light from camera direction",  promptHint: "front lighting, light coming from the camera direction, flat even illumination across the subject" },
  { id: "three-quarter", label: "3/4 Light",     category: "direction",   description: "Classic portrait key angle",   promptHint: "three-quarter light, classic portrait key angle split between front and side at roughly 45 degrees off-camera, sculpts the face with a visible shadow on the far cheek and a defined nose shadow" },
  { id: "side",          label: "Side",          category: "direction",   description: "Light from one side",          promptHint: "side lighting, light coming from the side of the subject, emphasizing texture and form" },
  { id: "back-rim",      label: "Back / Rim",    category: "direction",   description: "Backlight rim around subject", promptHint: "back-light or rim-light, light coming from behind the subject creating a bright rim around their silhouette" },
  { id: "silhouette-backlight", label: "Silhouette Backlight", category: "direction", description: "Bright halo, dark subject", promptHint: "silhouette backlight, strong light source directly behind the subject rendering them as a dark shape with a luminous halo edge and bright background bloom, dramatic contour against the sky or window" },
  { id: "top-overhead",  label: "Top / Overhead",category: "direction",   description: "Light from directly above",    promptHint: "top-down overhead lighting, light coming from directly above the subject creating shadows under the eyes and chin" },
  { id: "under-uplight", label: "Under / Uplight",category: "direction",  description: "Light from below",             promptHint: "uplighting from below, light coming from below the subject creating an unsettling theatrical look" },
  { id: "window",        label: "Window",        category: "direction",   description: "Soft sidelight from window",   promptHint: "window lighting, soft directional light from a single window source with natural falloff" },

  // Lighting ratio (6) — relative key-to-shadow brightness
  { id: "ratio-1-1",  label: "1:1",  category: "lighting-ratio", description: "Flat, no shadow contrast",       promptHint: "1:1 lighting ratio, flat even illumination across the subject with no contrast between key and fill, beauty and catalog look that flattens dimension" },
  { id: "ratio-1-2",  label: "1:2",  category: "lighting-ratio", description: "Soft one-stop falloff",          promptHint: "1:2 lighting ratio, gentle soft modeling with roughly one stop of falloff from key to shadow side, classic flattering portraiture with mild dimension" },
  { id: "ratio-1-3",  label: "1:3",  category: "lighting-ratio", description: "Moderate two-stop contrast",     promptHint: "1:3 lighting ratio, moderate contrast with about two stops between the lit and shadow sides, well-defined facial dimension and visible but recovered shadow detail" },
  { id: "ratio-1-4",  label: "1:4",  category: "lighting-ratio", description: "Strong editorial contrast",      promptHint: "1:4 lighting ratio, strong contrast with deepening shadows on the unlit side, dramatic editorial feel with sculpted form and minimal shadow detail" },
  { id: "ratio-1-8",  label: "1:8",  category: "lighting-ratio", description: "Extreme low-key chiaroscuro",    promptHint: "1:8 lighting ratio, extreme chiaroscuro with near-black shadow side balanced against a single bright key, classic low-key cinema atmosphere" },
  { id: "ratio-1-16", label: "1:16", category: "lighting-ratio", description: "Single-source film-noir falloff", promptHint: "1:16 lighting ratio, single-source key against pitch-black shadow side, theatrical film-noir falloff with no fill and crushed unlit detail" },

  // Color temperature (6) — Kelvin from warm to cool
  { id: "temp-2700k", label: "2700K Candle",   category: "color-temperature", description: "Deep amber candle/tungsten",   promptHint: "2700K warm candle and low-tungsten color temperature, deep amber and orange cast across the scene, intimate and cozy mood with rich golden highlights" },
  { id: "temp-3200k", label: "3200K Tungsten", category: "color-temperature", description: "Warm yellow interior",         promptHint: "3200K tungsten color temperature, warm yellow-orange cast typical of classic incandescent home interiors, lived-in domestic ambient" },
  { id: "temp-4000k", label: "4000K Mixed",    category: "color-temperature", description: "Neutral white",                promptHint: "4000K neutral white color temperature, balanced midpoint between warm tungsten and cool daylight, clean office and mixed-source feel without strong color cast" },
  { id: "temp-5600k", label: "5600K Daylight", category: "color-temperature", description: "Daylight-balanced midday sun", promptHint: "5600K daylight-balanced color temperature, neutral midday white sun with accurate color rendering and no warm or cool bias" },
  { id: "temp-6500k", label: "6500K Overcast", category: "color-temperature", description: "Slightly cool blue cast",      promptHint: "6500K overcast-cool color temperature, slightly blue cast typical of overcast skies and high-noon shadow areas, subtly cool and clinical" },
  { id: "temp-9000k", label: "9000K Shade",    category: "color-temperature", description: "Distinctly cool blue shade",   promptHint: "9000K open-shade color temperature, distinctly cool blue cast found in deep shade and cloud-shadowed mountain air, chilled and atmospheric" },
] as const

export const LIGHTING_CATEGORY_ORDER: ReadonlyArray<LightingCategory> = [
  "time-of-day",
  "style",
  "direction",
  "lighting-ratio",
  "color-temperature",
]

export const LIGHTING_CATEGORY_LABELS: Record<LightingCategory, string> = {
  "time-of-day": "Time of Day",
  style: "Style",
  direction: "Direction",
  "lighting-ratio": "Lighting Ratio",
  "color-temperature": "Color Temperature",
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
  | "timeOfDay"
  | "lightingStyle"
  | "lightingDirection"
  | "lightingRatio"
  | "colorTemperature"
> = {
  "time-of-day": "timeOfDay",
  style: "lightingStyle",
  direction: "lightingDirection",
  "lighting-ratio": "lightingRatio",
  "color-temperature": "colorTemperature",
}

/**
 * Shape of the per-category lighting fields on LightingData and all 9 consumer
 * data types. All fields optional — user may set zero, one, or all categories.
 */
export interface LightingValue {
  timeOfDay?: string
  /** Lighting style — single id or up to 2 ids for layered setups
   *  (e.g. ["key", "rim"], ["soft", "hard"], ["beauty-dish", "kicker"]). */
  lightingStyle?: string | ReadonlyArray<string>
  lightingDirection?: string
  /** Lighting ratio id from LIGHTINGS (relative key-to-shadow brightness, e.g. "ratio-1-2"). */
  lightingRatio?: string
  /** Color temperature id from LIGHTINGS (Kelvin warmth/coolness, e.g. "temp-5600k"). */
  colorTemperature?: string
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
    lightingRatio?: unknown
    colorTemperature?: unknown
  },
): string[] {
  const hints: string[] = []
  for (const category of LIGHTING_CATEGORY_ORDER) {
    const field = LIGHTING_FIELD_BY_CATEGORY[category]
    const raw = data[field]
    // lightingStyle accepts string | string[] (multi-pick max 2). Other
    // categories are single-pick and may also tolerate arrays defensively.
    if (typeof raw === "string" && raw.length > 0) {
      const hint = getLightingPromptHint(raw)
      if (hint) hints.push(hint)
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item !== "string" || item.length === 0) continue
        const hint = getLightingPromptHint(item)
        if (hint) hints.push(hint)
      }
    }
  }
  return hints
}
