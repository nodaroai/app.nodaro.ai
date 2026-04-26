/**
 * Canonical catalog of Styling / beauty + wardrobe + accessories choices.
 *
 * Multi-dimension parameter node like Person and Framing:
 *
 *   Beauty / Hair / Accessories
 *   1. makeup         — Natural, glamour, smoky, goth, bold lips, editorial, dewy…
 *   2. hair-cut       — Pixie, bob, buzz cut, pompadour, dreadlocks, braids (45 entries)
 *   3. hair-treatment — Babylights, balayage, ombré, highlights…
 *   4. hair-state     — Wet, messy, windswept, voluminous, sleek, frizzy,
 *                       tousled, flowing… Hair motion / condition. Distinct
 *                       from cut (shape) and treatment (color).
 *   5. eyewear        — Sunglasses (aviators / cat-eye / round), fashion glasses…
 *   6. headwear       — Hats (beanie, cap, fedora…), headbands, hoods, crowns
 *   7. jewelry        — Subtle, statement, gold, silver, layered, pearl
 *   8. nails          — Polished, red, dark, long acrylic, French tips
 *   9. face-paint     — Subtle, dramatic, costume, tribal markings
 *
 *   Wardrobe (head-to-toe garments)
 *   10. outfit        — Single-pick complete look (school uniform, business
 *                       suit, evening gown, scrubs, bikini, lingerie, kimono…).
 *                       Intended as an override that semantically supersedes
 *                       the per-piece selections; users are responsible for
 *                       not stacking conflicting pieces.
 *   11. top           — Upper-body garment (t-shirt, hoodie, sweater, blouse,
 *                       crop top, bikini top, sports bra…)
 *   12. bottom        — Lower-body garment (jeans, chinos, skirt, shorts,
 *                       leggings, sweatpants…)
 *   13. outerwear     — Layered-over outer garment (leather jacket, blazer,
 *                       trench, puffer, cardigan, kimono robe…)
 *   14. legwear       — Stockings / tights / socks worn between bottom and
 *                       footwear (sheer / opaque tights, fishnets, thigh-highs…)
 *   15. footwear      — Shoes (sneakers, heels, boots, loafers, sandals…)
 *
 *   Modifiers
 *   16. fabric         — Clothing fabric (silk, leather, denim, velvet…) phrased
 *                        as "wearing X". Overlaps vocabulary with the universal
 *                        Material node in the Object category, but Fabric is
 *                        clothing-specific and scoped to the Subject workflow.
 *   17. wardrobe-state — How the clothes are worn (oversized, fitted, cropped,
 *                        sheer, wet, ripped, off-shoulder, tucked-in, layered,
 *                        unbuttoned…). Composes with any garment selection.
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
  | "hair-state"
  | "jewelry"
  | "nails"
  | "face-paint"
  | "outfit"
  | "top"
  | "bottom"
  | "outerwear"
  | "legwear"
  | "footwear"
  | "fabric"
  | "wardrobe-state"

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

  // -------------------- Hair State (motion / condition — distinct from cut shape and treatment color) --------------------
  { id: "hair-wet",         label: "Wet",          dimension: "hair-state", description: "Soaked, water-clinging hair",  promptHint: "with hair soaked and wet, strands clinging together and dripping water" },
  { id: "hair-damp",        label: "Damp",         dimension: "hair-state", description: "Just-washed damp hair",        promptHint: "with hair freshly damp, slightly weighted and softly clumped" },
  { id: "hair-messy",       label: "Messy",        dimension: "hair-state", description: "Disheveled, unkempt",          promptHint: "with hair messy and disheveled, unkempt strands going every direction" },
  { id: "hair-tousled",     label: "Tousled",      dimension: "hair-state", description: "Lightly mussed, lived-in",     promptHint: "with hair softly tousled and lived-in, casual undone movement" },
  { id: "hair-bedhead",     label: "Bedhead",      dimension: "hair-state", description: "Just-woken-up flattened side", promptHint: "with bedhead — hair flattened on one side, fluffed on the other, like just woken up" },
  { id: "hair-windswept",   label: "Windswept",    dimension: "hair-state", description: "Wind-blown, hair in motion",   promptHint: "with hair caught mid-motion in wind, strands streaming sideways across and away from the face" },
  { id: "hair-voluminous",  label: "Voluminous",   dimension: "hair-state", description: "Big, blown-out volume",        promptHint: "with hair full of volume, blown out and bouncy with body and lift at the roots" },
  { id: "hair-sleek",       label: "Sleek",        dimension: "hair-state", description: "Glassy smooth straight",       promptHint: "with hair sleek and glass-smooth, every strand pressed flat with a polished sheen" },
  { id: "hair-frizzy",      label: "Frizzy",       dimension: "hair-state", description: "Halo of frizz",                promptHint: "with hair frizzy, fine flyaway strands forming a soft halo around the head" },
  { id: "hair-strands-on-face", label: "Strands on Face", dimension: "hair-state", description: "Loose strands across face", promptHint: "with loose hair strands falling across the face, partially covering one eye" },
  { id: "hair-tucked-behind-ear", label: "Tucked Behind Ear", dimension: "hair-state", description: "Pushed behind one ear", promptHint: "with hair pushed back and tucked behind one ear, exposing the side of the face" },
  { id: "hair-flowing",     label: "Flowing",      dimension: "hair-state", description: "Long flowing motion",          promptHint: "with hair flowing freely, strands cascading and rippling with subtle movement" },

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
  { id: "jewelry-smart-watch", label: "Smart Watch", dimension: "jewelry", description: "Modern smart watch on wrist", promptHint: "wearing a modern smart watch on the wrist with a sleek digital face and silicone band" },
  { id: "jewelry-choker-leather", label: "Leather Choker", dimension: "jewelry", description: "Black leather choker close to throat", promptHint: "wearing a black leather choker fitted close around the throat" },
  { id: "jewelry-choker-velvet", label: "Velvet Choker", dimension: "jewelry", description: "Velvet ribbon choker, dressy and vintage", promptHint: "wearing a velvet ribbon choker around the throat, a dressy vintage touch with a small pendant at the front" },
  { id: "jewelry-choker-chain", label: "Chain Choker", dimension: "jewelry", description: "Thin metal-chain choker", promptHint: "wearing a thin metal-chain choker tight around the throat" },
  { id: "jewelry-stud-earrings", label: "Stud Earrings", dimension: "jewelry", description: "Small simple studs", promptHint: "wearing small simple stud earrings" },
  { id: "jewelry-hoop-earrings", label: "Hoop Earrings", dimension: "jewelry", description: "Gold or silver hoops", promptHint: "wearing gold or silver hoop earrings" },
  { id: "jewelry-ear-cuff", label: "Ear Cuff", dimension: "jewelry", description: "Sculptural cuff climbing the cartilage", promptHint: "wearing a sculptural ear cuff climbing the cartilage of one ear" },
  { id: "jewelry-septum-ring", label: "Septum Ring", dimension: "jewelry", description: "Septum nose ring", promptHint: "wearing a septum nose ring through the center of the nose" },
  { id: "jewelry-body-chain", label: "Body Chain", dimension: "jewelry", description: "Thin metallic chain across torso", promptHint: "wearing a thin metallic body chain draped across the torso" },

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

  // -------------------- Outfit (single-pick complete look — overrides individual pieces) --------------------
  { id: "outfit-school-uniform",   label: "School Uniform",   dimension: "outfit", description: "Classic school uniform set",        promptHint: "dressed in a classic school uniform — collared blouse, pleated skirt and knee-high socks" },
  { id: "outfit-business-suit",    label: "Business Suit",    dimension: "outfit", description: "Tailored two-piece business suit",  promptHint: "dressed in a sharp tailored two-piece business suit with a crisp shirt underneath" },
  { id: "outfit-tuxedo",           label: "Tuxedo",           dimension: "outfit", description: "Black-tie tuxedo",                  promptHint: "dressed in a black tuxedo with satin lapels and a bow tie" },
  { id: "outfit-evening-gown",     label: "Evening Gown",     dimension: "outfit", description: "Floor-length formal gown",          promptHint: "dressed in a floor-length evening gown with a fitted bodice and a flowing skirt" },
  { id: "outfit-wedding-dress",    label: "Wedding Dress",    dimension: "outfit", description: "White wedding gown",                promptHint: "dressed in a white wedding gown with intricate lace detailing and a sweeping train" },
  { id: "outfit-cocktail-dress",   label: "Cocktail Dress",   dimension: "outfit", description: "Knee-length cocktail dress",        promptHint: "dressed in a sleek knee-length cocktail dress" },
  { id: "outfit-lab-coat",         label: "Lab Coat",         dimension: "outfit", description: "White medical lab coat",            promptHint: "wearing a crisp white lab coat layered over the rest of the clothing" },
  { id: "outfit-scrubs",           label: "Medical Scrubs",   dimension: "outfit", description: "Solid-color medical scrubs",        promptHint: "dressed in solid-color medical scrubs — loose-fit top and matching drawstring pants" },
  { id: "outfit-military",         label: "Military Fatigues", dimension: "outfit", description: "Olive-drab military fatigues",     promptHint: "dressed in olive-drab military fatigues with utility pockets and a sturdy belt" },
  { id: "outfit-lifeguard",        label: "Lifeguard Outfit", dimension: "outfit", description: "Red lifeguard top and shorts",      promptHint: "dressed in a bright red lifeguard outfit — a fitted top and matching shorts" },
  { id: "outfit-athleisure",       label: "Athleisure Set",   dimension: "outfit", description: "Matching athleisure top and bottom", promptHint: "dressed in a matching athleisure set — a fitted top and leggings in the same tone" },
  { id: "outfit-tracksuit",        label: "Tracksuit",        dimension: "outfit", description: "Two-piece zip-front tracksuit",     promptHint: "dressed in a two-piece tracksuit — a zip-front jacket and matching joggers" },
  { id: "outfit-bikini",           label: "Bikini",           dimension: "outfit", description: "Two-piece swimsuit",                promptHint: "in a two-piece bikini" },
  { id: "outfit-one-piece-swim",   label: "One-Piece Swimsuit", dimension: "outfit", description: "Fitted one-piece swimsuit",       promptHint: "in a fitted one-piece swimsuit" },
  { id: "outfit-lingerie",         label: "Lingerie Set",     dimension: "outfit", description: "Matching lingerie set",             promptHint: "in a matching lingerie set" },
  { id: "outfit-pajamas",          label: "Pajamas",          dimension: "outfit", description: "Soft cotton pajama set",            promptHint: "in a soft cotton pajama set — a button-up top and matching pants" },
  { id: "outfit-bathrobe",         label: "Bathrobe",         dimension: "outfit", description: "Plush terrycloth robe",             promptHint: "wrapped in a plush terrycloth bathrobe tied at the waist" },
  { id: "outfit-kimono",           label: "Kimono",           dimension: "outfit", description: "Traditional Japanese kimono",       promptHint: "dressed in a traditional Japanese kimono with an obi sash" },
  { id: "outfit-ballerina",        label: "Ballerina",        dimension: "outfit", description: "Classical ballerina costume",       promptHint: "dressed in a classical ballerina costume — fitted leotard and tulle tutu" },
  { id: "outfit-flapper",          label: "1920s Flapper",    dimension: "outfit", description: "Beaded flapper dress",              promptHint: "dressed in a 1920s flapper dress — beaded fringe and a low-drop hem" },

  // -------------------- Top (upper-body garment) --------------------
  { id: "top-tshirt",        label: "T-Shirt",        dimension: "top", description: "Plain crewneck t-shirt",         promptHint: "wearing a fitted plain crewneck t-shirt with short sleeves" },
  { id: "top-tank",          label: "Tank Top",       dimension: "top", description: "Scoop-neck tank top",            promptHint: "wearing a fitted scoop-neck tank top with thin shoulder straps" },
  { id: "top-crop-top",      label: "Crop Top",       dimension: "top", description: "Cropped above the midriff",     promptHint: "wearing a cropped top that ends above the midriff" },
  { id: "top-hoodie",        label: "Hoodie",         dimension: "top", description: "Pullover hoodie",                promptHint: "wearing a relaxed pullover hoodie with a kangaroo pocket" },
  { id: "top-sweater",       label: "Sweater",        dimension: "top", description: "Knit pullover sweater",          promptHint: "wearing a soft knit pullover sweater with a relaxed fit" },
  { id: "top-turtleneck",    label: "Turtleneck",     dimension: "top", description: "High-neck turtleneck",           promptHint: "wearing a fitted turtleneck sweater with a high rolled neckline" },
  { id: "top-blouse",        label: "Blouse",         dimension: "top", description: "Flowing dressy blouse",          promptHint: "wearing a flowing blouse with a soft drape and a tied neckline" },
  { id: "top-button-down",   label: "Button-Down",    dimension: "top", description: "Tailored button-down shirt",     promptHint: "wearing a tailored button-down shirt with a sharp pointed collar" },
  { id: "top-polo",          label: "Polo Shirt",     dimension: "top", description: "Short-sleeve polo",              promptHint: "wearing a fitted polo shirt with a small ribbed collar and short sleeves" },
  { id: "top-tube-top",      label: "Tube Top",       dimension: "top", description: "Strapless tube top",             promptHint: "wearing a strapless tube top fitted across the chest" },
  { id: "top-camisole",      label: "Camisole",       dimension: "top", description: "Thin satin cami",                promptHint: "wearing a thin satin camisole with delicate spaghetti straps" },
  { id: "top-corset",        label: "Corset",         dimension: "top", description: "Structured corset top",          promptHint: "wearing a structured corset top with boning and visible lacing" },
  { id: "top-bra-top",       label: "Bra Top",        dimension: "top", description: "Bra-style top showing midriff", promptHint: "wearing a fitted bra-style top with the midriff exposed" },
  { id: "top-sports-bra",    label: "Sports Bra",     dimension: "top", description: "Athletic sports bra",            promptHint: "wearing a structured sports bra with athletic strapping" },
  { id: "top-bikini-top",    label: "Bikini Top",     dimension: "top", description: "Triangle bikini top",            promptHint: "wearing a triangle bikini top tied behind the neck and back" },

  // -------------------- Bottom (lower-body garment) --------------------
  { id: "bottom-jeans",         label: "Jeans",            dimension: "bottom", description: "Classic blue jeans",       promptHint: "in classic five-pocket blue jeans with a straight leg cut" },
  { id: "bottom-skinny-jeans",  label: "Skinny Jeans",     dimension: "bottom", description: "Skinny-cut jeans",         promptHint: "in skinny-cut jeans hugging the legs from hip to ankle" },
  { id: "bottom-wide-leg-jeans", label: "Wide-Leg Jeans",  dimension: "bottom", description: "Wide-leg loose jeans",     promptHint: "in wide-leg jeans with a loose relaxed silhouette flaring slightly at the hem" },
  { id: "bottom-mom-jeans",     label: "Mom Jeans",        dimension: "bottom", description: "High-waist mom jeans",     promptHint: "in high-waisted mom jeans with a relaxed straight-leg fit" },
  { id: "bottom-low-rise-jeans", label: "Low-Rise Jeans",  dimension: "bottom", description: "Low-rise jeans",           promptHint: "in low-rise jeans sitting well below the natural waist" },
  { id: "bottom-chinos",        label: "Chinos",           dimension: "bottom", description: "Tailored chino pants",     promptHint: "in tailored chinos with a clean smooth weave and a slim straight leg" },
  { id: "bottom-trousers",      label: "Dress Trousers",   dimension: "bottom", description: "Pressed dress trousers",   promptHint: "in pressed dress trousers with a clean break at the ankle" },
  { id: "bottom-cargo",         label: "Cargo Pants",      dimension: "bottom", description: "Cargo pants with side pockets", promptHint: "in loose cargo pants with utility side pockets and a relaxed leg" },
  { id: "bottom-leggings",      label: "Leggings",         dimension: "bottom", description: "Fitted leggings",          promptHint: "in fitted stretch leggings hugging the legs" },
  { id: "bottom-sweatpants",    label: "Sweatpants",       dimension: "bottom", description: "Relaxed sweatpants",       promptHint: "in relaxed jogger-cut sweatpants gathered at the ankle" },
  { id: "bottom-shorts",        label: "Shorts",           dimension: "bottom", description: "Mid-thigh shorts",         promptHint: "in casual mid-thigh shorts" },
  { id: "bottom-denim-shorts",  label: "Denim Shorts",     dimension: "bottom", description: "Cut-off denim shorts",     promptHint: "in cuffed denim cut-off shorts" },
  { id: "bottom-mini-skirt",    label: "Mini Skirt",       dimension: "bottom", description: "Above-the-knee mini skirt", promptHint: "in a short mini skirt cut well above the knee" },
  { id: "bottom-pleated-skirt", label: "Pleated Skirt",    dimension: "bottom", description: "Pleated mid-thigh skirt",  promptHint: "in a pleated mid-thigh skirt with sharp folds" },
  { id: "bottom-midi-skirt",    label: "Midi Skirt",       dimension: "bottom", description: "Calf-length midi skirt",   promptHint: "in a calf-length midi skirt with a flowing hem" },
  { id: "bottom-maxi-skirt",    label: "Maxi Skirt",       dimension: "bottom", description: "Floor-length maxi skirt",  promptHint: "in a floor-length maxi skirt with a fluid drape" },

  // -------------------- Outerwear (layered-over outer garment) --------------------
  { id: "outerwear-leather-jacket", label: "Leather Jacket",  dimension: "outerwear", description: "Slim-fit leather jacket",    promptHint: "wearing a slim-fit black leather jacket with a fitted collar and zip front" },
  { id: "outerwear-denim-jacket",   label: "Denim Jacket",    dimension: "outerwear", description: "Classic denim jacket",       promptHint: "wearing a classic blue denim jacket with chest pockets and metal buttons" },
  { id: "outerwear-bomber",         label: "Bomber Jacket",   dimension: "outerwear", description: "Satin bomber jacket",        promptHint: "wearing a satin bomber jacket with ribbed cuffs and hem" },
  { id: "outerwear-blazer",         label: "Blazer",          dimension: "outerwear", description: "Tailored blazer",            promptHint: "wearing a tailored single-breasted blazer with notched lapels" },
  { id: "outerwear-trench",         label: "Trench Coat",     dimension: "outerwear", description: "Belted trench coat",         promptHint: "wearing a belted beige trench coat falling to the knees" },
  { id: "outerwear-overcoat",       label: "Wool Overcoat",   dimension: "outerwear", description: "Long wool overcoat",         promptHint: "wearing a long wool overcoat with broad notched lapels" },
  { id: "outerwear-puffer",         label: "Puffer Jacket",   dimension: "outerwear", description: "Quilted puffer jacket",      promptHint: "wearing a quilted puffer jacket with horizontal baffles and a stand-up collar" },
  { id: "outerwear-parka",          label: "Parka",           dimension: "outerwear", description: "Hooded fur-trim parka",      promptHint: "wearing a hooded fur-trim parka with a heavy quilted lining" },
  { id: "outerwear-cardigan",       label: "Cardigan",        dimension: "outerwear", description: "Open-front knit cardigan",   promptHint: "wearing an open-front knit cardigan with a relaxed drape" },
  { id: "outerwear-vest",           label: "Vest",            dimension: "outerwear", description: "Tailored vest",              promptHint: "wearing an unbuttoned tailored vest layered over the shirt" },
  { id: "outerwear-kimono-robe",    label: "Kimono Robe",     dimension: "outerwear", description: "Flowing kimono robe",        promptHint: "wearing a flowing silk kimono robe tied with a sash" },
  { id: "outerwear-varsity",        label: "Varsity Jacket",  dimension: "outerwear", description: "Letterman varsity jacket",   promptHint: "wearing a classic letterman varsity jacket with leather sleeves and a chenille patch" },
  { id: "outerwear-fur-coat",       label: "Fur Coat",        dimension: "outerwear", description: "Plush fur coat",             promptHint: "wearing a plush fur coat with a deep textured pile" },

  // -------------------- Legwear (between bottom and footwear) --------------------
  { id: "legwear-bare",             label: "Bare Legs",        dimension: "legwear", description: "Bare legs, no hosiery",      promptHint: "with bare legs, no hosiery" },
  { id: "legwear-sheer-tights",     label: "Sheer Tights",     dimension: "legwear", description: "Sheer nude pantyhose",       promptHint: "with sheer nude pantyhose" },
  { id: "legwear-opaque-tights",    label: "Opaque Tights",    dimension: "legwear", description: "Solid opaque tights",        promptHint: "with opaque black tights covering the legs" },
  { id: "legwear-fishnets",         label: "Fishnets",         dimension: "legwear", description: "Diamond-mesh fishnets",      promptHint: "with fishnet stockings, the skin showing through the diamond mesh" },
  { id: "legwear-thigh-highs",      label: "Thigh-High Stockings", dimension: "legwear", description: "Thigh-high stockings",   promptHint: "with thigh-high stockings stopping mid-thigh" },
  { id: "legwear-lace-top-stockings", label: "Lace-Top Stockings", dimension: "legwear", description: "Lace-banded thigh-highs", promptHint: "with lace-topped thigh-high stockings cinched mid-thigh" },
  { id: "legwear-knee-highs",       label: "Knee-High Socks",  dimension: "legwear", description: "Knee-high socks",            promptHint: "with knee-high socks pulled up the calf" },
  { id: "legwear-crew-socks",       label: "Crew Socks",       dimension: "legwear", description: "Mid-calf crew socks",        promptHint: "with simple crew socks visible above the shoes" },
  { id: "legwear-ankle-socks",      label: "Ankle Socks",      dimension: "legwear", description: "Low-cut ankle socks",        promptHint: "with low-cut ankle socks barely showing above the shoes" },
  { id: "legwear-leg-warmers",      label: "Leg Warmers",      dimension: "legwear", description: "Knit leg warmers",           promptHint: "with bunched knit leg warmers stacked over the calves" },

  // -------------------- Footwear (shoes) --------------------
  { id: "footwear-sneakers",        label: "Sneakers",         dimension: "footwear", description: "Low-top sneakers",         promptHint: "in clean white low-top sneakers" },
  { id: "footwear-high-tops",       label: "High-Top Sneakers", dimension: "footwear", description: "High-top canvas sneakers", promptHint: "in high-top canvas sneakers" },
  { id: "footwear-running-shoes",   label: "Running Shoes",    dimension: "footwear", description: "Athletic running shoes",   promptHint: "in technical running shoes with a chunky cushioned sole" },
  { id: "footwear-stilettos",       label: "Stiletto Heels",   dimension: "footwear", description: "Pointed stiletto heels",   promptHint: "in pointed-toe stiletto heels" },
  { id: "footwear-block-heels",     label: "Block Heels",      dimension: "footwear", description: "Chunky block-heel pumps",  promptHint: "in chunky block-heel pumps" },
  { id: "footwear-platforms",       label: "Platform Shoes",   dimension: "footwear", description: "Tall platform soles",      promptHint: "in platform shoes with thick chunky soles" },
  { id: "footwear-ankle-boots",     label: "Ankle Boots",      dimension: "footwear", description: "Fitted ankle boots",       promptHint: "in fitted black ankle boots" },
  { id: "footwear-knee-boots",      label: "Knee-High Boots",  dimension: "footwear", description: "Tall knee-high boots",     promptHint: "in tall knee-high leather boots" },
  { id: "footwear-thigh-high-boots", label: "Thigh-High Boots", dimension: "footwear", description: "Thigh-high boots",        promptHint: "in over-the-knee thigh-high leather boots" },
  { id: "footwear-combat-boots",    label: "Combat Boots",     dimension: "footwear", description: "Laced combat boots",       promptHint: "in laced black combat boots with a chunky lugged sole" },
  { id: "footwear-chelsea-boots",   label: "Chelsea Boots",    dimension: "footwear", description: "Slip-on Chelsea boots",    promptHint: "in clean Chelsea boots with elastic side panels" },
  { id: "footwear-cowboy-boots",    label: "Cowboy Boots",     dimension: "footwear", description: "Pointed-toe cowboy boots", promptHint: "in pointed-toe cowboy boots with a stacked heel and decorative stitching" },
  { id: "footwear-loafers",         label: "Loafers",          dimension: "footwear", description: "Polished penny loafers",   promptHint: "in polished leather penny loafers" },
  { id: "footwear-oxfords",         label: "Oxfords",          dimension: "footwear", description: "Laced leather oxfords",    promptHint: "in laced leather oxford shoes with a polished finish" },
  { id: "footwear-sandals",         label: "Sandals",          dimension: "footwear", description: "Flat strappy sandals",     promptHint: "in flat strappy sandals" },
  { id: "footwear-mules",           label: "Mules",            dimension: "footwear", description: "Backless slip-on mules",   promptHint: "in slip-on backless mules" },
  { id: "footwear-flip-flops",      label: "Flip-Flops",       dimension: "footwear", description: "Casual rubber flip-flops", promptHint: "in casual rubber flip-flops" },
  { id: "footwear-ballet-flats",    label: "Ballet Flats",     dimension: "footwear", description: "Slip-on ballet flats",     promptHint: "in slip-on ballet flats with a soft rounded toe" },
  { id: "footwear-barefoot",        label: "Barefoot",         dimension: "footwear", description: "No shoes — barefoot",      promptHint: "barefoot, no shoes" },

  // -------------------- Wardrobe State (modifier — composes with any garment) --------------------
  { id: "state-oversized",     label: "Oversized",       dimension: "wardrobe-state", description: "Loose, oversized fit",      promptHint: "the clothing loose and oversized, draping freely well past the body" },
  { id: "state-fitted",        label: "Fitted",          dimension: "wardrobe-state", description: "Form-fitting silhouette",   promptHint: "the clothing fitted and form-conscious, hugging the contours of the body" },
  { id: "state-cropped",       label: "Cropped",         dimension: "wardrobe-state", description: "Top cropped at midriff",    promptHint: "the top cropped above the midriff with the stomach visible" },
  { id: "state-sheer",         label: "Sheer",           dimension: "wardrobe-state", description: "Translucent fabric",        promptHint: "the fabric translucent and sheer, hinting at the silhouette underneath" },
  { id: "state-wet",           label: "Wet",             dimension: "wardrobe-state", description: "Soaked, water-clinging",    promptHint: "the clothing soaked and wet, the fabric clinging to the body and dripping water" },
  { id: "state-ripped",        label: "Ripped",          dimension: "wardrobe-state", description: "Torn and frayed",           promptHint: "the fabric torn and ripped at the seams, with frayed edges" },
  { id: "state-distressed",    label: "Distressed",      dimension: "wardrobe-state", description: "Worn, faded, weathered",    promptHint: "the clothing distressed and weathered, with faded color and worn-down edges" },
  { id: "state-vintage",       label: "Vintage",         dimension: "wardrobe-state", description: "Worn, retro character",     promptHint: "the clothing carrying vintage character — softened color, broken-in fit, retro silhouette" },
  { id: "state-tucked-in",     label: "Tucked In",       dimension: "wardrobe-state", description: "Top tucked into bottom",    promptHint: "the top neatly tucked into the bottom" },
  { id: "state-half-tucked",   label: "Half-Tucked",     dimension: "wardrobe-state", description: "Front-tucked, back loose",  promptHint: "the top half-tucked — front neatly tucked in, back hanging loose" },
  { id: "state-off-shoulder",  label: "Off-Shoulder",    dimension: "wardrobe-state", description: "Slipped off one shoulder",  promptHint: "the top slipped off one shoulder, baring the skin and collarbone" },
  { id: "state-unbuttoned",    label: "Unbuttoned",      dimension: "wardrobe-state", description: "Open / unbuttoned",         promptHint: "the outerwear hanging open and unbuttoned, falling loose at the sides" },
  { id: "state-rolled-sleeves", label: "Rolled Sleeves", dimension: "wardrobe-state", description: "Sleeves rolled up forearm", promptHint: "the sleeves rolled up to the forearm" },
  { id: "state-layered",       label: "Layered",         dimension: "wardrobe-state", description: "Multiple stacked layers",   promptHint: "the outfit composed of multiple stacked layers, each piece visible at the edges" },
] as const

export const STYLING_DIMENSION_ORDER: ReadonlyArray<StylingDimension> = [
  // Beauty / hair / accessories
  "makeup",
  "hair-cut",
  "hair-treatment",
  "hair-state",
  "eyewear",
  "headwear",
  "jewelry",
  "nails",
  "face-paint",
  // Wardrobe (head-to-toe). Outfit comes first as a "complete look" override
  // semantically supersedes individual pieces.
  "outfit",
  "top",
  "bottom",
  "outerwear",
  "legwear",
  "footwear",
  // Modifiers — fabric and state apply to whatever garment(s) above.
  "fabric",
  "wardrobe-state",
]

export const STYLING_DIMENSION_LABELS: Readonly<Record<StylingDimension, string>> = {
  makeup: "Makeup",
  eyewear: "Eyewear",
  headwear: "Headwear",
  "hair-cut": "Hair Cut / Style",
  "hair-treatment": "Hair Treatment",
  "hair-state": "Hair State",
  jewelry: "Jewelry",
  nails: "Nails",
  "face-paint": "Face Paint",
  outfit: "Outfit",
  top: "Top",
  bottom: "Bottom",
  outerwear: "Outerwear",
  legwear: "Legwear",
  footwear: "Footwear",
  fabric: "Fabric",
  "wardrobe-state": "Wardrobe State",
}

export const STYLING_FIELD_BY_DIMENSION: Record<
  StylingDimension,
  | "makeup"
  | "eyewear"
  | "headwear"
  | "hairCut"
  | "hairTreatment"
  | "hairState"
  | "jewelry"
  | "nails"
  | "facePaint"
  | "outfit"
  | "top"
  | "bottom"
  | "outerwear"
  | "legwear"
  | "footwear"
  | "fabric"
  | "wardrobeState"
> = {
  makeup: "makeup",
  eyewear: "eyewear",
  headwear: "headwear",
  "hair-cut": "hairCut",
  "hair-treatment": "hairTreatment",
  "hair-state": "hairState",
  jewelry: "jewelry",
  nails: "nails",
  "face-paint": "facePaint",
  outfit: "outfit",
  top: "top",
  bottom: "bottom",
  outerwear: "outerwear",
  legwear: "legwear",
  footwear: "footwear",
  fabric: "fabric",
  "wardrobe-state": "wardrobeState",
}

export interface StylingValue {
  makeup?: string
  eyewear?: string
  headwear?: string
  /** Hair cut / styling choice — bob, wolf cut, braids, ponytail, etc.
   *  Pairs with Person.hair-base (texture + length). */
  hairCut?: string
  hairTreatment?: string
  /** Hair state / motion / condition — wet, messy, windswept, voluminous,
   *  sleek, frizzy, tousled, flowing… Distinct from cut (shape) and
   *  treatment (color processing). Single id or up to 2 (e.g.
   *  ["wet", "windswept"], ["messy", "voluminous"]). */
  hairState?: string | ReadonlyArray<string>
  /** Jewelry. Single id or up to 3 ids for stacked jewelry
   *  (e.g. necklace + earrings + rings). */
  jewelry?: string | ReadonlyArray<string>
  nails?: string
  facePaint?: string
  /** Single-pick complete outfit archetype (school uniform, business suit,
   *  evening gown, scrubs, bikini, lingerie, kimono…). Intended as an override
   *  that semantically supersedes the per-piece selections. */
  outfit?: string
  /** Upper-body garment (t-shirt, sweater, blouse, sports bra, bikini top…). */
  top?: string
  /** Lower-body garment (jeans, chinos, skirt, shorts, leggings…). */
  bottom?: string
  /** Layered-over outer garment (jacket, blazer, coat, cardigan…). */
  outerwear?: string
  /** Legwear worn between bottom and footwear (tights, fishnets, stockings, socks…). */
  legwear?: string
  /** Shoes (sneakers, heels, boots, loafers, sandals…). */
  footwear?: string
  /** Clothing fabric / material — silk, leather, denim, etc. Phrased as
   *  "wearing X"; overlaps in vocabulary with the universal Material node
   *  in the Object category. */
  fabric?: string
  /** How the clothes are worn — oversized, fitted, cropped, sheer, wet,
   *  ripped, off-shoulder, tucked-in, layered, unbuttoned… Composes with
   *  any garment selection. Single id or up to 3 ids for stacked
   *  modifiers (e.g. ["oversized", "wet", "ripped"]). */
  wardrobeState?: string | ReadonlyArray<string>
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
    const raw = data[field]
    // jewelry / wardrobe-state / hair-state are multi-pick (string | string[]);
    // emit each id's hint independently and let the comma-join compose.
    if (typeof raw === "string" && raw.length > 0) {
      const hint = getStylingPromptHint(raw)
      if (hint) hints.push(hint)
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item !== "string" || item.length === 0) continue
        const hint = getStylingPromptHint(item)
        if (hint) hints.push(hint)
      }
    }
  }

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) hints.push(post)

  return hints
}
