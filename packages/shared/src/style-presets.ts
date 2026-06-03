import type { StyleDirectives } from "./pipeline-types.js"

/**
 * Style Gallery presets (north-star §6 ①).
 *
 * Each preset is a named "look" the user picks at Start. Picking one sets the
 * pipeline's `style_directives`, which the Showrunner folds into the plan's
 * `global_style` — and from there it propagates into every entity reference
 * sheet, scene keyframe, and shot prompt, plus the image/location critics. So
 * the whole film stays visually consistent in the chosen style.
 *
 * The catalog is intentionally style/genre-agnostic (not just "cinematic"):
 * films, explainers, animated ads, kids' content, education. A per-shot style
 * override lives in the Focus composer (follow-up).
 *
 * `swatch` is a CSS gradient used as a lightweight thumbnail until real sample
 * images ship — it gives each look a recognizable visual without bundling
 * assets.
 */
export interface StylePreset {
  /** Stable id stored on the pipeline (do not rename — breaks recall). */
  id: string
  label: string
  /** One-line description shown under the label. */
  description: string
  /** CSS `background` value for the card's thumbnail swatch. */
  swatch: string
  /** Conditioning fed to the Showrunner → plan.global_style → all generation. */
  directives: StyleDirectives
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: "cinematic",
    label: "Cinematic Photography",
    description: "Photoreal film look, shallow depth, filmic grade.",
    swatch: "linear-gradient(135deg,#1b2a4a,#c97b4a)",
    directives: {
      visualStyle:
        "photorealistic cinematic film still, 35mm anamorphic, shallow depth of field, subtle film grain",
      colorPalette: "rich natural tones with a teal-and-orange grade",
      lighting: "dramatic motivated lighting, soft key with rim light",
      cameraLanguage: "cinematic composition, smooth dolly and crane moves",
      avoid: "cartoon, illustration, flat shading, low detail",
    },
  },
  {
    id: "flat2d",
    label: "Modern Flat 2D",
    description: "Bold flat vector shapes, clean outlines.",
    swatch: "linear-gradient(135deg,#ff6b6b,#ffd93d)",
    directives: {
      visualStyle:
        "modern flat 2D vector illustration, bold geometric shapes, clean outlines",
      colorPalette: "bright saturated flat colors",
      lighting: "even flat lighting, no gradients",
      cameraLanguage: "straight-on framing, simple pans and cuts",
      avoid: "photorealism, 3D render, gradients, texture noise",
    },
  },
  {
    id: "clay3d",
    label: "Soft 3D Clay",
    description: "Rounded claymation forms, matte texture.",
    swatch: "linear-gradient(135deg,#f5b5c8,#a8d8c0)",
    directives: {
      visualStyle:
        "soft 3D claymation look, rounded forms, matte clay texture, fingerprint detail",
      colorPalette: "warm pastel palette",
      lighting: "soft studio lighting with gentle shadows",
      cameraLanguage: "playful slow orbits and push-ins",
      avoid: "photorealism, harsh shadows, flat 2D",
    },
  },
  {
    id: "lineart",
    label: "Minimal Line-Art",
    description: "Single-weight black strokes, one accent.",
    swatch: "linear-gradient(135deg,#ffffff,#111111)",
    directives: {
      visualStyle: "minimal black line-art on white, single-weight strokes",
      colorPalette: "monochrome with a single accent color",
      lighting: "no rendered lighting, line only",
      cameraLanguage: "static, centered compositions",
      avoid: "color fills, shading, photorealism, 3D",
    },
  },
  {
    id: "papercut",
    label: "Paper-Cut",
    description: "Layered construction-paper collage.",
    swatch: "linear-gradient(135deg,#e8a87c,#85cdca)",
    directives: {
      visualStyle:
        "layered paper-cut collage, stacked construction-paper layers with soft drop shadows",
      colorPalette: "warm crafted paper tones",
      lighting: "soft layered shadows between paper planes",
      cameraLanguage: "gentle parallax between paper layers",
      avoid: "photorealism, smooth gradients, 3D render",
    },
  },
  {
    id: "isometric",
    label: "Isometric",
    description: "Clean 2:1 axonometric diorama.",
    swatch: "linear-gradient(135deg,#6a82fb,#a6c1ee)",
    directives: {
      visualStyle: "clean isometric 3D, 2:1 axonometric, miniature diorama",
      colorPalette: "soft uniform palette",
      lighting: "even ambient occlusion, no harsh shadows",
      cameraLanguage: "fixed isometric angle with smooth pans",
      avoid: "perspective distortion, photorealism, hand-drawn lines",
    },
  },
  {
    id: "tiltshift",
    label: "Tilt-Shift Miniature",
    description: "Toy-scale hyperreal, shifted focus.",
    swatch: "linear-gradient(135deg,#43cea2,#185a9d)",
    directives: {
      visualStyle: "tilt-shift miniature photography, hyperreal toy-like scale",
      colorPalette: "vivid high-saturation",
      lighting: "bright midday daylight",
      cameraLanguage: "top-down tilt-shift angle, slow push-ins",
      avoid: "flat illustration, low saturation, line-art",
    },
  },
  {
    id: "anime",
    label: "Anime / Cel",
    description: "Cel-shaded, crisp lines, expressive.",
    swatch: "linear-gradient(135deg,#ff9a9e,#fad0c4)",
    directives: {
      visualStyle:
        "anime cel-shaded illustration, crisp linework, expressive characters",
      colorPalette: "vibrant cel colors",
      lighting: "stylized cel shading with bold highlights",
      cameraLanguage: "dynamic anime framing with occasional speed lines",
      avoid: "photorealism, 3D render, muted colors",
    },
  },
  {
    id: "watercolor",
    label: "Watercolor Storybook",
    description: "Soft washes, paper texture, bleeding edges.",
    swatch: "linear-gradient(135deg,#cfd9df,#e2ebf0)",
    directives: {
      visualStyle:
        "soft watercolor storybook painting, visible paper texture, bleeding edges",
      colorPalette: "muted pastel washes",
      lighting: "soft diffuse light",
      cameraLanguage: "gentle, slow movements",
      avoid: "hard edges, photorealism, 3D render",
    },
  },
] as const

/** Resolve a preset by id. Returns undefined for the "Auto" / unknown case. */
export function getStylePreset(id: string | undefined): StylePreset | undefined {
  if (!id) return undefined
  return STYLE_PRESETS.find((s) => s.id === id)
}
