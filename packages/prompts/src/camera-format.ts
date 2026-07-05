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
  { id: "arri-alexa",             label: "Arri Alexa",            description: "Premium digital cinema",                     promptHint: "shot on Arri Alexa, premium digital cinema with Arri color science and clean shadows" },
  { id: "alexa-65",               label: "ARRI Alexa 65",         description: "Large-format 65mm IMAX-class cinema",        promptHint: "shot on an ARRI Alexa 65 large-format cinema camera, the IMAX-class 65mm sensor delivering creamy bokeh, immense tonal latitude, and flagship Hollywood-blockbuster image quality" },
  { id: "sony-venice",            label: "Sony Venice",           description: "Full-frame dual-base-ISO cinema",            promptHint: "shot on a Sony Venice full-frame cinema camera, dual-base-ISO sensor producing clean shadows in low light, refined Sony cinema color science, and the polished premium-streaming-production look" },
  { id: "blackmagic-pocket-6k",   label: "Blackmagic Pocket 6K",  description: "Indie RAW cinema camera",                    promptHint: "shot on a Blackmagic Pocket Cinema Camera 6K, indie-filmmaker RAW recording with rich color depth, organic film-like rendering, and the unmistakable Blackmagic gen-5 color science" },
  { id: "red-komodo",             label: "RED Komodo",            description: "Compact 6K action cinema camera",            promptHint: "shot on a RED Komodo 6K cinema camera, compact-body REDCODE RAW capture with crisp action-grade detail, RED IPP2 color science, and dynamic gimbal- or drone-friendly framing" },
  { id: "dslr",                   label: "DSLR",                  description: "Crisp video-DSLR look",                      promptHint: "shot on DSLR, crisp clean video with shallow depth of field and modern digital color" },
  { id: "mirrorless-a7iii",       label: "Sony A7III",            description: "Modern hybrid mirrorless",                   promptHint: "shot on a Sony A7III mirrorless camera, clean modern hybrid look with fast-AF aesthetic, slightly cool Sony color science, and crisp full-frame sensor rendering" },
  { id: "canon-r5",               label: "Canon EOS R5",          description: "High-res fashion-editorial mirrorless",      promptHint: "shot on a Canon EOS R5 mirrorless camera, high-resolution full-frame imagery with Canon's signature warm skin tones and clean editorial-fashion clarity" },
  { id: "hasselblad-medium-format", label: "Hasselblad Medium Format", description: "Editorial medium format",            promptHint: "shot on a Hasselblad medium-format camera, ultra-shallow depth of field with painterly tonal rolloff, prestigious editorial color science, and large-sensor microcontrast" },
  { id: "leica-m-rangefinder",    label: "Leica M Rangefinder",   description: "Classic 35mm rangefinder",                   promptHint: "shot on a Leica M-series rangefinder, classic 35mm street-photography aesthetic with gentle bokeh, refined contrast, and signature Leica rendering" },
  { id: "voigtlander",            label: "Voigtlander",           description: "Boutique rangefinder character",             promptHint: "shot on a Voigtlander rangefinder, distinctive color rendition with subtle vintage character, slightly muted saturation, and unique micro-contrast signature" },
  { id: "fuji-xt4",               label: "Fujifilm X-T4",         description: "Film-emulating Fuji color",                  promptHint: "shot on a Fujifilm X-T4, film-like Fuji color science with rich greens, warm reds, and the distinctive emulation-style tonal curve Fuji is known for" },
  // Aerial / action
  { id: "drone-aerial",           label: "Drone (Aerial)",        description: "Overhead gimbal-stabilized aerial",          promptHint: "overhead drone aerial footage, slight wide-angle distortion with smooth gimbal stabilization, top-down or low-altitude perspective, and atmospheric haze on distant subjects" },
  { id: "gopro-action-cam",       label: "GoPro Action Cam",      description: "Fisheye-wide action camera",                 promptHint: "shot on a GoPro action camera, heavy fisheye-wide distortion with high-contrast saturated color, motion-active framing, and characteristic warped horizon lines" },
  // Lo-fi modern
  { id: "webcam-facetime",        label: "Webcam / FaceTime",     description: "Low-res video call",                         promptHint: "low-resolution webcam or FaceTime call footage, soft compression artifacts with color-shifted skin tones, low frame-rate ghosting, and slightly laggy motion blur" },
  // Vintage / lo-fi
  { id: "vhs",                    label: "VHS",                   description: "Tape distortion + scanlines",                promptHint: "shot on VHS, analog tape distortion with horizontal scanlines, color bleed, and tracking artifacts" },
  { id: "camcorder",              label: "Camcorder",             description: "Consumer 90s video",                         promptHint: "shot on a 90s consumer camcorder, soft video with low resolution and slight chromatic fringing" },
  { id: "polaroid",                label: "Polaroid",              description: "Instant film tonality",                     promptHint: "polaroid instant film, square frame with soft tonality, slight color shift, and characteristic white border" },
  { id: "fuji-instax",            label: "Fujifilm Instax",       description: "Modern instant film",                        promptHint: "shot on Fujifilm Instax instant film, square frame with soft pastel tones, slight blue cast, gentle highlight rolloff, and the characteristic crisp white instax border" },
  { id: "disposable-camera",      label: "Disposable Camera",     description: "Single-use 90s/2000s film",                  promptHint: "shot on a single-use disposable film camera, gritty 90s/2000s aesthetic with harsh on-camera flash, blown highlights, color shift toward magenta, and gritty grain in shadows" },
  { id: "toy-camera-holga",       label: "Toy Camera (Holga)",    description: "Lo-fi Holga / Lomo plastic-lens",            promptHint: "shot on a toy camera like a Holga or Lomo, heavy vignetting with light leaks, soft plastic-lens focus, lo-fi vintage character, and unpredictable color shifts" },
  { id: "tintype-wet-plate",      label: "Tintype / Wet Plate",   description: "Vintage wet-plate collodion",                promptHint: "vintage tintype wet-plate collodion photograph, silver-mirror tonality with ethereal blur on edges, sepia-leaning monochrome, slow-exposure stillness, and antique surface character" },
  { id: "daguerreotype",          label: "Daguerreotype",         description: "1840s silver-mirror process",                promptHint: "1840s daguerreotype photograph, silver-mirror surface with slight ghostly blur from long exposure, hyper-vintage tonality, and the unmistakable reflective polished-plate quality" },
  { id: "security-cam",           label: "Security Cam (CCTV)",   description: "CCTV fisheye + timestamp overlay",           promptHint: "CCTV security-camera footage, wide-angle fisheye distortion with visible timestamp overlay in the corner, low resolution monochrome or desaturated color, static interference lines, tracking artifacts, and surveillance-grade compression" },
  { id: "bw-film",                label: "B&W Film",              description: "Black and white film stock",                 promptHint: "shot on black and white film, rich grayscale tonality with classic film grain" },
  { id: "iphone",                 label: "iPhone",                description: "Modern phone-camera look",                   promptHint: "shot on a modern iPhone, computational image processing with sharp clarity, slight HDR look, and characteristic phone-camera color science" },
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
