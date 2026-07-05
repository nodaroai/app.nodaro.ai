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
  // Palette (13)
  { id: "warm",            label: "Warm",            category: "palette", description: "Warm orange/red tones",          promptHint: "warm color palette, orange and red tones throughout the image with golden highlights" },
  { id: "cool",            label: "Cool",            category: "palette", description: "Cool blue/teal tones",            promptHint: "cool color palette, blue and teal tones throughout the image with subdued warm accents" },
  { id: "teal-orange",     label: "Teal & Orange",   category: "palette", description: "Hollywood complementary grade",   promptHint: "teal and orange color grade, warm skin tones against cool teal shadows, Hollywood blockbuster look" },
  { id: "split-toning",    label: "Split Toning",    category: "palette", description: "Cool shadows, warm highlights",   promptHint: "split-toning color grade, cool blue-green tinted shadows paired with warm amber highlights, nuanced tonal separation distinct from a flat teal-orange wash" },
  { id: "selective-color", label: "Selective Color", category: "palette", description: "B&W with one accent color",       promptHint: "selective color treatment, image rendered nearly monochromatic black-and-white with a single accent hue (such as red lipstick or a red dress) preserved in full saturation against the desaturated frame" },
  { id: "faded-matte",     label: "Faded Matte",     category: "palette", description: "Lifted blacks, milky low-contrast", promptHint: "faded matte color grade, lifted blacks and milky low-contrast shadows with soft hazy highlights, flat Instagram-soft aesthetic with reduced dynamic range" },
  { id: "log-flat",        label: "Log Flat",        category: "palette", description: "Pre-grade S-Log/V-Log neutral",   promptHint: "log-flat ungraded footage look, washed-out neutral S-Log or V-Log appearance with low contrast and desaturated muddy mids before any creative color grading is applied" },
  { id: "desaturated",     label: "Desaturated",     category: "palette", description: "Low saturation, muted",           promptHint: "desaturated color grading, muted low-saturation tones throughout, almost monochromatic feel" },
  { id: "monochrome-bw",   label: "Monochrome B&W",  category: "palette", description: "Pure black and white",            promptHint: "monochrome black and white, pure grayscale image with no color information" },
  { id: "sepia",           label: "Sepia",           category: "palette", description: "Vintage brown tone",              promptHint: "sepia toned image, warm brown vintage monochrome with classic photographic feel" },
  { id: "pastel",          label: "Pastel",          category: "palette", description: "Soft, low-contrast pastels",      promptHint: "pastel color palette, soft low-contrast pastel hues with light airy tones" },
  { id: "high-contrast",   label: "High Contrast",   category: "palette", description: "Punchy contrast, deep blacks",   promptHint: "high contrast color grade, punchy saturated colors with crushed deep blacks and bright highlights" },
  { id: "vibrant",         label: "Vibrant",         category: "palette", description: "Highly saturated colors",         promptHint: "vibrant saturated color palette, bold rich colors with high saturation throughout" },

  // Film emulation (13)
  { id: "kodak-portra",    label: "Kodak Portra",    category: "film-emulation", description: "Soft skin tones, fine grain",  promptHint: "Kodak Portra film stock emulation, soft natural skin tones with fine grain and gentle pastel color rendering" },
  { id: "kodak-ektar",     label: "Kodak Ektar",     category: "film-emulation", description: "Saturated, fine grain",        promptHint: "Kodak Ektar film stock emulation, ultra-saturated colors with fine grain and high color contrast" },
  { id: "kodak-vision3",   label: "Kodak Vision3",   category: "film-emulation", description: "Cinema motion picture stock",  promptHint: "Kodak Vision3 motion picture film emulation, cinematic warm color rendering with smooth highlight rolloff" },
  { id: "fuji-pro-400h",   label: "Fuji Pro 400H",   category: "film-emulation", description: "Pastel greens and skies",      promptHint: "Fuji Pro 400H film stock emulation, soft pastel greens and creamy blue skies with gentle warm skin tones" },
  { id: "cinestill-800t",  label: "Cinestill 800T",  category: "film-emulation", description: "Tungsten film with red halation", promptHint: "Cinestill 800T film stock emulation, tungsten-balanced color with characteristic red halation around highlights" },
  { id: "bleach-bypass",   label: "Bleach Bypass",   category: "film-emulation", description: "High contrast, desaturated",   promptHint: "bleach bypass processing, high contrast with desaturated colors and silver-retention metallic look" },
  { id: "technicolor",     label: "Technicolor 3-strip", category: "film-emulation", description: "Vivid retro Technicolor",  promptHint: "Technicolor 3-strip emulation, vivid saturated red/green/blue color separation with classic Hollywood golden-age look" },
  { id: "two-strip-technicolor", label: "Two-Strip Technicolor", category: "film-emulation", description: "1920s-30s red-blue Technicolor", promptHint: "two-strip Technicolor emulation, archaic 1920s and 1930s red-and-blue-only color process with limited green range, dusty rose reds against cyan blues, period-piece early-Hollywood feel distinct from later three-strip" },
  { id: "eastman-color",   label: "Eastman Color",   category: "film-emulation", description: "1950s/60s warm faded stock",   promptHint: "Eastman Color film stock emulation, mid-century 1950s and 1960s motion-picture color with slightly faded warm tonality, gentle red shift, soft contrast and the muted-pastel quality of aged Hollywood prints" },
  { id: "hand-tinted",     label: "Hand-Tinted",     category: "film-emulation", description: "B&W with hand-painted color",  promptHint: "hand-tinted photograph aesthetic, base black-and-white image with hand-painted color accents applied selectively to lips, cheeks, garments and props, painterly translucent washes of pigment over the monochrome plate" },
  { id: "agfa-orwo",       label: "Agfa / ORWO",     category: "film-emulation", description: "Eastern European cool greens", promptHint: "Agfa or ORWO film stock emulation, Eastern European film with cool muted greens, amber-leaning skin tones, slightly desaturated mids and a distinctive socialist-era documentary feel" },
  { id: "day-for-night",   label: "Day-for-Night",   category: "film-emulation", description: "Daylight graded as night",     promptHint: "day-for-night color grading, daylight footage graded with deep blue tones and crushed shadows to simulate moonlit night" },
  { id: "cross-processed", label: "Cross-Processed", category: "film-emulation", description: "Color shifts from xpro",        promptHint: "cross-processed film look, slide film developed in print chemistry causing surreal color shifts and pushed contrast" },
  { id: "kodachrome-64",   label: "Kodachrome 64",   category: "film-emulation", description: "Saturated reds, golden warmth", promptHint: "graded with a Kodachrome 64 film palette, saturated reds and amber highlights with rich blue shadows, the classic National Geographic warmth and vintage slide-film signature with deep tonal density" },
  { id: "ektachrome-100",  label: "Ektachrome 100",  category: "film-emulation", description: "Cool clean blues, slide clarity", promptHint: "Ektachrome 100 slide film emulation, clean cool blues with a subtle magenta cast, crisp transparency-film clarity and natural daylight color rendition with fine grain and a slightly cyan-leaning neutral tonality" },
  { id: "kodak-tri-x-400", label: "Kodak Tri-X 400 (B&W)", category: "film-emulation", description: "Pushed-grain B&W reportage", promptHint: "Kodak Tri-X 400 black-and-white film emulation, pushed-grain monochrome with gritty high contrast, deep blacks and bright highlights, classic 35mm street-photography and reportage feel with visible silver grain texture" },
  { id: "aerochrome",      label: "Aerochrome / Color Infrared", category: "film-emulation", description: "Surreal pink-magenta foliage", promptHint: "Aerochrome color infrared film emulation, surreal false-color landscape where vegetation glows in vivid pink and magenta, blue skies stay deep, and foliage appears otherworldly hot-pink and crimson — distinctive infrared-sensitive emulsion signature" },
  { id: "fuji-instax",     label: "Fuji Instax / Instant Film", category: "film-emulation", description: "Soft pastel instant-film", promptHint: "Fuji Instax instant film emulation, soft pastel midtones with a slight cool blue cast, gentle low-contrast rendering, square-format Polaroid-alternative aesthetic with creamy whites and dreamy diffuse color" },
  { id: "cinestill-50d",   label: "Cinestill 50D",   category: "film-emulation", description: "Daylight cinema stock",         promptHint: "Cinestill 50D daylight-balanced cinema film emulation, controlled cool blues with creamy skin tones and fine grain, Christopher Doyle and Wong Kar-wai daylight-cinema aesthetic with smooth highlight rolloff and natural color separation" },
  { id: "expired-film",    label: "Expired Film / Light-struck", category: "film-emulation", description: "Color shifts and light leaks", promptHint: "expired film and light-struck aesthetic, unpredictable color shifts with overexposed magenta and amber casts, visible light leaks and fogged edges, found-film degradation feel with elevated grain and unstable shifting hues" },

  // Social-preset (modern social-video aesthetics — distinct from analog film emulations)
  { id: "instagram-warm",     label: "Instagram Warm",     category: "social-preset", description: "Valencia-style warm filter",   promptHint: "Instagram-style warm filter aesthetic, slightly faded warm highlights with creamy mid-tones, Valencia-preset feel" },
  { id: "tiktok-saturated",   label: "TikTok Saturated",   category: "social-preset", description: "Bright punchy social palette", promptHint: "TikTok-style oversaturated bright palette, punchy reds and blues with high contrast and vivid skin tones" },
  { id: "youtube-vlog-flat",  label: "YouTube Vlog Flat",  category: "social-preset", description: "Clean vlog flat grade",        promptHint: "YouTube vlog clean flat color grade, neutral natural color rendition with even skin tones and pleasant ambient" },
  { id: "iphone-hdr",         label: "iPhone HDR",         category: "social-preset", description: "Computational HDR look",       promptHint: "iPhone computational HDR look with extended highlight range, lifted shadows, and slightly hyperreal local-contrast enhancement" },
  { id: "y2k-saturated",      label: "Y2K Saturated",      category: "social-preset", description: "Early-2000s digital pop",      promptHint: "Y2K early-2000s digital saturation aesthetic, electric magenta and cyan punch, glossy compact-camera color, candy-bright primaries with a slightly crunchy CCD-sensor digital sharpness" },
  { id: "mtv-90s-vhs",        label: "MTV 90s VHS",        category: "social-preset", description: "Oversaturated 90s VHS chroma", promptHint: "MTV 1990s VHS aesthetic, oversaturated cast with chroma bleed and color smearing, blown-out reds and electric blues, lo-fi tape-era saturation distinct from cleaner film emulations" },
  { id: "polaroid-faded",     label: "Polaroid Faded",     category: "social-preset", description: "Magenta-tinted faded Polaroid", promptHint: "faded vintage Polaroid aesthetic, washed-out magenta and pink color cast, lifted milky shadows, yellowed highlights and the soft instant-film degradation of an aged SX-70 print, distinct from Kodak Portra negative-film emulation" },
  { id: "lifestyle-warm-magazine", label: "Lifestyle Warm Magazine", category: "social-preset", description: "Modern warm editorial grade", promptHint: "modern lifestyle magazine warm-leaning grade, creamy honeyed highlights, gently warmed skin tones, soft golden mids and clean neutral shadows, contemporary editorial commercial aesthetic for fashion and food photography" },
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
