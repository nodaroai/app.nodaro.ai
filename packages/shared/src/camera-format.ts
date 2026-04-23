/**
 * Canonical catalog of camera / film-stock choices.
 *
 * Capture-medium dimension of a shot — the physical or simulated sensor / film
 * stock and its associated grain, color science, and aspect treatment. Independent
 * of optics (lens), framing (shot size + composition), and camera motion.
 *
 * Shared between the picker UI and the prompt-hint injection on both the
 * frontend DAG executor and the backend orchestrator.
 */

export interface CameraFormat {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const CAMERA_FORMATS: ReadonlyArray<CameraFormat> = [
  // Film stocks
  { id: "35mm-film",          label: "35mm Film",         description: "Classic cinema film grain",                  promptHint: "shot on 35mm film, classic cinematic grain texture and color science" },
  { id: "16mm-film",          label: "16mm Film",         description: "Indie / documentary grain",                  promptHint: "shot on 16mm film, indie documentary grain with characteristic muted tones" },
  { id: "super-8",            label: "Super 8",           description: "Vintage 8mm home-movie look",                promptHint: "shot on Super 8 film, soft vintage grain with warm color cast and subtle gate weave" },
  { id: "imax-70mm",          label: "IMAX 70mm",         description: "Large-format pristine clarity",              promptHint: "shot on IMAX 70mm film, ultra-high-resolution large-format with pristine clarity and rich tonal depth" },
  { id: "anamorphic-scope",   label: "Anamorphic Scope",  description: "2.39:1 widescreen cinema look",              promptHint: "shot in anamorphic scope, 2.39:1 widescreen aspect ratio with horizontal lens flares and oval bokeh" },
  // Modern digital
  { id: "arri-alexa",         label: "Arri Alexa",        description: "Premium digital cinema",                     promptHint: "shot on Arri Alexa, premium digital cinema with Arri color science and clean shadows" },
  { id: "dslr",               label: "DSLR",              description: "Crisp video-DSLR look",                      promptHint: "shot on DSLR, crisp clean video with shallow depth of field and modern digital color" },
  // Vintage / lo-fi
  { id: "vhs",                label: "VHS",               description: "Tape distortion + scanlines",                promptHint: "shot on VHS, analog tape distortion with horizontal scanlines, color bleed, and tracking artifacts" },
  { id: "camcorder",          label: "Camcorder",         description: "Consumer 90s video",                         promptHint: "shot on a 90s consumer camcorder, soft video with low resolution and slight chromatic fringing" },
  { id: "polaroid",           label: "Polaroid",          description: "Instant film tonality",                      promptHint: "polaroid instant film, square frame with soft tonality, slight color shift, and characteristic white border" },
  { id: "security-cam",       label: "Security Cam",      description: "Low-res surveillance",                       promptHint: "low-resolution security camera footage, monochrome or desaturated, slight grain, timestamp overlay aesthetic" },
  { id: "bw-film",            label: "B&W Film",          description: "Black and white film stock",                 promptHint: "shot on black and white film, rich grayscale tonality with classic film grain" },
  { id: "iphone",             label: "iPhone",            description: "Modern phone-camera look",                   promptHint: "shot on a modern iPhone, computational image processing with sharp clarity, slight HDR look, and characteristic phone-camera color science" },
] as const

const formatById = new Map<string, CameraFormat>(CAMERA_FORMATS.map((f) => [f.id, f]))

export function getCameraFormat(id: string | undefined | null): CameraFormat | undefined {
  if (!id) return undefined
  return formatById.get(id)
}

export function getCameraFormatLabel(id: string | undefined | null, fallback?: string): string {
  const f = getCameraFormat(id)
  if (f) return f.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getCameraFormatPromptHint(id: string | undefined | null): string {
  return getCameraFormat(id)?.promptHint ?? ""
}

export const CAMERA_FORMAT_IDS: ReadonlyArray<string> = CAMERA_FORMATS.map((f) => f.id)
