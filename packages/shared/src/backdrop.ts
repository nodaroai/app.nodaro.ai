/**
 * Canonical catalog of Backdrop / studio-background presets.
 *
 * Single-pick parameter node — user picks ONE backdrop describing the
 * controlled wall / surface / effect *immediately behind the subject*.
 * Distinct from Setting (which describes the location or environment a
 * shot takes place in). Backdrop is the studio convention behind the
 * subject during a portrait, fashion, beauty, e-commerce, or product
 * shoot — the seamless paper, painted wall, gradient sweep, or lit
 * effect that frames the subject.
 *
 * For full environments (cafe, forest, alley) use the Setting node.
 * For artistic medium use Style. For "in the air" particles use
 * Atmosphere. Backdrop occupies the narrow, well-defined slot of
 * "what wall is this person standing in front of."
 *
 * Applies to both image and video consumers (a studio backdrop carries
 * over to motion shoots). Not in STILL_IMAGE_EXCLUDE_TYPES.
 *
 * Shared between the picker UI, the standalone Backdrop parameter
 * node, and the prompt-hint injection on both the frontend DAG executor
 * and the backend orchestrator.
 */

export type BackdropCategory =
  | "solid"
  | "gradient"
  | "textured"
  | "fabric"
  | "effect"
  | "reflective"

export interface Backdrop {
  readonly id: string
  readonly label: string
  readonly category: BackdropCategory
  readonly description: string
  readonly promptHint: string
}

export const BACKDROPS: ReadonlyArray<Backdrop> = [
  // -------------------- Solid / Seamless --------------------
  { id: "white-seamless",     label: "White Seamless",     category: "solid",      description: "Clean white studio paper",          promptHint: "against a clean white seamless studio backdrop, evenly lit with soft diffused fill and no environmental detail beyond the subject" },
  { id: "black-seamless",     label: "Black Seamless",     category: "solid",      description: "Pure black studio backdrop",        promptHint: "against a deep black seamless studio backdrop falling off into shadow, isolating the subject in a pool of contained light" },
  { id: "grey-seamless",      label: "Grey Seamless",      category: "solid",      description: "Neutral mid-grey studio paper",     promptHint: "against a neutral mid-grey seamless studio backdrop, soft even lighting and a clean editorial portrait feel" },
  { id: "ivory-seamless",     label: "Ivory Seamless",     category: "solid",      description: "Warm ivory off-white backdrop",     promptHint: "against a warm ivory seamless backdrop, soft golden-toned fill and an elegant editorial cleanliness" },
  { id: "deep-red",           label: "Deep Red",           category: "solid",      description: "Saturated deep red wall",           promptHint: "against a saturated deep crimson studio backdrop, the rich red color reflecting subtly into the subject's skin and wardrobe" },
  { id: "royal-blue",         label: "Royal Blue",         category: "solid",      description: "Saturated royal blue backdrop",     promptHint: "against a vivid royal-blue studio backdrop, the bold color framing the subject with regal editorial weight" },
  { id: "emerald-green",      label: "Emerald Green",      category: "solid",      description: "Saturated emerald wall",            promptHint: "against a saturated emerald-green studio backdrop, the jewel tone giving the portrait a lush editorial intensity" },
  { id: "dusty-pink",         label: "Dusty Pink",         category: "solid",      description: "Soft muted pink backdrop",          promptHint: "against a soft dusty-pink studio backdrop, gentle warm reflected light and a romantic muted editorial palette" },
  { id: "mustard-yellow",     label: "Mustard Yellow",     category: "solid",      description: "Warm mustard backdrop",             promptHint: "against a warm mustard-yellow studio backdrop, the saturated tone radiating retro editorial warmth onto the subject" },
  { id: "teal-textured-wall", label: "Textured Teal Wall", category: "solid",      description: "Painted teal textured wall",        promptHint: "against a painted teal wall with subtle texture and uneven coverage, mid-tone shadows pooling into the surface and an editorial-portrait color cast" },
  { id: "chroma-green",       label: "Chroma Green",       category: "solid",      description: "Flat saturated green-screen",       promptHint: "against a flat saturated chroma-green screen backdrop, evenly lit with no shadow falloff and the uniform key-ready surface used for compositing" },
  { id: "chroma-blue",        label: "Chroma Blue",        category: "solid",      description: "Flat saturated blue-screen",        promptHint: "against a flat saturated chroma-blue screen backdrop, evenly lit with no shadow falloff and the uniform key-ready surface used for compositing" },
  { id: "paper-roll-seamless", label: "Paper Roll Seamless", category: "solid",     description: "Generic neutral pastel paper roll", promptHint: "against a generic seamless paper-roll backdrop in a soft neutral pastel tone, evenly lit with the gentle curve of a sweep rolling onto the floor and a clean studio-portrait feel" },

  // -------------------- Gradient --------------------
  { id: "red-orange-gradient", label: "Red-Orange Gradient", category: "gradient",  description: "Warm red-to-orange sweep",          promptHint: "against a smoothly graded red-to-orange studio sweep, the warm fiery transition wrapping behind the subject for a dynamic editorial backdrop" },
  { id: "pink-orange-gradient", label: "Pink-Orange Gradient", category: "gradient", description: "Sunset pink-to-orange sweep",       promptHint: "against a sunset-style gradient backdrop fading from soft pink at the top to warm orange below, a dreamy color sweep behind the subject" },
  { id: "blue-emerald-gradient", label: "Blue-Emerald Gradient", category: "gradient", description: "Cool blue-to-emerald sweep",       promptHint: "against a cool gradient backdrop fading from royal blue to emerald, the saturated transition giving the portrait a sleek editorial poster feel" },
  { id: "sunset-gradient",    label: "Sunset Gradient",    category: "gradient",   description: "Multi-tone sunset sweep",           promptHint: "against a multi-tone sunset gradient backdrop sweeping from violet through pink to gold, the colors blending behind the subject like a painted sky" },
  { id: "two-tone-split",     label: "Two-Tone Split",     category: "gradient",   description: "Split-color half-and-half wall",    promptHint: "against a two-tone studio backdrop split vertically into a saturated color on one side and a contrasting tone on the other, the hard color line slicing behind the subject" },

  // -------------------- Textured --------------------
  { id: "brick-wall",         label: "Brick Wall",         category: "textured",   description: "Exposed red-brick wall",            promptHint: "against an exposed red-brick wall with weathered mortar, soft ambient light raking across the rough surface for a gritty street-portrait feel" },
  { id: "concrete-wall",      label: "Concrete Wall",      category: "textured",   description: "Raw concrete surface",              promptHint: "against a raw cast-concrete wall with subtle imperfections and form-tie marks, a cool industrial backdrop with neutral grey shadow" },
  { id: "plastered-wall",     label: "Plastered Wall",     category: "textured",   description: "Hand-troweled plaster",             promptHint: "against a hand-troweled plaster wall with soft directional texture and warm cream tones, an artisanal editorial backdrop" },
  { id: "peeling-paint",      label: "Peeling Paint",      category: "textured",   description: "Vintage peeling-paint wall",        promptHint: "against a vintage wall with chipped and peeling layers of old paint, weathered texture and a moody worn-in editorial feel" },
  { id: "wood-paneling",      label: "Wood Paneling",      category: "textured",   description: "Warm wood-paneled wall",            promptHint: "against warm wood-paneled wall with horizontal plank lines, soft light catching the natural grain and a vintage interior portrait feel" },
  { id: "tile-wall",          label: "Tile Wall",          category: "textured",   description: "Bathroom or kitchen square tile",   promptHint: "against a square-tiled bathroom or kitchen wall with crisp grout lines, slight ceramic gloss catching the studio key and a clean utilitarian backdrop" },
  { id: "marble-wall",        label: "Marble Wall",        category: "textured",   description: "Luxury veined marble wall",         promptHint: "against a luxury veined marble wall, soft directional light revealing the natural stone striations and a polished high-end editorial backdrop" },

  // -------------------- Fabric / Drape --------------------
  { id: "muslin-drape",       label: "Muslin",             category: "fabric",     description: "Mottled hand-painted muslin",       promptHint: "against a mottled hand-painted muslin backdrop, soft cloudy color variation and the classic painterly studio-portrait feel" },
  { id: "velvet-drape",       label: "Velvet Drape",       category: "fabric",     description: "Heavy velvet drape backdrop",       promptHint: "against a richly draped velvet backdrop with deep saturated color, soft folds catching directional light and a luxurious old-Hollywood feel" },
  { id: "satin-drape",        label: "Satin Drape",        category: "fabric",     description: "Glossy satin drape",                promptHint: "against a glossy satin drape with fluid folds catching specular highlights, a glamorous editorial backdrop with a soft sheen" },
  { id: "canvas-painted",     label: "Painted Canvas",     category: "fabric",     description: "Painterly canvas backdrop",         promptHint: "against a painterly hand-painted canvas backdrop with soft brushstroke variation and a classic portrait-studio atmosphere" },

  // -------------------- Effect / Lighting --------------------
  { id: "bokeh-blur",         label: "Bokeh Blur",         category: "effect",     description: "Out-of-focus bokeh field",          promptHint: "against an out-of-focus bokeh field of soft warm light circles, a dreamy shallow-depth backdrop that throws all attention onto the subject" },
  { id: "neon-bokeh",         label: "Neon Bokeh",         category: "effect",     description: "Saturated neon bokeh blur",         promptHint: "against a saturated neon-bokeh blur of pink, cyan and magenta lights, a nightlife-style shallow-depth backdrop that frames the subject in glowing color" },
  { id: "halo-glow",          label: "Halo Glow",          category: "effect",     description: "Glowing circular halo behind head",  promptHint: "against a darkened backdrop with a single glowing circular halo of light directly behind the subject's head, sun-like and centered, framing them in a saintly aura" },
  { id: "light-leak",         label: "Light Leak",         category: "effect",     description: "Lens-flare light-leak streak",      promptHint: "against a backdrop washed by a warm orange light leak streaking across one side of the frame, lens-flare flares and a dreamy analog feel" },
  { id: "vignette-dark",      label: "Dark Vignette",      category: "effect",     description: "Heavy dark-vignette surround",      promptHint: "against a deep darkened backdrop with a heavy circular vignette pulling the edges into shadow, the subject illuminated in the center under a single soft key" },

  // -------------------- Reflective --------------------
  { id: "mirror-floor",       label: "Mirror Floor",       category: "reflective", description: "Reflective mirrored surface",       promptHint: "against a backdrop with a polished mirrored floor reflecting the subject upside-down beneath them, the doubled composition adding a surreal editorial touch" },
  { id: "polished-floor",     label: "Polished Floor",     category: "reflective", description: "Glossy polished floor reflection",  promptHint: "against a glossy polished floor with a soft hint of reflection beneath the subject, a clean architectural editorial backdrop" },
] as const

const backdropById = new Map<string, Backdrop>(BACKDROPS.map((b) => [b.id, b]))

export function getBackdrop(id: string | undefined | null): Backdrop | undefined {
  if (!id) return undefined
  return backdropById.get(id)
}

export function getBackdropLabel(id: string | undefined | null, fallback?: string): string {
  const b = getBackdrop(id)
  if (b) return b.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getBackdropPromptHint(id: string | undefined | null): string {
  return getBackdrop(id)?.promptHint ?? ""
}

export const BACKDROP_IDS: ReadonlyArray<string> = BACKDROPS.map((b) => b.id)

export const BACKDROP_CATEGORY_LABELS: Readonly<Record<BackdropCategory, string>> = {
  solid: "Solid / Seamless",
  gradient: "Gradient",
  textured: "Textured",
  fabric: "Fabric / Drape",
  effect: "Effect / Lighting",
  reflective: "Reflective",
}

export const BACKDROP_CATEGORY_ORDER: ReadonlyArray<BackdropCategory> = [
  "solid",
  "gradient",
  "textured",
  "fabric",
  "effect",
  "reflective",
]
