import type { FactoryPreset } from "./types.js"

/**
 * Selective-stylization presets shared by `modify-image` (transform an input photo) and
 * `generate-image` (use a connected reference image). `modify-image` is slated for deprecation in
 * favor of `generate-image`, so the catalog lives in ONE place to prevent the two from drifting —
 * when `modify-image` is removed, just drop its key from `FACTORY_PRESETS` below. `nano-banana-pro`
 * is a valid provider for both nodes' enums (IMAGE_GEN_PROVIDERS and MODIFY_IMAGE_PROVIDERS).
 */
const STYLIZED_SUBJECT: ReadonlyArray<{
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly data: Readonly<Record<string, unknown>>
}> = [
  {
    slug: "cartoon-person-real-world",
    name: "Cartoon Person, Real World",
    description: "Subject → 3D cartoon, rest stays photoreal.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Turn the person into a stylized 3D cartoon character (Pixar/Disney look). Important: only the person becomes a cartoon — keep the background, clothing textures, lighting, and everything else photorealistic and unchanged.",
    },
  },
  {
    slug: "caricature-real-photo",
    name: "Caricature, Real Photo",
    description: "Exaggerated cartoon head on a real scene.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Exaggerate the person into a caricature with an oversized head and amplified features, in a fun illustrated style. Keep the body, background, and overall scene photorealistic and unchanged.",
    },
  },
  {
    slug: "anime-person-real-bg",
    name: "Anime Person, Real Background",
    description: "Subject → 2D anime, real environment.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restyle only the person as a 2D anime character with cel shading. Keep the real-world background, lighting, and environment photorealistic and untouched.",
    },
  },
  {
    slug: "real-person-cartoon-world",
    name: "Real Person, Cartoon World",
    description: "Inverse — real subject, stylized world.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Keep the person photorealistic and unchanged. Transform only the background and environment into a colorful stylized cartoon world.",
    },
  },
  {
    slug: "claymation-figure-real-set",
    name: "Claymation Figure, Real Set",
    description: "Subject → clay figure, real surroundings.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Turn the person into a tactile stop-motion claymation figure with visible fingerprints and plasticine texture. Keep the surrounding set and background photorealistic.",
    },
  },
]

/** Build the Stylized Subject presets for a node type (id = `<nodeType>/<slug>`). */
export function stylizedSubjectFor(nodeType: string): FactoryPreset[] {
  return STYLIZED_SUBJECT.map((p) => ({
    id: `${nodeType}/${p.slug}`,
    name: p.name,
    description: p.description,
    group: "Stylized Subject",
    data: p.data,
  }))
}

/**
 * Image-edit presets shared by `modify-image` and `generate-image` (with a connected reference
 * image) — common photo-edit operations where the instruction lives in the prompt. Same
 * single-source rationale as STYLIZED_SUBJECT; when modify-image is removed, generate-image keeps them.
 */
const IMAGE_EDITS: ReadonlyArray<{
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly data: Readonly<Record<string, unknown>>
}> = [
  {
    slug: "background-remove",
    name: "Remove Background",
    description: "Cut out the subject on white.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Remove the background completely and place the subject on a clean solid white background. Keep the subject sharp, complete and unchanged.",
    },
  },
  {
    slug: "background-replace",
    name: "Replace Background",
    description: "Swap in a new scene.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Replace the background with {scene}. Keep the subject unchanged and blend the lighting and shadows naturally.",
    },
  },
  {
    slug: "colorize",
    name: "Colorize B&W Photo",
    description: "Natural color from grayscale.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Colorize this black-and-white photo with natural, realistic colors. Preserve all original detail and composition.",
    },
  },
  {
    slug: "restore-photo",
    name: "Restore Old Photo",
    description: "Repair scratches, denoise, sharpen.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restore and enhance this old photo: remove scratches, dust and noise, repair damage, and sharpen detail while keeping it authentic.",
    },
  },
  {
    slug: "relight",
    name: "Relight Scene",
    description: "New lighting, same subject.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Relight the scene with {lighting style}. Keep the subject, pose and composition unchanged.",
    },
  },
  {
    slug: "restyle-whole",
    name: "Restyle (whole image)",
    description: "Apply an art style to everything.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restyle the entire image in a {art style} look while keeping the composition and subject recognizable.",
    },
  },
]

/** Build the Edits presets for a node type (id = `<nodeType>/<slug>`). */
export function editsFor(nodeType: string): FactoryPreset[] {
  return IMAGE_EDITS.map((p) => ({
    id: `${nodeType}/${p.slug}`,
    name: p.name,
    description: p.description,
    group: "Edits",
    data: p.data,
  }))
}
