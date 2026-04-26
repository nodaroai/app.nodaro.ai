/**
 * Canonical catalog of Held Prop / hand-prop presets.
 *
 * Single-pick parameter node — user picks ONE prop the subject is
 * actively holding or interacting with. Distinct from the Object node,
 * which describes a *separate* object somewhere in the scene. A held
 * prop is part of the subject's pose grammar — they're cradling it,
 * raising it, smoking it, gripping it. Each promptHint therefore
 * incorporates a small piece of pose / hand language so the prop reads
 * as actively held rather than just "near."
 *
 * There is intentional vocabulary overlap with the Weapon node (katana,
 * pistol) and with parts of the Material / Vehicle catalogs — Held Prop
 * uses the held-in-hand grammar ("holding…", "cradling…"), while the
 * Weapon node uses the descriptive scene grammar ("with a katana, …").
 *
 * Applies to both image and video consumers (the prop and pose carry
 * over to motion). Not in STILL_IMAGE_EXCLUDE_TYPES.
 *
 * Shared between the picker UI, the standalone Held Prop parameter
 * node, and the prompt-hint injection on both the frontend DAG executor
 * and the backend orchestrator.
 */

export type HeldPropCategory =
  | "device"
  | "drink"
  | "smoking"
  | "reading-writing"
  | "bag-accessory"
  | "floral-nature"
  | "instrument"
  | "companion"
  | "occupational"

export interface HeldProp {
  readonly id: string
  readonly label: string
  readonly category: HeldPropCategory
  readonly description: string
  readonly promptHint: string
}

export const HELD_PROPS: ReadonlyArray<HeldProp> = [
  // -------------------- Devices / Phones --------------------
  { id: "smartphone",         label: "Smartphone",         category: "device",          description: "Modern phone in hand",              promptHint: "holding a modern smartphone in one hand, screen lightly catching the ambient light, fingers wrapped naturally around the device" },
  { id: "smartphone-raised",  label: "Phone Raised",       category: "device",          description: "Phone raised mid-photo",            promptHint: "holding a smartphone raised at arm's length toward the camera as if mid-photo, both the phone and the gesture clearly visible" },
  { id: "polaroid-camera",    label: "Polaroid Camera",    category: "device",          description: "Vintage instant camera",            promptHint: "cradling a vintage Polaroid instant camera in both hands at chest height, the boxy white body and rainbow stripe clearly visible" },
  { id: "vintage-camera",     label: "Vintage Camera",     category: "device",          description: "Old film camera with strap",        promptHint: "holding a vintage 35mm film camera lifted toward the face with a leather strap looped around the neck, fingers poised over the shutter" },
  { id: "dslr-camera",        label: "DSLR Camera",        category: "device",          description: "Modern DSLR / mirrorless camera",   promptHint: "holding a modern DSLR camera up to the eye with both hands wrapped around the body and lens, mid-composition" },
  { id: "video-camera",       label: "Video Camera",       category: "device",          description: "Shoulder-mounted video camera",     promptHint: "shouldering a professional video camera with one hand on the side grip and the other steadying the body, eye to the viewfinder" },
  { id: "microphone",         label: "Microphone",         category: "device",          description: "Handheld vocal microphone",         promptHint: "gripping a handheld microphone close to the lips with one hand, the cable looping down from the bottom" },
  { id: "megaphone",          label: "Megaphone",          category: "device",          description: "Bullhorn / megaphone",              promptHint: "holding a bullhorn megaphone raised toward the mouth with the trigger pressed, the wide cone aimed forward" },
  { id: "smartwatch",         label: "Smartwatch",         category: "device",          description: "Wrist raised to check watch",       promptHint: "raising one wrist into frame with a sleek smartwatch face glowing on it, the other hand lightly steadying the band" },

  // -------------------- Drinks --------------------
  { id: "coffee-cup",         label: "Coffee Cup",         category: "drink",           description: "Ceramic coffee cup",                promptHint: "cradling a warm ceramic coffee cup in both hands at chest height, soft steam rising from the rim" },
  { id: "takeaway-coffee",    label: "Takeaway Coffee",    category: "drink",           description: "Paper takeaway coffee cup",         promptHint: "holding a paper takeaway coffee cup with a sleeve and lid in one hand, steam drifting from the small opening" },
  { id: "wine-glass",         label: "Wine Glass",         category: "drink",           description: "Stemmed glass of red wine",         promptHint: "holding a stemmed wine glass by the bowl, deep red wine catching the warm ambient light" },
  { id: "champagne-flute",    label: "Champagne Flute",    category: "drink",           description: "Tall champagne flute",              promptHint: "holding a tall champagne flute by the stem, bubbles rising in the pale gold liquid" },
  { id: "martini-glass",      label: "Martini Glass",      category: "drink",           description: "Classic martini glass",             promptHint: "holding a classic conical martini glass by the stem at chest height, a single olive on a pick resting in the clear liquor" },
  { id: "cocktail-glass",     label: "Cocktail Glass",     category: "drink",           description: "Short glass with cocktail",         promptHint: "holding a short rocks glass with an amber cocktail and a single ice sphere, two fingers pressed against the chilled side" },
  { id: "beer-bottle",        label: "Beer Bottle",        category: "drink",           description: "Brown bottle of beer",              promptHint: "holding a brown glass beer bottle loosely by the neck, condensation beading on the surface" },
  { id: "water-bottle",       label: "Water Bottle",       category: "drink",           description: "Reusable water bottle",             promptHint: "holding a tall reusable water bottle in one hand at hip height, condensation beading on its sides" },

  // -------------------- Smoking --------------------
  { id: "cigarette",          label: "Cigarette",          category: "smoking",         description: "Lit cigarette between fingers",     promptHint: "holding a lit cigarette pinched between two fingers raised near the face, a thin curl of smoke drifting upward" },
  { id: "cigar",              label: "Cigar",              category: "smoking",         description: "Thick lit cigar",                   promptHint: "holding a thick lit cigar between two fingers, a slow wisp of smoke rising and an ember glowing at the tip" },
  { id: "vape-pen",           label: "Vape Pen",           category: "smoking",         description: "Slim vape pen",                     promptHint: "holding a slim vape pen between two fingers, a soft puff of vapor curling out from a half-parted mouth" },
  { id: "joint",              label: "Joint",              category: "smoking",         description: "Hand-rolled joint",                 promptHint: "holding a hand-rolled joint pinched between thumb and forefinger, a thin trail of smoke rising into the frame" },
  { id: "lighter",            label: "Lighter",            category: "smoking",         description: "Chrome lighter with thumb on flame", promptHint: "holding a polished chrome lighter cupped in one hand with the thumb pressed on the wheel, a small warm flame catching across the fingers" },

  // -------------------- Reading / Writing --------------------
  { id: "book",               label: "Book",               category: "reading-writing", description: "Open hardback book",                promptHint: "holding an open hardback book in both hands at chest height, eyes drifting down toward the page" },
  { id: "magazine",           label: "Magazine",           category: "reading-writing", description: "Glossy folded magazine",            promptHint: "holding a glossy magazine folded back on itself in one hand, the cover partly visible from the side" },
  { id: "newspaper",          label: "Newspaper",          category: "reading-writing", description: "Folded broadsheet newspaper",       promptHint: "holding a folded broadsheet newspaper open between both hands at chest height, masthead lightly visible" },
  { id: "notebook",           label: "Notebook",           category: "reading-writing", description: "Open lined notebook",               promptHint: "holding an open lined notebook in one hand at chest height with a pen poised above the page in the other" },
  { id: "pen",                label: "Pen",                category: "reading-writing", description: "Pen poised mid-write",              promptHint: "holding a slender pen between thumb and fingers, the tip poised over an unseen surface as if mid-thought" },
  { id: "marker",             label: "Marker",             category: "reading-writing", description: "Thick marker mid-stroke",           promptHint: "holding a thick permanent marker in one hand, cap clenched in the teeth and the tip poised mid-stroke" },
  { id: "paintbrush",         label: "Paintbrush",         category: "reading-writing", description: "Loaded paintbrush",                 promptHint: "holding a loaded paintbrush between thumb and fingers, bristles glistening with wet color and the wrist softly turned" },
  { id: "chalk",              label: "Chalk",              category: "reading-writing", description: "White stick of chalk",              promptHint: "holding a short stick of white chalk between thumb and forefinger, faint chalk dust drifting from the tip as if mid-stroke" },

  // -------------------- Bags / Accessories --------------------
  { id: "handbag",            label: "Handbag",            category: "bag-accessory",   description: "Designer handbag",                  promptHint: "carrying a structured designer handbag by the top handles in one hand at hip height, the bag positioned cleanly in frame" },
  { id: "tote-bag",           label: "Tote Bag",           category: "bag-accessory",   description: "Soft canvas tote",                  promptHint: "carrying a soft canvas tote bag slung over one shoulder, fabric folding naturally against the side" },
  { id: "briefcase",          label: "Briefcase",          category: "bag-accessory",   description: "Hard-shell briefcase",              promptHint: "carrying a hard-shell briefcase by the top handle in one hand at hip height, the case angled to read clearly in frame" },
  { id: "umbrella",           label: "Umbrella",           category: "bag-accessory",   description: "Open black umbrella",               promptHint: "holding an open black umbrella overhead with one hand, the canopy haloing the head and shadow falling across the face" },
  { id: "fan-folding",        label: "Folding Fan",        category: "bag-accessory",   description: "Open hand-painted fan",             promptHint: "holding an open hand-painted folding fan raised near the face, fingers fanned along the spine" },
  { id: "parasol",            label: "Parasol",            category: "bag-accessory",   description: "Decorative Victorian / Asian parasol", promptHint: "holding a decorative parasol open above one shoulder, the lace or hand-painted canopy shielding the face from sun and casting a delicate dappled shadow" },
  { id: "locket",             label: "Locket",             category: "bag-accessory",   description: "Open vintage locket pendant",       promptHint: "holding an open vintage locket pendant between thumb and forefinger close to the chest, the tiny portrait inside angled gently toward the face" },

  // -------------------- Floral / Nature --------------------
  { id: "bouquet",            label: "Bouquet",            category: "floral-nature",   description: "Mixed bouquet of flowers",          promptHint: "cradling a mixed bouquet of fresh flowers in both arms against the chest, blooms framing the face from below" },
  { id: "single-rose",        label: "Single Rose",        category: "floral-nature",   description: "Single long-stem rose",             promptHint: "holding a single long-stem red rose loosely between two fingers, the bloom raised softly toward the face" },
  { id: "sunflower",          label: "Sunflower",          category: "floral-nature",   description: "Single tall sunflower",             promptHint: "holding a tall sunflower upright by the stem in one hand, the wide yellow bloom raised slightly above the shoulder" },
  { id: "leaf",               label: "Leaf",               category: "floral-nature",   description: "Single large leaf",                 promptHint: "holding a single large green leaf by its stem in one hand, the broad surface positioned to one side of the face" },
  { id: "fruit-apple",        label: "Apple",              category: "floral-nature",   description: "Single fresh apple",                promptHint: "holding a single fresh apple cradled in one open palm at chest height, the glossy skin catching the light" },

  // -------------------- Instruments / Performance --------------------
  { id: "guitar",             label: "Guitar",             category: "instrument",      description: "Guitar slung across body",          promptHint: "holding a guitar slung across the body with one hand on the neck and the other resting over the strings near the soundhole" },
  { id: "violin",             label: "Violin",             category: "instrument",      description: "Violin under chin",                 promptHint: "holding a violin tucked under the chin with one hand fingering the neck and the other drawing a bow across the strings" },
  { id: "saxophone",          label: "Saxophone",          category: "instrument",      description: "Saxophone raised to lips",          promptHint: "holding a saxophone raised to the lips with both hands wrapped around the keys, a strap supporting the weight at the neck" },
  { id: "drumsticks",         label: "Drumsticks",         category: "instrument",      description: "Pair of drumsticks crossed",        promptHint: "holding a pair of drumsticks crossed in front of the chest, fingers wrapped firmly around their grips" },
  { id: "sheet-music",        label: "Sheet Music",        category: "instrument",      description: "Folded sheet music",                promptHint: "holding a folded sheet of musical notation open between both hands at chest height, eyes lightly scanning the staves" },

  // -------------------- Companion --------------------
  { id: "small-dog",          label: "Small Dog",          category: "companion",       description: "Small dog held in arms",            promptHint: "cradling a small dog in both arms against the chest, the pet's head resting comfortably under the subject's chin" },
  { id: "cat",                label: "Cat",                category: "companion",       description: "Cat draped over arm",               promptHint: "cradling a cat draped across one arm at chest height, the other hand resting gently along its back" },
  { id: "plush-toy",          label: "Plush Toy",          category: "companion",       description: "Soft plush toy hugged",             promptHint: "hugging a soft plush toy against the chest with both arms wrapped around it, head leaning lightly against its top" },

  // -------------------- Occupational / Weapon --------------------
  { id: "katana",             label: "Katana",             category: "occupational",    description: "Single-edged Japanese sword",       promptHint: "holding a katana with one hand on the wrapped grip and the other resting on the long polished edge, blade angled diagonally across the body" },
  { id: "pointer-stick",      label: "Pointer Stick",      category: "occupational",    description: "Telescoping pointer stick",         promptHint: "holding a slender telescoping pointer stick in one hand, the tip raised toward an unseen surface as if mid-explanation" },
  { id: "gavel",              label: "Gavel",              category: "occupational",    description: "Wooden judicial gavel",             promptHint: "gripping a polished wooden gavel mid-strike with one hand, the head poised above an unseen sound block" },
  { id: "wine-bottle",        label: "Wine Bottle",        category: "occupational",    description: "Full bottle with foil seal",        promptHint: "holding a tall wine bottle by the neck with one hand, the labeled body and red foil seal angled clearly toward the camera" },
  { id: "lantern",            label: "Lantern",            category: "occupational",    description: "Vintage handheld lantern with amber glow", promptHint: "carrying a vintage handheld lantern by its top ring at hip height, warm amber glow casting a soft circular pool of light across the face and surroundings" },
  { id: "flashlight",         label: "Flashlight",         category: "occupational",    description: "Modern flashlight cutting a beam",  promptHint: "holding a modern flashlight raised forward in one hand, a sharp white beam cutting through the darkness ahead and side-lighting the face" },
  { id: "compass",            label: "Compass",            category: "occupational",    description: "Vintage handheld nautical compass", promptHint: "holding a vintage brass nautical compass open in one cupped palm at chest height, the needle clearly visible as the eyes drift down to read the bearing" },
  { id: "bow-and-arrow",      label: "Bow and Arrow",      category: "occupational",    description: "Drawn archery bow with arrow nocked", promptHint: "holding an archery bow drawn at full tension with one hand on the grip and the other pulling the string back to the cheek, an arrow nocked and aimed forward" },
  { id: "shield",             label: "Shield",             category: "occupational",    description: "Handheld medieval shield",          promptHint: "holding a medieval shield raised across the body with one arm strapped through the back, the front face angled forward in a defensive stance" },
] as const

const heldPropById = new Map<string, HeldProp>(HELD_PROPS.map((p) => [p.id, p]))

export function getHeldProp(id: string | undefined | null): HeldProp | undefined {
  if (!id) return undefined
  return heldPropById.get(id)
}

export function getHeldPropLabel(id: string | undefined | null, fallback?: string): string {
  const p = getHeldProp(id)
  if (p) return p.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getHeldPropPromptHint(id: string | undefined | null): string {
  return getHeldProp(id)?.promptHint ?? ""
}

/**
 * Multi-pick: 1-2 prop ids → composite held-prop clause. Single → entry's
 * own promptHint (which already starts with "holding..." / "carrying..."
 * grammar). Two → emit independently, joined by buildPersonHints-style
 * comma-join. Common combos: book + coffee, cigarette + drink, phone + bag.
 */
export function buildHeldPropHints(value: unknown): string[] {
  const ids: string[] = []
  if (typeof value === "string" && value) ids.push(value)
  else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  const out: string[] = []
  for (const id of ids) {
    const hint = getHeldPropPromptHint(id)
    if (hint) out.push(hint)
  }
  return out
}

export const HELD_PROP_IDS: ReadonlyArray<string> = HELD_PROPS.map((p) => p.id)

export const HELD_PROP_CATEGORY_LABELS: Readonly<Record<HeldPropCategory, string>> = {
  device: "Devices / Phones",
  drink: "Drinks",
  smoking: "Smoking",
  "reading-writing": "Reading / Writing",
  "bag-accessory": "Bags / Accessories",
  "floral-nature": "Floral / Nature",
  instrument: "Instruments / Performance",
  companion: "Companions",
  occupational: "Occupational",
}

export const HELD_PROP_CATEGORY_ORDER: ReadonlyArray<HeldPropCategory> = [
  "device",
  "drink",
  "smoking",
  "reading-writing",
  "bag-accessory",
  "floral-nature",
  "instrument",
  "companion",
  "occupational",
]
