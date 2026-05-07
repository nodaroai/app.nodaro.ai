/**
 * Canonical catalog of loop-friendly subject presets ("Loop Subject").
 *
 * The Loop Subject parameter node emits one of these prompt fragments,
 * pre-tuned for VEO 3.1 perfect-loop generation. Each prompt is shaped to
 * either:
 *   - have inherently cyclical / ambient motion the model knows from the
 *     subject alone (clouds drift, aurora undulates, embers flicker), or
 *   - anchor periodicity via the "fractal" / "self-similar" tokens, which
 *     in user testing strongly biased VEO toward loop-tolerant output even
 *     when the prompt also contained directional cues (vanishing points,
 *     receding lines).
 *
 * These are NOT motion prompts — they describe the SCENE for the image
 * generator. The motion side (the perfect-loop seal phrase) is appended
 * separately at the i2v stage. Keeping the two concerns separated lets
 * users animate the same loop-friendly image with different motion intent
 * and lets us refine each library independently.
 */

export type LoopSubjectCategory = "realistic" | "abstract"

export interface LoopSubject {
  readonly id: string
  readonly label: string
  readonly category: LoopSubjectCategory
  readonly description: string
  /** Drop-in prompt text for Generate Image. Wired into the prompt input
   *  via FieldMappings, same as Setting / Motion / Mood Parameter nodes. */
  readonly promptHint: string
}

export const LOOP_SUBJECTS: ReadonlyArray<LoopSubject> = [
  // -------------------- Realistic --------------------
  {
    id: "aurora",
    label: "Aurora",
    category: "realistic",
    description: "Aurora borealis ribbons over a horizon",
    promptHint: "aurora borealis ribbons in green and violet over a snowy mountain horizon, wide centered framing, low ambient starlight, deep cosmic backdrop, no foreground subject",
  },
  {
    id: "clouds",
    label: "Drifting Clouds",
    category: "realistic",
    description: "Cumulus clouds against open sky",
    promptHint: "soft cumulus clouds against a deep blue sky, wide centered horizon, balanced composition, even ambient daylight, no harsh directional shadows, no foreground subject",
  },
  {
    id: "ocean-waves",
    label: "Ocean Waves",
    category: "realistic",
    description: "Open ocean with cyclical waves",
    promptHint: "endless ocean horizon with rolling cyclical waves, wide centered composition, even daylight, deep blue water, no foreground subject",
  },
  {
    id: "starfield",
    label: "Starfield",
    category: "realistic",
    description: "Deep space stars",
    promptHint: "deep space starfield with countless distant stars and faint nebula gas, centered radial composition, no perspective depth, dark cosmic background, no foreground subject",
  },
  {
    id: "fireplace",
    label: "Fireplace",
    category: "realistic",
    description: "Embers and dancing flame",
    promptHint: "warm fireplace embers and dancing flame, intimate close framing, deep amber and ember-orange palette, ambient firelight glow, no foreground subject",
  },
  {
    id: "rain",
    label: "Rain on Glass",
    category: "realistic",
    description: "Rain droplets on a window",
    promptHint: "close-up of rain droplets running down a glass window, soft out-of-focus city lights bokeh in the background, centered composition, cool blue ambient tone, no foreground subject",
  },
  {
    id: "snowfall",
    label: "Snowfall",
    category: "realistic",
    description: "Snow falling against a dark sky",
    promptHint: "soft snow falling steadily against a deep night sky, scattered evergreen silhouettes at the bottom edge, even ambient blue moonlight, balanced composition, no foreground subject",
  },
  {
    id: "lightning-storm",
    label: "Lightning Storm",
    category: "realistic",
    description: "Distant lightning over storm clouds",
    promptHint: "distant heat lightning flickering through massive storm clouds over a flat horizon, deep cinematic atmosphere, wide centered framing, dramatic backlit cloud structure, no foreground subject",
  },
  {
    id: "galaxy",
    label: "Galaxy",
    category: "realistic",
    description: "Spiral galaxy in deep space",
    promptHint: "spiral galaxy with swirling arms of stars and luminous gas, dust lanes radiating from a bright core, centered radial composition, deep cosmic black background, no perspective depth",
  },
  {
    id: "nebula",
    label: "Nebula",
    category: "realistic",
    description: "Colorful cosmic gas cloud",
    promptHint: "vivid cosmic nebula of red and blue gas with embedded stars, billowing fractal cloud structure, centered composition, deep space backdrop, no foreground subject",
  },
  {
    id: "sunbeams",
    label: "Sunbeams",
    category: "realistic",
    description: "Light rays through forest canopy",
    promptHint: "golden sunbeams cutting through a tall forest canopy with floating dust motes catching the light, centered vertical composition, deep green ambient tone, no human figures, no foreground subject",
  },
  {
    id: "cherry-blossoms",
    label: "Cherry Blossoms",
    category: "realistic",
    description: "Falling pink petals",
    promptHint: "soft pink cherry blossom petals drifting through the air against a pale sky, scattered petals at every depth, balanced centered composition, even ambient daylight, no foreground subject",
  },
  {
    id: "underwater",
    label: "Underwater Light",
    category: "realistic",
    description: "Sunbeams and bubbles below water",
    promptHint: "sunbeams cutting down through deep blue ocean water with rising silver air bubbles and floating particulate, centered cathedral-light composition, no surface horizon visible, no foreground subject",
  },
  {
    id: "embers",
    label: "Floating Embers",
    category: "realistic",
    description: "Glowing embers rising from fire",
    promptHint: "glowing orange embers floating slowly upward through dark smoky air, scattered at every depth, centered composition, deep warm ambient glow, no foreground subject",
  },

  // -------------------- Abstract / VJ --------------------
  {
    id: "tunnel",
    label: "Tunnel — Exciting",
    category: "abstract",
    description: "Fractal neon tunnel with depth",
    promptHint: "infinite fractal tunnel of glowing neon ribbons receding into a vanishing point, centered symmetric composition, deep volumetric light, no foreground subject",
  },
  {
    id: "tunnel-clean",
    label: "Tunnel — Clean",
    category: "abstract",
    description: "Periodic tunnel of geometric filaments",
    promptHint: "infinite fractal tunnel of glowing neon geometric filaments, self-similar repeating depth that recurses to infinity, centered symmetric composition, deep volumetric light, dark void background, no foreground subject",
  },
  {
    id: "kaleidoscope",
    label: "Kaleidoscope",
    category: "abstract",
    description: "Fractal mandala with radial symmetry",
    promptHint: "fractal kaleidoscope mandala in jewel tones, eight-fold radial symmetry, centered composition, even illumination, intricate self-similar geometric detail, no focal subject",
  },
  {
    id: "plasma",
    label: "Plasma Field",
    category: "abstract",
    description: "Swirling fractal energy",
    promptHint: "abstract plasma energy field of swirling fractal patterns, electric cyan and magenta, centered radial composition, dark void background, no foreground subject",
  },
  {
    id: "particle-swirl",
    label: "Particle Swirl",
    category: "abstract",
    description: "Glowing motes in fractal flow",
    promptHint: "abstract swirling particle field with thousands of glowing motes, fractal flow lines, centered radial composition, deep dark backdrop, no foreground subject",
  },
  {
    id: "fractal-zoom",
    label: "Fractal Zoom",
    category: "abstract",
    description: "Recursive Mandelbrot-style depth",
    promptHint: "infinite recursive fractal zoom into a kaleidoscopic mandala, self-similar at every scale, identical pattern repeats with each zoom level, glowing neon geometry, dark cosmic background, no foreground subject",
  },
  {
    id: "synthwave",
    label: "Synthwave Grid",
    category: "abstract",
    description: "Retro neon grid with sun",
    promptHint: "retro 1980s synthwave neon grid floor stretching to the horizon with a glowing pink and magenta sun, centered symmetric composition, deep purple sky with starfield, fractal repeating grid lines, no foreground subject",
  },
  {
    id: "wireframe",
    label: "Wireframe Sphere",
    category: "abstract",
    description: "Rotating wireframe geometry",
    promptHint: "glowing neon wireframe sphere with intricate self-similar geometric subdivisions, centered radial symmetry, dark void background, electric cyan rim glow, fractal mesh structure, no foreground subject",
  },
  {
    id: "equalizer",
    label: "Equalizer Bars",
    category: "abstract",
    description: "Pulsing audio visualizer",
    promptHint: "vertical audio equalizer bars in vibrant neon gradient pulsing at different heights, centered symmetric composition, dark backdrop with soft glow, repeating periodic structure, no foreground subject",
  },
  {
    id: "dna-helix",
    label: "DNA Helix",
    category: "abstract",
    description: "Rotating double helix",
    promptHint: "glowing neon DNA double helix structure with periodic identical rungs, centered vertical symmetric composition, electric cyan and magenta strands, dark void background, fractal repeating geometry, no foreground subject",
  },
  {
    id: "liquid-chrome",
    label: "Liquid Chrome",
    category: "abstract",
    description: "Reflective metallic ripples",
    promptHint: "liquid chrome surface with mirror-finish metallic ripples and concentric self-similar wave patterns, centered radial composition, iridescent reflections, deep dark backdrop, no foreground subject",
  },
  {
    id: "hologram",
    label: "Holographic Foil",
    category: "abstract",
    description: "Iridescent shifting colors",
    promptHint: "iridescent holographic foil surface with shifting rainbow gradient, fractal interference patterns, centered symmetric composition, deep dark backdrop, no foreground subject",
  },
  {
    id: "vortex",
    label: "Vortex",
    category: "abstract",
    description: "Swirling energy spiral",
    promptHint: "swirling energy vortex of glowing neon filaments spiraling toward a luminous center, centered radial composition, fractal self-similar spiral arms, dark cosmic backdrop, no foreground subject",
  },
  {
    id: "honeycomb",
    label: "Honeycomb",
    category: "abstract",
    description: "Hexagonal pattern pulsing",
    promptHint: "tessellated hexagonal honeycomb pattern in glowing neon, perfect six-fold radial symmetry, identical repeating cells across the entire frame, centered composition, dark void background, fractal self-similar geometric detail, no foreground subject",
  },
  {
    id: "glitch",
    label: "Glitch Static",
    category: "abstract",
    description: "Digital noise corruption",
    promptHint: "abstract digital glitch field of pixelated RGB color shift, scan lines, and self-similar noise blocks, centered composition, electric cyan and magenta corruption aesthetic, dark backdrop, no foreground subject",
  },
  {
    id: "black-hole",
    label: "Black Hole",
    category: "abstract",
    description: "Event horizon swirl",
    promptHint: "black hole event horizon with luminous accretion disk of glowing plasma swirling around a perfectly dark center, centered radial symmetry, fractal self-similar gas filaments, deep cosmic backdrop, no foreground subject",
  },
  {
    id: "geometric-morph",
    label: "Geometric Morph",
    category: "abstract",
    description: "Shifting platonic solids",
    promptHint: "abstract array of glowing neon platonic solid wireframes morphing through self-similar fractal subdivisions, centered radial symmetric composition, deep dark backdrop, electric rim lighting, no foreground subject",
  },
]

export function getLoopSubject(id: string): LoopSubject | undefined {
  return LOOP_SUBJECTS.find((s) => s.id === id)
}

export function getLoopSubjectLabel(id: string): string {
  return getLoopSubject(id)?.label ?? id
}

export function getLoopSubjectPromptHint(id: string): string {
  return getLoopSubject(id)?.promptHint ?? ""
}
