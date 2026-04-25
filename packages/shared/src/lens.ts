/**
 * Canonical catalog of lens / focal length choices.
 *
 * Optics dimension of a shot — focal length and depth-of-field character. Independent
 * of framing (which captures shot size and composition) and camera motion (which captures
 * how the camera moves). A close-up at 24mm looks completely different from a close-up
 * at 200mm — the lens choice carries that intent.
 *
 * Shared between the picker UI and the prompt-hint injection on both the
 * frontend DAG executor and the backend orchestrator.
 */

export interface Lens {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const LENSES: ReadonlyArray<Lens> = [
  { id: "ultra-wide-14mm",       label: "Ultra-wide (14mm)",       description: "Extreme wide angle, exaggerated perspective", promptHint: "shot on ultra-wide 14mm lens, exaggerated perspective with strong barrel distortion" },
  { id: "wide-24mm",             label: "Wide (24mm)",             description: "Wide field of view, environmental",           promptHint: "shot on wide 24mm lens, expansive environmental field of view" },
  { id: "standard-35mm",         label: "Standard (35mm)",         description: "Natural perspective, documentary feel",       promptHint: "shot on standard 35mm lens, natural perspective with documentary feel" },
  { id: "normal-50mm",           label: "Normal (50mm)",           description: "Closest to human eye perception",             promptHint: "shot on normal 50mm lens, perspective closest to natural human vision" },
  { id: "portrait-85mm",         label: "Portrait (85mm)",         description: "Flattering compression, creamy bokeh",        promptHint: "shot on 85mm portrait lens, flattering facial compression with creamy background bokeh" },
  { id: "telephoto-135mm",       label: "Telephoto (135mm)",       description: "Compressed depth, isolated subject",          promptHint: "shot on 135mm telephoto lens, compressed depth with subject isolated from background" },
  { id: "super-telephoto-400mm", label: "Super Telephoto (400mm)", description: "Extreme compression, distant subject",        promptHint: "shot on super-telephoto 400mm lens, extreme depth compression with subject pulled forward" },
  { id: "fisheye",               label: "Fisheye",                 description: "Hemispherical 180° distortion",          promptHint: "shot on fisheye lens, extreme 180-degree hemispherical distortion with curved horizon" },
  { id: "anamorphic",            label: "Anamorphic",              description: "Cinematic widescreen, oval bokeh",            promptHint: "anamorphic lens look, cinematic widescreen feel with characteristic oval bokeh and horizontal lens flares" },
  { id: "macro",                 label: "Macro",                   description: "Extreme close-up of small detail",            promptHint: "macro lens, extreme close-up revealing fine detail with shallow depth of field" },
  { id: "tilt-shift",            label: "Tilt-shift",              description: "Selective focus, miniature effect",           promptHint: "tilt-shift lens, selective plane of focus producing a miniature-diorama effect" },
  { id: "shallow-dof",           label: "Shallow DOF",             description: "Razor-thin focus, dreamy bokeh",              promptHint: "extremely shallow depth of field, razor-thin focal plane with dreamy out-of-focus bokeh" },
  { id: "canon-k35",             label: "Canon K35 Prime",         description: "Vintage cinematic, warm gentle skin",         promptHint: "shot on a vintage Canon K35 cinema prime, warm gentle skin rendition, low-contrast highlight roll-off, soft dreamy falloff into the bokeh and the unmistakable seventies-era cinematic patina" },
  { id: "cooke-s4",              label: "Cooke S4 Prime",          description: "The Cooke look — creamy painterly skin",      promptHint: "shot on a Cooke S4 cinema prime, the signature \"Cooke look\" with creamy painterly bokeh, gently rounded out-of-focus highlights and a flattering filmic skin rendition" },
  { id: "helios-44",             label: "Helios 44",               description: "Vintage Soviet swirly bokeh",                 promptHint: "shot on a vintage Soviet Helios 44 lens, the legendary swirly bokeh circling the subject, soft low contrast in the corners and a dreamlike vintage aberration character" },
  { id: "petzval",               label: "Petzval Portrait",        description: "Ultra-vintage swirl, dramatic falloff",       promptHint: "shot on an ultra-vintage Petzval portrait lens, sharp central focus that falls off rapidly into a swirling, painterly bokeh, dramatic vignetting and a 19th-century daguerreotype-era softness at the edges" },
] as const

const lensById = new Map<string, Lens>(LENSES.map((l) => [l.id, l]))

export function getLens(id: string | undefined | null): Lens | undefined {
  if (!id) return undefined
  return lensById.get(id)
}

export function getLensLabel(id: string | undefined | null, fallback?: string): string {
  const l = getLens(id)
  if (l) return l.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getLensPromptHint(id: string | undefined | null): string {
  return getLens(id)?.promptHint ?? ""
}

export const LENS_IDS: ReadonlyArray<string> = LENSES.map((l) => l.id)
