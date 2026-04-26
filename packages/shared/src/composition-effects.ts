/**
 * Canonical catalog of Composition Effects choices.
 *
 * Composition Effects describe a "compositional trick" applied to the subject
 * — how the subject interacts with the canvas/frame, what material it's made
 * of, or what compositional gimmick frames it. This is distinct from the post-
 * processing image grade (Post-Process Effects) and from the artistic style
 * (Style): an "exploding particles" composition effect can be applied to an
 * oil painting style or a photorealistic style equally well.
 *
 * Single-pick — only one composition trick is applied per consumer. Pure
 * prompt text, zero credits, zero API calls.
 *
 * Shared between picker UI and prompt-hint injection in the frontend DAG
 * executor and the backend orchestrator.
 */

export interface CompositionEffect {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const COMPOSITION_EFFECTS: ReadonlyArray<CompositionEffect> = [
  { id: "bursting-through-frame", label: "Bursting Through Frame", description: "3D paper-tear breaking the frame",   promptHint: "the subject bursting forward through a torn paper frame in a 3D paper-tear effect, head and shoulders breaking the plane of the canvas with ragged paper edges curling outward" },
  { id: "breaking-out-of-frame",  label: "Breaking Out of Frame",  description: "Limb extends past canvas border",     promptHint: "the subject's hand or limb extending past the canvas border, breaking the fourth wall and reaching beyond the frame's edge into the viewer's space" },
  { id: "pixel-disintegration",   label: "Pixel Disintegration",   description: "Subject dissolving into particles",   promptHint: "the subject pixelating and dissolving into floating geometric particles drifting outward, ordered chaos with crisp pixel-cube fragments scattering away from the silhouette" },
  { id: "smoke-sculpture",        label: "Smoke Sculpture",        description: "Subject formed from swirling smoke",  promptHint: "the subject formed entirely of swirling smoke, ethereal greyscale mass holding human shape with wispy tendrils trailing off and dissolving at the edges" },
  { id: "liquid-sculpture",       label: "Liquid Sculpture",       description: "Subject formed from flowing liquid",  promptHint: "the subject formed entirely of flowing water and liquid, ripples and reflections traveling through the form with droplets suspended around the silhouette" },
  { id: "shattering-glass",       label: "Shattering Glass",       description: "Frozen glass shards mid-flight",      promptHint: "the subject framed behind shattering glass with fragments mid-flight, motion frozen at the moment of impact, splintered cracks radiating outward and shards catching the light" },
  { id: "emerging-from-background", label: "Emerging From Background", description: "Half-emerging from a textured surface", promptHint: "the subject half-emerging out of a textured background, partially integrated into the surface as if pushing through wet plaster or relief sculpture, body and background sharing material" },
  { id: "fragmented-mosaic",      label: "Fragmented Mosaic",      description: "Portrait built from mosaic tiles",    promptHint: "the subject's portrait composed of small mosaic tiles, fragmented yet unmistakably recognizable with grout lines between each ceramic-like fragment forming the larger image" },
  { id: "glitch-distortion",      label: "Glitch Distortion",      description: "RGB-shift digital corruption",        promptHint: "the subject distorted by digital glitch artifacts with RGB channel separation, scanline tearing and datamoshed compression bands cutting horizontally across the figure" },
  { id: "doubled-mirror",         label: "Doubled Mirror",         description: "Mirror-reflected duplication",        promptHint: "the subject duplicated in mirror reflections, multiplied identity with two or more echoed versions of the figure stitched along an invisible mirror seam" },
  { id: "floating-fragments",     label: "Floating Fragments",     description: "Body partially drifting away",        promptHint: "the subject's body partially floating away in fragments, broken pieces of the figure detaching and drifting upward like windborne paper, leaving a partially dissolved silhouette" },
  { id: "silhouette-outline",     label: "Silhouette Outline",     description: "Clean black silhouette on flat BG",   promptHint: "the subject reduced to a clean black silhouette outline against a flat single-color background, no internal detail, pure shape language" },
  { id: "exploding-particles",    label: "Exploding Particles",    description: "Outline scattering into particles",   promptHint: "the subject's outline exploding outward into a cloud of fine particles, dust and motes scattering radially around a partially intact core figure" },
  { id: "3x3-grid-collage",       label: "3x3 Grid Collage",       description: "Contact-sheet 9-pose montage",        promptHint: "the subject shown in a 3x3 grid of varied poses and expressions arranged as a contact-sheet collage, nine clean panels with consistent lighting and slight pose variation in each cell" },
  { id: "matte-painting",         label: "Matte Painting",         description: "Composite matte-painted background blended with live action, classic VFX", promptHint: "the subject composited against a matte-painted background blended seamlessly with live action, classic VFX matte-painting integration with hand-painted environment extension behind the figure" },
  { id: "double-exposure",        label: "Double Exposure",        description: "Two layered photographic exposures fused into one image", promptHint: "two layered photographic exposures fused into one image, the subject's silhouette filled with a secondary scene and translucent overlapping forms in classic darkroom double-exposure technique" },
  { id: "multiple-exposure",      label: "Multiple Exposure",      description: "Three or more exposures stacked, kaleidoscopic layering", promptHint: "three or more photographic exposures stacked into a single frame, kaleidoscopic layering of repeated subject positions with translucent overlapping silhouettes echoing across the canvas" },
  { id: "in-camera-effects",      label: "In-Camera Effects",      description: "Practical in-camera optical effects, no post-production", promptHint: "practical in-camera optical effects with no post-production trickery, real-world prisms, mirrors and lens-mounted gels creating the visual treatment directly at capture" },
  { id: "prism-flares",           label: "Prism Flares",           description: "Crystal prism refracted light flares splitting into spectral bands", promptHint: "crystal prism refracted light flares splitting into spectral bands across the frame, rainbow chromatic streaks fanning outward from highlights with prismatic color separation" },
] as const

const compositionEffectById = new Map<string, CompositionEffect>(
  COMPOSITION_EFFECTS.map((c) => [c.id, c]),
)

export function getCompositionEffect(id: string | undefined | null): CompositionEffect | undefined {
  if (!id) return undefined
  return compositionEffectById.get(id)
}

export function getCompositionEffectLabel(id: string | undefined | null, fallback?: string): string {
  const c = getCompositionEffect(id)
  if (c) return c.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getCompositionEffectPromptHint(id: string | undefined | null): string {
  return getCompositionEffect(id)?.promptHint ?? ""
}

export const COMPOSITION_EFFECT_IDS: ReadonlyArray<string> = COMPOSITION_EFFECTS.map((c) => c.id)
