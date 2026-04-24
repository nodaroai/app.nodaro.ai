/**
 * Canonical catalog of Styling / beauty + accessories choices.
 *
 * Multi-dimension parameter node like Person and Framing:
 *
 *   1. makeup         — Natural, glamour, smoky, goth, bold lips, editorial, dewy…
 *   2. hair-cut       — Pixie, bob, buzz cut, pompadour, dreadlocks, braids (45 entries)
 *   3. hair-treatment — Wet look, gelled back, disheveled, braided, ponytail…
 *   4. eyewear        — Sunglasses (aviators / cat-eye / round), fashion glasses…
 *   5. headwear       — Hats (beanie, cap, fedora…), headbands, hoods, crowns
 *   6. jewelry        — Subtle, statement, gold, silver, layered, pearl
 *   7. nails          — Polished, red, dark, long acrylic, French tips
 *   8. face-paint     — Subtle, dramatic, costume, tribal markings
 *   9. fabric         — Clothing fabric (silk, leather, denim, velvet…) phrased
 *                       as "wearing X". Overlaps vocabulary with the universal
 *                       Material node in the Object category, but Fabric is
 *                       clothing-specific and scoped to the Subject workflow.
 *
 * Each dimension is mutually exclusive within itself; all are optional.
 * Applies to BOTH image and video consumers. Includes pre/post free-text
 * fields for specifics the catalog can't express.
 */

export type StylingDimension =
  | "makeup"
  | "eyewear"
  | "headwear"
  | "hair-cut"
  | "hair-treatment"
  | "jewelry"
  | "nails"
  | "face-paint"
  | "fabric"

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

  // -------------------- Hair Cut (the styled cut/shape) --------------------
  // Natural texture + length live in Person.hair-base. This is what the
  // stylist did with it. 45 entries — the picker uses a modal browser.
  // ---- Short cuts ----
  { id: "cut-pixie",           label: "Pixie",           dimension: "hair-cut", description: "Short, cropped pixie cut",         promptHint: "styled in a short pixie cut" },
  { id: "cut-buzz-cut",        label: "Buzz Cut",        dimension: "hair-cut", description: "Very short buzz cut",              promptHint: "buzzed short" },
  { id: "cut-crew-cut",        label: "Crew Cut",        dimension: "hair-cut", description: "Short tapered classic crew cut",   promptHint: "styled in a short tapered crew cut" },
  { id: "cut-shaved",          label: "Shaved",          dimension: "hair-cut", description: "Fully shaved",                     promptHint: "shaved bald" },
  { id: "cut-undercut",        label: "Undercut",        dimension: "hair-cut", description: "Short sides, longer top",          promptHint: "with an undercut — short sides and longer hair on top" },
  { id: "cut-faux-hawk",       label: "Faux Hawk",       dimension: "hair-cut", description: "Center strip raised, sides faded", promptHint: "styled in a faux hawk with a raised center strip and faded sides" },
  { id: "cut-mohawk",          label: "Mohawk",          dimension: "hair-cut", description: "Shaved sides, tall center strip",  promptHint: "styled in a mohawk with shaved sides and a tall center strip" },
  { id: "cut-pompadour",       label: "Pompadour",       dimension: "hair-cut", description: "Swept up and back, volume in front", promptHint: "styled in a pompadour with hair swept up and back from the forehead" },
  { id: "cut-short",           label: "Short",           dimension: "hair-cut", description: "Generic short cut",                promptHint: "cut short" },
  { id: "cut-short-curly",     label: "Short Curly Cut", dimension: "hair-cut", description: "Short layered curly shape",        promptHint: "cut short with curls left out" },

  // ---- Bob family ----
  { id: "cut-micro-bob",       label: "Micro Bob",       dimension: "hair-cut", description: "Very short ear-length bob",        promptHint: "styled in a very short ear-length bob cut" },
  { id: "cut-french-bob",      label: "French Bob",      dimension: "hair-cut", description: "Jaw-length blunt bob, often with bangs", promptHint: "styled in a jaw-length blunt French bob with soft bangs" },
  { id: "cut-bob",             label: "Bob",             dimension: "hair-cut", description: "Chin-length bob cut",              promptHint: "styled in a chin-length bob cut" },
  { id: "cut-lob",             label: "Lob",             dimension: "hair-cut", description: "Long bob, collarbone-length",      promptHint: "styled in a long bob falling to the collarbone" },

  // ---- Layered / shag family ----
  { id: "cut-mullet",          label: "Mullet",          dimension: "hair-cut", description: "Short on top and sides, long in back", promptHint: "styled in a mullet with short top and long back" },
  { id: "cut-wolf-cut",        label: "Wolf Cut",        dimension: "hair-cut", description: "Shaggy layered mullet with fringe", promptHint: "styled in a wolf cut with shaggy choppy layers and a wispy fringe" },

  // ---- Bangs / fringe ----
  { id: "cut-bangs",           label: "Blunt Bangs",     dimension: "hair-cut", description: "Straight bangs across forehead",   promptHint: "with blunt bangs across the forehead" },
  { id: "cut-curtain-bangs",   label: "Curtain Bangs",   dimension: "hair-cut", description: "Center-parted face-framing bangs", promptHint: "with center-parted curtain bangs framing the face" },
  { id: "cut-wispy-bangs",     label: "Wispy Bangs",     dimension: "hair-cut", description: "Thin, piecey, airy fringe",        promptHint: "with thin wispy piecey bangs" },
  { id: "cut-side-swept",      label: "Side-Swept",      dimension: "hair-cut", description: "Falls across face over one eye",   promptHint: "side-swept across the face with strands falling over one eye" },

  // ---- Pulled back / updos ----
  { id: "cut-slicked-back",    label: "Slicked Back",    dimension: "hair-cut", description: "Pulled straight back, polished",   promptHint: "slicked straight back with a polished finish" },
  { id: "cut-bardot-tendrils", label: "Bardot Tendrils", dimension: "hair-cut", description: "Pulled back with face-framing strands", promptHint: "pulled back with thin face-framing tendrils falling loose at the temples" },
  { id: "cut-ponytail",        label: "Ponytail (Low)",  dimension: "hair-cut", description: "Low pulled-back ponytail",         promptHint: "in a low pulled-back ponytail" },
  { id: "cut-high-ponytail",   label: "High Ponytail",   dimension: "hair-cut", description: "Ponytail tied high on the crown",  promptHint: "in a high ponytail tied at the crown" },
  { id: "cut-half-up",         label: "Half-Up Half-Down", dimension: "hair-cut", description: "Top pulled back, rest flows down", promptHint: "in a half-up half-down style, top pulled back with the rest flowing down" },
  { id: "cut-bun",             label: "Bun",             dimension: "hair-cut", description: "Classic low or mid bun",           promptHint: "in a bun" },
  { id: "cut-top-knot",        label: "Top Knot",        dimension: "hair-cut", description: "Bun tied high on the crown",       promptHint: "in a top knot on the crown" },
  { id: "cut-space-buns",      label: "Space Buns",      dimension: "hair-cut", description: "Two symmetric buns either side",   promptHint: "in two symmetric space buns" },

  // ---- Braids ----
  { id: "cut-braids",          label: "Braids",          dimension: "hair-cut", description: "Multiple loose woven braids",      promptHint: "styled in multiple loose braids" },
  { id: "cut-single-braid",    label: "Single Braid",    dimension: "hair-cut", description: "One long braid down the back",     promptHint: "in a single long braid down the back" },
  { id: "cut-two-braids",      label: "Two Braids",      dimension: "hair-cut", description: "Pigtail braids either side",       promptHint: "in two pigtail braids" },
  { id: "cut-french-braid",    label: "French Braid",    dimension: "hair-cut", description: "Woven flat against the scalp",     promptHint: "in a French braid woven flat against the scalp" },
  { id: "cut-dutch-braid",     label: "Dutch Braid",     dimension: "hair-cut", description: "Inverted raised French braid",     promptHint: "in a raised Dutch braid" },
  { id: "cut-fishtail-braid",  label: "Fishtail Braid",  dimension: "hair-cut", description: "Fine two-strand weave",            promptHint: "in a fishtail braid" },
  { id: "cut-box-braids",      label: "Box Braids",      dimension: "hair-cut", description: "Individual sectioned braids",      promptHint: "in sectioned box braids" },
  { id: "cut-crown-braid",     label: "Crown Braid",     dimension: "hair-cut", description: "Braid wrapped around the head",    promptHint: "in a crown braid wrapped around the head" },
  { id: "cut-cornrows",        label: "Cornrows",        dimension: "hair-cut", description: "Braided cornrow pattern",          promptHint: "in tight cornrows" },

  // ---- Locs ----
  { id: "cut-dreadlocks",      label: "Dreadlocks",      dimension: "hair-cut", description: "Matted rope-like locs",            promptHint: "in dreadlocks" },
  { id: "cut-sisterlocks",     label: "Sisterlocks",     dimension: "hair-cut", description: "Thin, neatly sectioned micro-locs", promptHint: "in thin neat sisterlocks" },

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

  // -------------------- Fabric (clothing material) --------------------
  // Clothing-specific fabrics, phrased as "wearing X". Overlaps in vocabulary
  // with the universal Material node in the Object category, but Material uses
  // "made of X" grammar (works on any object/surface/body). Fabric reads
  // natively when the subject is already assumed to be wearing something.
  { id: "fabric-silk",     label: "Silk",     dimension: "fabric", description: "Smooth glossy silk garments",   promptHint: "wearing smooth glossy silk with a subtle sheen and fluid drape" },
  { id: "fabric-cotton",   label: "Cotton",   dimension: "fabric", description: "Soft matte cotton",             promptHint: "wearing soft matte cotton with a natural woven texture" },
  { id: "fabric-denim",    label: "Denim",    dimension: "fabric", description: "Heavy indigo denim",            promptHint: "wearing heavy indigo denim with visible diagonal weave and worn edges" },
  { id: "fabric-leather",  label: "Leather",  dimension: "fabric", description: "Rich supple leather",           promptHint: "wearing rich supple leather with a soft satin sheen and natural grain" },
  { id: "fabric-velvet",   label: "Velvet",   dimension: "fabric", description: "Plush velvet",                  promptHint: "wearing plush velvet with a deep soft nap and rich saturated color" },
  { id: "fabric-satin",    label: "Satin",    dimension: "fabric", description: "Glossy satin",                  promptHint: "wearing glossy satin with a lustrous mirror-like surface and fluid folds" },
  { id: "fabric-lace",     label: "Lace",     dimension: "fabric", description: "Delicate patterned lace",       promptHint: "wearing delicate patterned lace with intricate floral openwork" },
  { id: "fabric-wool",     label: "Wool",     dimension: "fabric", description: "Warm woven wool",               promptHint: "wearing warm woven wool with a soft matte surface and visible fibers" },
  { id: "fabric-linen",    label: "Linen",    dimension: "fabric", description: "Natural textured linen",        promptHint: "wearing natural linen with a loose open weave, slight slubs and an airy drape" },
  { id: "fabric-tweed",    label: "Tweed",    dimension: "fabric", description: "Rustic woven tweed",            promptHint: "wearing rustic tweed with a flecked multi-color woven texture and a heritage feel" },
  { id: "fabric-cashmere", label: "Cashmere", dimension: "fabric", description: "Luxurious soft cashmere",       promptHint: "wearing luxurious cashmere with an ultra-soft matte texture" },
  { id: "fabric-chiffon",  label: "Chiffon",  dimension: "fabric", description: "Sheer flowing chiffon",         promptHint: "wearing sheer chiffon with a lightweight floating drape and soft translucent layers" },
  { id: "fabric-fur",      label: "Fur",      dimension: "fabric", description: "Thick plush fur",               promptHint: "wearing thick plush fur with long dense strands and natural variation" },
  { id: "fabric-sequins",  label: "Sequins",  dimension: "fabric", description: "Sparkling sequin fabric",       promptHint: "wearing sparkling sequined fabric catching light with countless tiny reflective facets" },
  { id: "fabric-latex",    label: "Latex",    dimension: "fabric", description: "Glossy latex",                  promptHint: "wearing glossy latex with a high-shine liquid look clinging to the body" },
] as const

export const STYLING_DIMENSION_ORDER: ReadonlyArray<StylingDimension> = [
  "makeup",
  "hair-cut",
  "hair-treatment",
  "eyewear",
  "headwear",
  "jewelry",
  "nails",
  "face-paint",
  "fabric",
]

export const STYLING_DIMENSION_LABELS: Readonly<Record<StylingDimension, string>> = {
  makeup: "Makeup",
  eyewear: "Eyewear",
  headwear: "Headwear",
  "hair-cut": "Hair Cut / Style",
  "hair-treatment": "Hair Treatment",
  jewelry: "Jewelry",
  nails: "Nails",
  "face-paint": "Face Paint",
  fabric: "Fabric",
}

export const STYLING_FIELD_BY_DIMENSION: Record<
  StylingDimension,
  "makeup" | "eyewear" | "headwear" | "hairCut" | "hairTreatment" | "jewelry" | "nails" | "facePaint" | "fabric"
> = {
  makeup: "makeup",
  eyewear: "eyewear",
  headwear: "headwear",
  "hair-cut": "hairCut",
  "hair-treatment": "hairTreatment",
  jewelry: "jewelry",
  nails: "nails",
  "face-paint": "facePaint",
  fabric: "fabric",
}

export interface StylingValue {
  makeup?: string
  eyewear?: string
  headwear?: string
  /** Hair cut / styling choice — bob, wolf cut, braids, ponytail, etc.
   *  Pairs with Person.hair-base (texture + length). */
  hairCut?: string
  hairTreatment?: string
  jewelry?: string
  nails?: string
  facePaint?: string
  /** Clothing fabric / material — silk, leather, denim, etc. Phrased as
   *  "wearing X"; overlaps in vocabulary with the universal Material node
   *  in the Object category. */
  fabric?: string
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
