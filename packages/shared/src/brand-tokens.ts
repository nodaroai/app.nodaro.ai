import type { SupportedFontName } from "./supported-fonts.js"

/**
 * Brand layer (Phase 3a). A pragmatic brand-token set — palette + fonts + logo —
 * authored/selected ONCE and threaded through the shot-sequence pipeline as
 * defaults. Preset palettes are adapted from HyperFrames' Apache-2.0
 * `hyperframes-creative/frame-presets`, re-grounded on SUPPORTED_FONT_NAMES.
 */
export interface BrandPalette {
  /** Canvas background. */
  bg: string
  /** Secondary surface (cards/panels). Carried for forward-compat; unconsumed in 3a. */
  bgAlt?: string
  /** Primary on-bg text. */
  text: string
  /** Secondary text. Carried for forward-compat; unconsumed in 3a. */
  textMuted?: string
  /** Primary accent — the brand color. */
  accent: string
  /** Secondary accent. Carried for forward-compat; unconsumed in 3a. */
  accent2?: string
  /** Hairline/divider. Carried for forward-compat; unconsumed in 3a. */
  line?: string
}

export type BrandCasing = "uppercase" | "lowercase" | "none"

export interface BrandTypeSpec {
  /** CSS font-weight. MUST be a weight loaded for the role's font (guarded in remotion). */
  weight?: number
  /** absent => inherit call-site; "none" => force no transform; else force that transform. */
  casing?: BrandCasing
  /** letter-spacing in em; suppressed for Arabic at render time. */
  tracking?: number
}

export interface BrandFonts {
  heading: SupportedFontName
  body: SupportedFontName
  headingType?: BrandTypeSpec
  bodyType?: BrandTypeSpec
}

export interface BrandLogo {
  name: string
  tagline?: string
}

export interface BrandTokens {
  palette: BrandPalette
  fonts: BrandFonts
  logo?: BrandLogo
}

export interface BrandPresetMeta {
  id: BrandPresetId
  label: string
  mood: string
  description: string
}

export type BrandPresetId =
  | "midnight-violet"
  | "editorial-cream"
  | "cobalt-corporate"
  | "sandstone-warm"
  | "poster-contrast"
  | "mono-slate"
  | "vibrant-pulse"
  | "pastel-calm"

export const BRAND_PRESET_IDS: readonly BrandPresetId[] = [
  "midnight-violet",
  "editorial-cream",
  "cobalt-corporate",
  "sandstone-warm",
  "poster-contrast",
  "mono-slate",
  "vibrant-pulse",
  "pastel-calm",
]

export const BRAND_PRESETS: Record<BrandPresetId, BrandTokens> = {
  "midnight-violet": {
    palette: { bg: "#0B0B12", bgAlt: "#16161F", text: "#FFFFFF", textMuted: "#A1A1AA", accent: "#8B5CF6", accent2: "#22D3EE", line: "#2A2A38" },
    fonts: { heading: "Montserrat", body: "Inter", headingType: { weight: 700 }, bodyType: { weight: 400 } },
  },
  "editorial-cream": {
    palette: { bg: "#F7F4EF", bgAlt: "#EDE8E0", text: "#1A1A1A", textMuted: "#5A5A5A", accent: "#C2410C", line: "#D6CEC1" },
    fonts: { heading: "Playfair Display", body: "Lora", headingType: { weight: 400 }, bodyType: { weight: 400 } },
  },
  "cobalt-corporate": {
    palette: { bg: "#0A1929", bgAlt: "#12263A", text: "#E8EEF5", textMuted: "#9FB3C8", accent: "#3B82F6", line: "#1E3A52" },
    fonts: { heading: "Inter", body: "Inter", headingType: { weight: 700 }, bodyType: { weight: 400 } },
  },
  "sandstone-warm": {
    palette: { bg: "#EDE8E0", bgAlt: "#E2DBD1", text: "#1A1A1A", textMuted: "#5A5A5A", accent: "#B45309", line: "#C9BEAE" },
    fonts: { heading: "Poppins", body: "Nunito", headingType: { weight: 700 }, bodyType: { weight: 400 } },
  },
  "poster-contrast": {
    palette: { bg: "#111111", bgAlt: "#1C1C1C", text: "#FFFFFF", textMuted: "#A3A3A3", accent: "#FACC15", line: "#333333" },
    fonts: {
      heading: "Anton",
      body: "Oswald",
      headingType: { weight: 400, casing: "uppercase" },
      bodyType: { weight: 700, casing: "uppercase", tracking: 0.06 },
    },
  },
  "mono-slate": {
    palette: { bg: "#1C1C1E", bgAlt: "#2C2C2E", text: "#F5F5F7", textMuted: "#98989D", accent: "#A1A1AA", line: "#3A3A3C" },
    fonts: {
      heading: "Roboto",
      body: "Roboto Mono",
      headingType: { weight: 400, casing: "uppercase", tracking: 0.12 },
      bodyType: { weight: 400 },
    },
  },
  "vibrant-pulse": {
    palette: { bg: "#0F172A", bgAlt: "#1E293B", text: "#F8FAFC", textMuted: "#94A3B8", accent: "#EC4899", accent2: "#22D3EE", line: "#334155" },
    fonts: { heading: "Raleway", body: "Open Sans", headingType: { weight: 900 }, bodyType: { weight: 400 } },
  },
  "pastel-calm": {
    palette: { bg: "#FDF2F8", bgAlt: "#FCE7F3", text: "#4C1D95", textMuted: "#7C3AED", accent: "#A855F7", line: "#F0D9EA" },
    fonts: { heading: "Nunito", body: "Lato", headingType: { weight: 700 }, bodyType: { weight: 400 } },
  },
}

export const BRAND_PRESET_META: Record<BrandPresetId, BrandPresetMeta> = {
  "midnight-violet": { id: "midnight-violet", label: "Midnight Violet", mood: "bold / dark tech", description: "Near-black canvas, violet accent, cyan secondary — SaaS/tech launches." },
  "editorial-cream": { id: "editorial-cream", label: "Editorial Cream", mood: "editorial / light", description: "Warm paper background, burnt-orange accent, serif type — magazine/editorial." },
  "cobalt-corporate": { id: "cobalt-corporate", label: "Cobalt Corporate", mood: "corporate blue", description: "Deep navy, clean blue accent, Inter throughout — B2B/enterprise." },
  "sandstone-warm": { id: "sandstone-warm", label: "Sandstone Warm", mood: "warm neutral", description: "Sandstone canvas, amber accent, rounded sans — approachable/lifestyle." },
  "poster-contrast": { id: "poster-contrast", label: "Poster Contrast", mood: "high-contrast poster", description: "Ink-black, yellow accent, condensed display type — punchy/bold statements." },
  "mono-slate": { id: "mono-slate", label: "Mono Slate", mood: "muted monochrome", description: "Slate greys, monospace body — technical/developer tone." },
  "vibrant-pulse": { id: "vibrant-pulse", label: "Vibrant Pulse", mood: "vibrant", description: "Deep slate, magenta + cyan accents — energetic consumer/creator." },
  "pastel-calm": { id: "pastel-calm", label: "Pastel Calm", mood: "calm pastel", description: "Soft pink canvas, purple accent — gentle/wellness/education." },
}

/** Resolve a preset-name string OR an inline BrandTokens object to BrandTokens. */
export function resolveBrandInput(brand: string | BrandTokens): BrandTokens {
  if (typeof brand === "string") {
    if (!Object.prototype.hasOwnProperty.call(BRAND_PRESETS, brand)) {
      throw new Error(
        `Unknown brand preset "${brand}". Valid presets: ${BRAND_PRESET_IDS.join(", ")}.`,
      )
    }
    return BRAND_PRESETS[brand as BrandPresetId]
  }
  return brand
}
