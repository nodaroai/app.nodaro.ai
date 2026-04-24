/**
 * Canonical catalog of Styling / beauty + accessories choices.
 *
 * Multi-dimension parameter node like Person and Framing. Covers things
 * that are *applied to or worn on* the body but aren't clothing (which
 * belongs to a future Wardrobe node).
 *
 *   1. makeup      — None implied when not enabled. Natural, glamour, smoky, goth…
 *   2. eyewear     — Sunglasses (general / aviators / cat-eye / round), fashion glasses…
 *   3. headwear    — Hats (beanie, baseball cap, fedora…), headbands, hoods, crowns
 *   4. jewelry     — Subtle, statement, gold, silver, layered, pearl
 *   5. nails       — Polished, red, dark, long acrylic, French tips
 *   6. face-paint  — Subtle, dramatic, costume, tribal markings
 *
 * Each dimension is mutually exclusive within itself; all are optional.
 * Applies to BOTH image and video consumers. Includes pre/post free-text
 * fields for specifics the catalog can't express.
 */

export type StylingDimension =
  | "makeup"
  | "eyewear"
  | "headwear"
  | "hair-treatment"
  | "jewelry"
  | "nails"
  | "face-paint"

export interface Styling {
  readonly id: string
  readonly label: string
  readonly dimension: StylingDimension
  readonly description: string
  readonly promptHint: string
}

export const STYLINGS: ReadonlyArray<Styling> = [
  // -------------------- Makeup --------------------
  { id: "makeup-natural",   label: "Natural",       dimension: "makeup",     description: "Subtle, no-makeup makeup",  promptHint: "with natural, subtle no-makeup makeup" },
  { id: "makeup-glamour",   label: "Glamour",       dimension: "makeup",     description: "Full polished glam look",   promptHint: "with full glamour makeup, polished and editorial" },
  { id: "makeup-smoky",     label: "Smoky Eye",     dimension: "makeup",     description: "Dark dramatic eye makeup",  promptHint: "with smoky eye makeup, dark and dramatic" },
  { id: "makeup-bold-lips", label: "Bold Lips",     dimension: "makeup",     description: "Strong red or dark lipstick", promptHint: "with bold lips, a strong red or dark lipstick as the focal point" },
  { id: "makeup-editorial", label: "Editorial",     dimension: "makeup",     description: "Avant-garde fashion makeup", promptHint: "with avant-garde editorial makeup, artistic and unconventional" },
  { id: "makeup-goth",      label: "Goth",          dimension: "makeup",     description: "Dark goth aesthetic",       promptHint: "with goth makeup — pale skin, black eyeliner, dark lips" },
  { id: "makeup-dewy",      label: "Dewy Glow",     dimension: "makeup",     description: "Glowing fresh-skin focus",  promptHint: "with dewy makeup, glowing fresh skin and minimal coverage" },

  // -------------------- Eyewear --------------------
  { id: "eyewear-sunglasses",      label: "Sunglasses",      dimension: "eyewear", description: "Generic dark sunglasses", promptHint: "wearing sunglasses" },
  { id: "eyewear-aviators",        label: "Aviators",        dimension: "eyewear", description: "Classic aviator shades",  promptHint: "wearing classic aviator sunglasses with a metal frame" },
  { id: "eyewear-cat-eye",         label: "Cat-Eye",         dimension: "eyewear", description: "Vintage cat-eye frames",  promptHint: "wearing cat-eye glasses with vintage upswept frames" },
  { id: "eyewear-round",           label: "Round / John Lennon", dimension: "eyewear", description: "Round wire-frame glasses", promptHint: "wearing round wire-frame glasses, John Lennon style" },
  { id: "eyewear-fashion",         label: "Fashion Glasses", dimension: "eyewear", description: "Bold designer frames",    promptHint: "wearing bold fashion glasses with designer frames" },
  { id: "eyewear-sport",           label: "Sport Goggles",   dimension: "eyewear", description: "Wraparound sport eyewear", promptHint: "wearing wraparound sport sunglasses" },

  // -------------------- Headwear --------------------
  { id: "headwear-beanie",       label: "Beanie",        dimension: "headwear", description: "Knit beanie hat",        promptHint: "wearing a knit beanie" },
  { id: "headwear-baseball-cap", label: "Baseball Cap",  dimension: "headwear", description: "Curved-brim cap",         promptHint: "wearing a baseball cap" },
  { id: "headwear-fedora",       label: "Fedora",        dimension: "headwear", description: "Brimmed fedora",          promptHint: "wearing a fedora hat" },
  { id: "headwear-sun-hat",      label: "Sun Hat",       dimension: "headwear", description: "Wide-brimmed sun hat",    promptHint: "wearing a wide-brimmed sun hat" },
  { id: "headwear-headband",     label: "Headband",      dimension: "headwear", description: "Hair headband",           promptHint: "wearing a headband" },
  { id: "headwear-bandana",      label: "Bandana",       dimension: "headwear", description: "Bandana tied around head", promptHint: "wearing a bandana tied around the head" },
  { id: "headwear-hood",         label: "Hood",          dimension: "headwear", description: "Hooded sweatshirt up",    promptHint: "with a hood pulled up over the head" },
  { id: "headwear-crown",        label: "Crown",         dimension: "headwear", description: "Royal or decorative crown", promptHint: "wearing a crown atop the head" },
  { id: "headwear-helmet",       label: "Helmet",        dimension: "headwear", description: "Protective helmet",       promptHint: "wearing a helmet" },
  { id: "headwear-veil",         label: "Veil",          dimension: "headwear", description: "Veil draped over face/hair", promptHint: "wearing a veil draped over the head" },

  // -------------------- Hair Treatment (salon coloring techniques) --------------------
  { id: "treatment-babylights",  label: "Babylights",    dimension: "hair-treatment", description: "Ultra-fine, delicate highlights", promptHint: "with babylights — ultra-fine, delicate highlights that mimic natural sun-kissed hair" },
  { id: "treatment-balayage",    label: "Balayage",      dimension: "hair-treatment", description: "Hand-painted highlights",         promptHint: "with balayage — hand-painted highlights with a soft, sun-kissed gradient" },
  { id: "treatment-ombre",       label: "Ombré",         dimension: "hair-treatment", description: "Gradient dark roots to light ends", promptHint: "with ombré — a smooth gradient from dark roots to lighter ends" },
  { id: "treatment-sombre",      label: "Sombré",        dimension: "hair-treatment", description: "Subtle soft ombré",               promptHint: "with sombré — a subtle, soft ombré gradient" },
  { id: "treatment-highlights",  label: "Highlights",    dimension: "hair-treatment", description: "Classic foil highlights",         promptHint: "with highlights — lighter streaks throughout the hair" },
  { id: "treatment-lowlights",   label: "Lowlights",     dimension: "hair-treatment", description: "Darker shade streaks",            promptHint: "with lowlights — darker streaks woven through for dimension" },
  { id: "treatment-rooted",      label: "Rooted",        dimension: "hair-treatment", description: "Visible root regrowth look",      promptHint: "with a rooted look — visible darker roots blending into lighter lengths" },

  // -------------------- Jewelry --------------------
  { id: "jewelry-subtle",     label: "Subtle",     dimension: "jewelry", description: "Minimal, delicate jewelry", promptHint: "wearing subtle, minimal jewelry" },
  { id: "jewelry-statement",  label: "Statement",  dimension: "jewelry", description: "Bold statement piece",      promptHint: "wearing a bold statement jewelry piece" },
  { id: "jewelry-gold",       label: "Gold",       dimension: "jewelry", description: "Gold necklace + earrings",  promptHint: "wearing gold jewelry — a necklace and earrings" },
  { id: "jewelry-silver",     label: "Silver",     dimension: "jewelry", description: "Silver necklace + earrings", promptHint: "wearing silver jewelry — a necklace and earrings" },
  { id: "jewelry-layered",    label: "Layered",    dimension: "jewelry", description: "Layered necklaces / chains", promptHint: "wearing layered necklaces of varying lengths" },
  { id: "jewelry-pearl",      label: "Pearl",      dimension: "jewelry", description: "Pearl necklace / earrings", promptHint: "wearing a pearl necklace and pearl earrings" },
  { id: "jewelry-chunky",     label: "Chunky",     dimension: "jewelry", description: "Chunky chains and rings",   promptHint: "wearing chunky chains and oversized rings" },

  // -------------------- Nails --------------------
  { id: "nails-polished",     label: "Polished",     dimension: "nails", description: "Clear or nude polished nails", promptHint: "with polished nude nails" },
  { id: "nails-red",          label: "Red",          dimension: "nails", description: "Bright red nail polish",       promptHint: "with bright red nail polish" },
  { id: "nails-dark",         label: "Dark",         dimension: "nails", description: "Dark / black nails",           promptHint: "with dark black nail polish" },
  { id: "nails-long-acrylic", label: "Long Acrylic", dimension: "nails", description: "Long acrylic nails",           promptHint: "with long acrylic nails" },
  { id: "nails-french",       label: "French Tips",  dimension: "nails", description: "Classic French manicure",      promptHint: "with classic French tip manicure" },

  // -------------------- Face Paint --------------------
  { id: "face-paint-subtle",   label: "Subtle Body Paint", dimension: "face-paint", description: "Subtle body / face paint accents", promptHint: "with subtle body paint accents on the skin" },
  { id: "face-paint-dramatic", label: "Dramatic Face Paint", dimension: "face-paint", description: "Bold artistic face paint",       promptHint: "with dramatic, artistic face paint covering portions of the face" },
  { id: "face-paint-costume",  label: "Costume Paint",     dimension: "face-paint", description: "Cosplay / theatrical paint",       promptHint: "with theatrical costume face paint" },
  { id: "face-paint-tribal",   label: "Tribal Markings",   dimension: "face-paint", description: "Tribal-inspired face markings",    promptHint: "with tribal-inspired face markings" },
  { id: "face-paint-warpaint", label: "War Paint",         dimension: "face-paint", description: "Warrior war paint streaks",        promptHint: "with warrior war paint streaked across the face" },
] as const

export const STYLING_DIMENSION_ORDER: ReadonlyArray<StylingDimension> = [
  "makeup",
  "eyewear",
  "headwear",
  "hair-treatment",
  "jewelry",
  "nails",
  "face-paint",
]

export const STYLING_DIMENSION_LABELS: Readonly<Record<StylingDimension, string>> = {
  makeup: "Makeup",
  eyewear: "Eyewear",
  headwear: "Headwear",
  "hair-treatment": "Hair Treatment",
  jewelry: "Jewelry",
  nails: "Nails",
  "face-paint": "Face Paint",
}

export const STYLING_FIELD_BY_DIMENSION: Record<
  StylingDimension,
  "makeup" | "eyewear" | "headwear" | "hairTreatment" | "jewelry" | "nails" | "facePaint"
> = {
  makeup: "makeup",
  eyewear: "eyewear",
  headwear: "headwear",
  "hair-treatment": "hairTreatment",
  jewelry: "jewelry",
  nails: "nails",
  "face-paint": "facePaint",
}

export interface StylingValue {
  makeup?: string
  eyewear?: string
  headwear?: string
  hairTreatment?: string
  jewelry?: string
  nails?: string
  facePaint?: string
  preText?: string
  postText?: string
}

const stylingById = new Map<string, Styling>(STYLINGS.map((s) => [s.id, s]))

export function getStyling(id: string | undefined | null): Styling | undefined {
  if (!id) return undefined
  return stylingById.get(id)
}

export function getStylingLabel(id: string | undefined | null, fallback?: string): string {
  const s = getStyling(id)
  if (s) return s.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getStylingPromptHint(id: string | undefined | null): string {
  return getStyling(id)?.promptHint ?? ""
}

export const STYLING_IDS: ReadonlyArray<string> = STYLINGS.map((s) => s.id)

export function buildStylingHints(
  data: Record<string, unknown> & StylingValue,
): string[] {
  const hints: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) hints.push(pre)

  for (const dimension of STYLING_DIMENSION_ORDER) {
    const field = STYLING_FIELD_BY_DIMENSION[dimension]
    const id = data[field]
    if (typeof id !== "string" || id.length === 0) continue
    const hint = getStylingPromptHint(id)
    if (hint) hints.push(hint)
  }

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) hints.push(post)

  return hints
}
