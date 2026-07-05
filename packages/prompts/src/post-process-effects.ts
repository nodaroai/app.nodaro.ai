/**
 * Canonical catalog of Post-Process Effects choices.
 *
 * Post-process effects describe an image-level grade or processing pass
 * applied AFTER the image is captured / rendered — vignette, grain, halation,
 * bloom, chromatic aberration, light leaks, scratches, soft-focus diffusion,
 * dodge-and-burn, etc. These are the touches a colorist or photographer
 * applies in the darkroom or grading suite.
 *
 * Distinct from:
 *  - Style — the artistic medium (oil paint, watercolor, anime).
 *  - Composition Effects — what the subject is made of or how it interacts
 *    with the frame (smoke sculpture, exploding particles, breaking the
 *    fourth wall).
 *  - Color Look — overall color grade direction (teal-orange, pastel, mono).
 *  - Atmosphere — what's in the air (fog, dust, rain).
 *
 * Single-pick — only one post-process pass is applied per consumer.
 *
 * Shared between picker UI and prompt-hint injection in the frontend DAG
 * executor and the backend orchestrator.
 */

export interface PostProcessEffect {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const POST_PROCESS_EFFECTS: ReadonlyArray<PostProcessEffect> = [
  { id: "vignette-soft",        label: "Soft Vignette",          description: "Gentle corner darkening",          promptHint: "soft dark vignette gently darkening the corners of the frame, drawing the eye toward the center without calling attention to itself" },
  { id: "vignette-heavy",       label: "Heavy Vignette",         description: "Dramatic black corners",            promptHint: "heavy black vignette circumscribing the subject in a dramatic dark oval, deep falloff at the edges that nearly crushes to black" },
  { id: "dodge-and-burn",       label: "Dodge & Burn",           description: "Sculpted highlight/shadow",         promptHint: "aggressive dodge-and-burn shaping with sculpted highlight and shadow chiaroscuro, hand-painted-style local contrast carving form into the subject" },
  { id: "film-grain-fine",      label: "Fine Film Grain",        description: "Subtle 35mm-style grain",           promptHint: "fine film grain overlay across the entire image, classic 35mm character with delicate organic noise that softens digital edges" },
  { id: "film-grain-heavy",     label: "Heavy Film Grain",       description: "Coarse push-processed grain",       promptHint: "heavy coarse grain like push-processed high-ISO film, gritty texture across midtones and dense noise in the shadows" },
  { id: "halation-glow",        label: "Halation Glow",          description: "Cinestill red-halo bloom",          promptHint: "warm halation glow blooming around bright highlights, signature cinestill-style red halo bleeding from light sources and tungsten practicals" },
  { id: "bloom-glow",           label: "Bloom Glow",             description: "Romantic dreamy highlight bloom",   promptHint: "dreamy soft-focus bloom on highlights, romantic glow that wraps around bright areas and lifts the overall mood with a hazy halo" },
  { id: "chromatic-aberration", label: "Chromatic Aberration",   description: "Red/cyan fringe on edges",          promptHint: "visible chromatic aberration with red and cyan fringing on contrast edges, lens-imperfection look that reads as authentic optical character" },
  { id: "light-leak",           label: "Light Leak",             description: "Warm streak across the frame",      promptHint: "warm orange light leak streaking across one edge of the frame, fogged film aesthetic with a soft amber wash bleeding into the image" },
  { id: "film-burn",            label: "Film Burn",              description: "Vintage Super-8 corner flare",      promptHint: "film burn flare in the corner with a vintage Super-8 aesthetic, charred edge bleeding orange and white light into the frame" },
  { id: "scratched-emulsion",   label: "Scratched Emulsion",     description: "Aged film scratches + dust",        promptHint: "vertical scratches and dust marks like aged film emulsion, hairline streaks running through the frame and scattered dust specks across the image" },
  { id: "color-fringe",         label: "Color Fringe",           description: "Subtle high-contrast fringing",     promptHint: "subtle color fringing on high-contrast edges, gentle prismatic shimmer that adds optical authenticity without overwhelming the image" },
  { id: "soft-focus-diffusion", label: "Soft-Focus Diffusion",   description: "Hazy dreamy highlight bloom",       promptHint: "soft-focus diffusion filter — slightly hazy dreamy bloom on highlights, glowing skin tones and a romantic veil across the entire image" },
  { id: "contrast-boost",       label: "Contrast Boost",         description: "Crushed shadows + pushed highlights", promptHint: "aggressive contrast boost, deepened shadows crushing toward black and pushed highlights, punchy editorial-grade tonal separation" },
  { id: "sharpening",           label: "Heavy Sharpening",       description: "Aggressive edge-sharpening pass, crisp micro-detail", promptHint: "aggressive edge-sharpening pass with crisp micro-detail emphasized, hardened edges and pronounced texture acutance across the entire image" },
  { id: "clarity-boost",        label: "Clarity Boost",          description: "Mid-tone clarity enhancement, increased local contrast", promptHint: "mid-tone clarity enhancement with increased local contrast, deepened textural definition and punchy structural detail without crushing shadows or highlights" },
  { id: "dehaze",               label: "Dehaze",                 description: "Atmospheric dehaze applied, removing softness and lifting contrast through fog", promptHint: "atmospheric dehaze applied across the frame, removing veiling softness and lifting contrast through haze and fog with restored color saturation in distant tones" },
  { id: "lift-gamma-gain",      label: "Lift-Gamma-Gain Grade",  description: "Three-way color grading wheels — shadow lift, midtone gamma, highlight gain", promptHint: "three-way color grading with lift-gamma-gain wheels shaping shadow lift, midtone gamma and highlight gain independently, professional colorist-grade tonal sculpting" },
] as const

const postProcessById = new Map<string, PostProcessEffect>(
  POST_PROCESS_EFFECTS.map((p) => [p.id, p]),
)

export function getPostProcessEffect(id: string | undefined | null): PostProcessEffect | undefined {
  if (!id) return undefined
  return postProcessById.get(id)
}

export function getPostProcessEffectLabel(id: string | undefined | null, fallback?: string): string {
  const p = getPostProcessEffect(id)
  if (p) return p.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getPostProcessEffectPromptHint(id: string | undefined | null): string {
  return getPostProcessEffect(id)?.promptHint ?? ""
}

/**
 * Multi-pick: 1-2 post-process effect ids → composite grading clause.
 * Common pairs: vignette + film-grain, halation + bloom, dodge-burn +
 * chromatic-aberration. Each entry already describes a complete grading
 * pass, so we emit independently and let the comma-join compose them.
 */
export function buildPostProcessHints(value: unknown): string[] {
  const ids: string[] = []
  if (typeof value === "string" && value) ids.push(value)
  else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  const out: string[] = []
  for (const id of ids) {
    const hint = getPostProcessEffectPromptHint(id)
    if (hint) out.push(hint)
  }
  return out
}

export const POST_PROCESS_EFFECT_IDS: ReadonlyArray<string> = POST_PROCESS_EFFECTS.map((p) => p.id)
