/**
 * Canonical catalog of color/look choices.
 *
 * Color/look is a multi-category dimension of a shot — it covers both
 * stylistic color palettes (warm, cool, teal-orange, etc.) and film-stock
 * emulations (Kodak Portra, Cinestill 800T, bleach bypass, etc.). Independent
 * of optics (lens), framing, camera motion, capture medium (camera-format),
 * and lighting setup.
 *
 * Shared between the picker UI and the prompt-hint injection on both the
 * frontend DAG executor and the backend orchestrator.
 */

export type ColorLookCategory = "palette" | "film-emulation" | "social-preset"

export interface ColorLook {
  readonly id: string
  readonly label: string
  readonly category: ColorLookCategory
  readonly description: string
  readonly promptHint: string
}

export const COLOR_LOOKS: ReadonlyArray<ColorLook> = [
  // Palette (9)
  { id: "warm",            label: "Warm",            category: "palette", description: "Warm orange/red tones",          promptHint: "warm color palette, orange and red tones throughout the image with golden highlights" },
  { id: "cool",            label: "Cool",            category: "palette", description: "Cool blue/teal tones",            promptHint: "cool color palette, blue and teal tones throughout the image with subdued warm accents" },
  { id: "teal-orange",     label: "Teal & Orange",   category: "palette", description: "Hollywood complementary grade",   promptHint: "teal and orange color grade, warm skin tones against cool teal shadows, Hollywood blockbuster look" },
  { id: "desaturated",     label: "Desaturated",     category: "palette", description: "Low saturation, muted",           promptHint: "desaturated color grading, muted low-saturation tones throughout, almost monochromatic feel" },
  { id: "monochrome-bw",   label: "Monochrome B&W",  category: "palette", description: "Pure black and white",            promptHint: "monochrome black and white, pure grayscale image with no color information" },
  { id: "sepia",           label: "Sepia",           category: "palette", description: "Vintage brown tone",              promptHint: "sepia toned image, warm brown vintage monochrome with classic photographic feel" },
  { id: "pastel",          label: "Pastel",          category: "palette", description: "Soft, low-contrast pastels",      promptHint: "pastel color palette, soft low-contrast pastel hues with light airy tones" },
  { id: "high-contrast",   label: "High Contrast",   category: "palette", description: "Punchy contrast, deep blacks",   promptHint: "high contrast color grade, punchy saturated colors with crushed deep blacks and bright highlights" },
  { id: "vibrant",         label: "Vibrant",         category: "palette", description: "Highly saturated colors",         promptHint: "vibrant saturated color palette, bold rich colors with high saturation throughout" },

  // Film emulation (9)
  { id: "kodak-portra",    label: "Kodak Portra",    category: "film-emulation", description: "Soft skin tones, fine grain",  promptHint: "Kodak Portra film stock emulation, soft natural skin tones with fine grain and gentle pastel color rendering" },
  { id: "kodak-ektar",     label: "Kodak Ektar",     category: "film-emulation", description: "Saturated, fine grain",        promptHint: "Kodak Ektar film stock emulation, ultra-saturated colors with fine grain and high color contrast" },
  { id: "kodak-vision3",   label: "Kodak Vision3",   category: "film-emulation", description: "Cinema motion picture stock",  promptHint: "Kodak Vision3 motion picture film emulation, cinematic warm color rendering with smooth highlight rolloff" },
  { id: "fuji-pro-400h",   label: "Fuji Pro 400H",   category: "film-emulation", description: "Pastel greens and skies",      promptHint: "Fuji Pro 400H film stock emulation, soft pastel greens and creamy blue skies with gentle warm skin tones" },
  { id: "cinestill-800t",  label: "Cinestill 800T",  category: "film-emulation", description: "Tungsten film with red halation", promptHint: "Cinestill 800T film stock emulation, tungsten-balanced color with characteristic red halation around highlights" },
  { id: "bleach-bypass",   label: "Bleach Bypass",   category: "film-emulation", description: "High contrast, desaturated",   promptHint: "bleach bypass processing, high contrast with desaturated colors and silver-retention metallic look" },
  { id: "technicolor",     label: "Technicolor 3-strip", category: "film-emulation", description: "Vivid retro Technicolor",  promptHint: "Technicolor 3-strip emulation, vivid saturated red/green/blue color separation with classic Hollywood golden-age look" },
  { id: "day-for-night",   label: "Day-for-Night",   category: "film-emulation", description: "Daylight graded as night",     promptHint: "day-for-night color grading, daylight footage graded with deep blue tones and crushed shadows to simulate moonlit night" },
  { id: "cross-processed", label: "Cross-Processed", category: "film-emulation", description: "Color shifts from xpro",        promptHint: "cross-processed film look, slide film developed in print chemistry causing surreal color shifts and pushed contrast" },

  // Social-preset (modern social-video aesthetics — distinct from analog film emulations)
  { id: "instagram-warm",     label: "Instagram Warm",     category: "social-preset", description: "Valencia-style warm filter",   promptHint: "Instagram-style warm filter aesthetic, slightly faded warm highlights with creamy mid-tones, Valencia-preset feel" },
  { id: "tiktok-saturated",   label: "TikTok Saturated",   category: "social-preset", description: "Bright punchy social palette", promptHint: "TikTok-style oversaturated bright palette, punchy reds and blues with high contrast and vivid skin tones" },
  { id: "youtube-vlog-flat",  label: "YouTube Vlog Flat",  category: "social-preset", description: "Clean vlog flat grade",        promptHint: "YouTube vlog clean flat color grade, neutral natural color rendition with even skin tones and pleasant ambient" },
  { id: "iphone-hdr",         label: "iPhone HDR",         category: "social-preset", description: "Computational HDR look",       promptHint: "iPhone computational HDR look with extended highlight range, lifted shadows, and slightly hyperreal local-contrast enhancement" },
] as const

export const COLOR_LOOK_CATEGORY_ORDER: ReadonlyArray<ColorLookCategory> = [
  "palette",
  "film-emulation",
  "social-preset",
]

export const COLOR_LOOK_CATEGORY_LABELS: Record<ColorLookCategory, string> = {
  palette: "Palette",
  "film-emulation": "Film Emulation",
  "social-preset": "Social Preset",
}

const colorLookById = new Map<string, ColorLook>(COLOR_LOOKS.map((c) => [c.id, c]))

export function getColorLook(id: string | undefined | null): ColorLook | undefined {
  if (!id) return undefined
  return colorLookById.get(id)
}

export function getColorLookLabel(id: string | undefined | null, fallback?: string): string {
  const c = getColorLook(id)
  if (c) return c.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())
}

export function getColorLookPromptHint(id: string | undefined | null): string {
  return getColorLook(id)?.promptHint ?? ""
}

export const COLOR_LOOK_IDS: ReadonlyArray<string> = COLOR_LOOKS.map((c) => c.id)
