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
