/**
 * Canonical catalog of Aesthetic / Microtrend choices.
 *
 * Single-pick parameter node — user picks ONE microtrend bundle that
 * captures wardrobe + setting + grade + mood in a single descriptor.
 * Microtrends are dense, model-recognised tokens (Y2K, dark academia,
 * cottagecore, gorpcore...) that pull a coherent visual world along with
 * the name. Each promptHint expands the slang into the specific wardrobe
 * cues, environment cues and color treatment that define the look.
 *
 * Categories:
 *   - mainstream: high-recognition microtrends with a stable visual signature
 *   - niche: smaller -core / -kei / -punk movements
 *   - era: fashion eras / sensibilities (minimalism, maximalism, glam)
 *   - mood: cultural mood-bundles (effortless cool, main-character energy)
 *
 * Shared between the picker UI, the standalone Aesthetic parameter node,
 * and the prompt-hint injection on both the frontend DAG executor and the
 * backend orchestrator.
 */

export type AestheticCategory = "mainstream" | "niche" | "era" | "mood"

export interface Aesthetic {
  readonly id: string
  readonly label: string
  readonly category: AestheticCategory
  readonly description: string
  readonly promptHint: string
}

export const AESTHETICS: ReadonlyArray<Aesthetic> = [
  // -------------------- Mainstream microtrends --------------------
  {
    id: "y2k",
    label: "Y2K",
    category: "mainstream",
    description: "Late-90s / early-2000s pop tech",
    promptHint:
      "in the Y2K aesthetic — low-rise denim, baby tees, butterfly clips and chrome accessories, lit with sharp digicam flash and a faint chromatic gloss",
  },
  {
    id: "cottagecore",
    label: "Cottagecore",
    category: "mainstream",
    description: "Pastoral, hand-baked countryside",
    promptHint:
      "in the cottagecore aesthetic — linen dresses, gingham aprons and woven baskets in a sun-dappled cottage garden, with warm honeyed grading and gentle film grain",
  },
  {
    id: "dark-academia",
    label: "Dark Academia",
    category: "mainstream",
    description: "Old-world scholarship and tweed",
    promptHint:
      "in the dark academia aesthetic — tweed blazers, oxford shirts and stacks of leather-bound books in candlelit libraries, with a desaturated golden-shadow grade",
  },
  {
    id: "light-academia",
    label: "Light Academia",
    category: "mainstream",
    description: "Sunlit ivy-league scholarship",
    promptHint:
      "in the light academia aesthetic — cream cardigans, pleated skirts and open journals on sunlit terraces, with warm cream-and-honey color and softly washed highlights",
  },
  {
    id: "techwear",
    label: "Techwear / Gorpcore",
    category: "mainstream",
    description: "Tactical urban performance gear",
    promptHint:
      "in the techwear-gorpcore aesthetic — black tactical shells, MOLLE webbing, cargo pants and chunky trail runners in a rain-slick neon city, with cold cyan-magenta color",
  },
  {
    id: "old-money",
    label: "Old Money / Preppy",
    category: "mainstream",
    description: "Quiet-luxury heritage prep",
    promptHint:
      "in the old-money preppy aesthetic — cashmere sweaters, polo shirts, pearl strands and tailored linen on yacht decks and clay courts, with crisp, sun-bleached Mediterranean color",
  },
  {
    id: "streetwear",
    label: "Streetwear",
    category: "mainstream",
    description: "Sneaker-and-hoodie urban casual",
    promptHint:
      "in the streetwear aesthetic — graphic hoodies, oversized tees, premium sneakers and beanies on graffitied urban backdrops, with punchy contemporary color",
  },
  {
    id: "coquette",
    label: "Coquette",
    category: "mainstream",
    description: "Bows, lace and balletcore softness",
    promptHint:
      "in the coquette aesthetic — pink ribbons, lace trims, pearls and ballet flats in soft vanilla bedrooms, with rosy-pink grading and warm soft-focus glow",
  },
  {
    id: "fairycore",
    label: "Fairycore",
    category: "mainstream",
    description: "Mossy, mushroom-strewn enchantment",
    promptHint:
      "in the fairycore aesthetic — flowing tulle, flower crowns and embroidered shawls in mossy enchanted forests, with iridescent dappled light and pastel-green color",
  },
  {
    id: "goblincore",
    label: "Goblincore",
    category: "mainstream",
    description: "Mossy, mud-loving wilderness joy",
    promptHint:
      "in the goblincore aesthetic — earth-toned knits, muddy boots and pockets full of mushrooms and beetles in damp forest undergrowth, with rich green-brown grading",
  },
  {
    id: "normcore",
    label: "Normcore",
    category: "mainstream",
    description: "Anti-fashion plain basics",
    promptHint:
      "in the normcore aesthetic — plain jeans, white sneakers, gray sweatshirts and bucket hats against banal everyday backdrops, with flat neutral color and even daylight",
  },
  {
    id: "balletcore",
    label: "Balletcore",
    category: "mainstream",
    description: "Soft pink ballet-rehearsal grace",
    promptHint:
      "in the balletcore aesthetic — leg warmers, wrap cardigans, ribboned flats and tulle skirts in dust-floating studios, with soft pink-cream color and warm window light",
  },
  {
    id: "e-girl",
    label: "E-Girl",
    category: "mainstream",
    description: "Webcore liner-and-blush internet",
    promptHint:
      "in the e-girl aesthetic — heart blush, winged liner, dyed split hair, plaid skirts and chain necklaces in bedroom LED light, with cool magenta-cyan color",
  },
  {
    id: "soft-girl",
    label: "Soft Girl",
    category: "mainstream",
    description: "Pastel, sticker-bright sweetness",
    promptHint:
      "in the soft-girl aesthetic — pastel hoodies, butterfly clips, glossy lip and dainty heart stickers in cotton-candy-toned rooms, with warm peachy grading",
  },
  {
    id: "indie-sleaze",
    label: "Indie Sleaze",
    category: "mainstream",
    description: "Tumblr-era flash-blown party",
    promptHint:
      "in the indie sleaze aesthetic — smudged eyeliner, leather jackets and skinny jeans at smoky house parties, lit by harsh on-camera flash with deep blacks and noisy grain",
  },

  // -------------------- Niche -core / -kei / -punk --------------------
  {
    id: "vacation-dadcore",
    label: "Vacation Dadcore",
    category: "niche",
    description: "Hawaiian-shirt suburban-dad ease",
    promptHint:
      "in the vacation-dadcore aesthetic — Hawaiian shirts, cargo shorts, white socks and visor caps on cul-de-sac driveways, with bright tourist-snapshot color",
  },
  {
    id: "womancore",
    label: "Womancore",
    category: "niche",
    description: "Confident, unfussy adult femininity",
    promptHint:
      "in the womancore aesthetic — tailored slacks, silk blouses and minimal jewelry in airy modern apartments, with soft natural light and a subdued elegant palette",
  },
  {
    id: "angelcore",
    label: "Angelcore",
    category: "niche",
    description: "Cherubic, lace-and-feather softness",
    promptHint:
      "in the angelcore aesthetic — flowing white lace, lace gloves, halo headbands and feathered wings against pale heaven-soft backdrops, with creamy pastel grading",
  },
  {
    id: "hikecore",
    label: "Hikecore",
    category: "niche",
    description: "Trail-day mountaineer chic",
    promptHint:
      "in the hikecore aesthetic — fleece pullovers, hiking boots, retro daypacks and topo-print baselayers on alpine trails, with crisp mountain color and high-altitude clarity",
  },
  {
    id: "mote-kei",
    label: "Mote-Kei",
    category: "niche",
    description: "Conservative-cute Japanese feminine",
    promptHint:
      "in the mote-kei aesthetic — pleated A-line skirts, soft knits, neat ribbons and pastel cardigans in sun-flooded Tokyo cafes, with delicate creamy color",
  },
  {
    id: "kombuchapunk",
    label: "Kombuchapunk",
    category: "niche",
    description: "Fermenting wellness counter-culture",
    promptHint:
      "in the kombuchapunk aesthetic — thrifted graphic tees, layered hemp, tarot decks and home-fermented jars in plant-cluttered shared kitchens, with warm earthy color",
  },
  {
    id: "chinapunk",
    label: "Chinapunk",
    category: "niche",
    description: "Y2K Hong Kong cyber glam",
    promptHint:
      "in the chinapunk aesthetic — qipao-cut crop tops, mesh sleeves, futuristic shades and chrome charms on neon Hong Kong streets, with electric magenta-cyan grading",
  },
  {
    id: "karencore",
    label: "Karencore",
    category: "niche",
    description: "Suburban-Karen blunt-bob power",
    promptHint:
      "in the karencore aesthetic — bobbed blonde hair, oversized sunglasses, cropped capris and white SUVs in sun-baked suburban parking lots, with bleached overexposed color",
  },
  {
    id: "candycore",
    label: "Candycore",
    category: "niche",
    description: "Sugar-rush rainbow saturation",
    promptHint:
      "in the candycore aesthetic — rainbow stripes, lollipop accessories, glittery eye shadow and platform sneakers in candy-bright sets, with maximum saturation",
  },
  {
    id: "babycore",
    label: "Babycore",
    category: "niche",
    description: "Pacifier-soft infantile pastel",
    promptHint:
      "in the babycore aesthetic — bonnets, ruffled rompers, oversized bows and stuffed animals against nursery-pastel backdrops, with milky soft-pink color",
  },
  {
    id: "catcore",
    label: "Catcore",
    category: "niche",
    description: "Cat-eared cozy domestic",
    promptHint:
      "in the catcore aesthetic — cat-ear hoodies, paw mittens, knitted cardigans and tabby-print scarves curled up by sun-warmed windows, with soft golden color",
  },

  // -------------------- Fashion eras --------------------
  {
    id: "minimalism",
    label: "Minimalism",
    category: "era",
    description: "Pared-down quiet-luxury restraint",
    promptHint:
      "in the minimalist aesthetic — clean monochrome tailoring, structured silhouettes and empty white-stone spaces, with restrained neutral color and even soft light",
  },
  {
    id: "maximalism",
    label: "Maximalism",
    category: "era",
    description: "More-is-more clashing pattern",
    promptHint:
      "in the maximalist aesthetic — clashing prints, layered jewelry, velvet, sequins and floral wallpaper in densely styled rooms, with rich saturated color",
  },
  {
    id: "avant-garde",
    label: "Avant-Garde",
    category: "era",
    description: "Conceptual sculptural fashion",
    promptHint:
      "in the avant-garde aesthetic — sculptural deconstructed silhouettes, exaggerated proportions and architectural draping in stark gallery-white spaces, with cold minimal color",
  },
  {
    id: "old-hollywood-glam",
    label: "Old Hollywood Glam",
    category: "era",
    description: "Silver-screen 1940s glamour",
    promptHint:
      "in the old-Hollywood-glam aesthetic — satin gowns, fur stoles, finger waves and red lipstick under sculpted studio key light, with silvery monochrome and high-contrast tonality",
  },

  // -------------------- Mood bundles --------------------
  {
    id: "main-character-energy",
    label: "Main Character Energy",
    category: "mood",
    description: "Unbothered cinematic confidence",
    promptHint:
      "with main-character energy — unbothered confident posture, signature outfit and direct gaze, framed cinematically with shallow depth of field and warm filmic grading",
  },
  {
    id: "soft-easygoing",
    label: "Soft / Easygoing",
    category: "mood",
    description: "Gentle, low-effort warm calm",
    promptHint:
      "in a soft easygoing mood — relaxed knits, oversized layers and easy posture in softly lit rooms, with hazy natural light and creamy gentle color",
  },
  {
    id: "casual-lived-in",
    label: "Casual / Lived-In",
    category: "mood",
    description: "Worn-in, unstyled everyday",
    promptHint:
      "in a casual lived-in mood — worn jeans, faded tees and rumpled hair in everyday domestic settings, with flat naturalistic light and unpolished snapshot color",
  },
  {
    id: "effortless-cool",
    label: "Effortless Cool",
    category: "mood",
    description: "Unstudied off-duty French-girl ease",
    promptHint:
      "in an effortless-cool mood — slouchy knits, slip skirts, messy bangs and minimal makeup on cobbled European streets, with gentle desaturated film color",
  },
  {
    id: "retro-90s",
    label: "Retro 90s",
    category: "mood",
    description: "Throwback grunge-meets-mall 90s",
    promptHint:
      "in a retro 90s mood — flannel shirts, slip dresses, chokers and platform boots in mall food courts and bedroom posters, with slight VHS-grain and warm Kodachrome color",
  },
] as const

const aestheticById = new Map<string, Aesthetic>(
  AESTHETICS.map((a) => [a.id, a]),
)

export function getAesthetic(id: string | undefined | null): Aesthetic | undefined {
  if (!id) return undefined
  return aestheticById.get(id)
}

export function getAestheticLabel(id: string | undefined | null, fallback?: string): string {
  const a = getAesthetic(id)
  if (a) return a.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getAestheticPromptHint(id: string | undefined | null): string {
  return getAesthetic(id)?.promptHint ?? ""
}

export const AESTHETIC_IDS: ReadonlyArray<string> = AESTHETICS.map((a) => a.id)

export const AESTHETIC_CATEGORY_LABELS: Readonly<Record<AestheticCategory, string>> = {
  mainstream: "Mainstream",
  niche: "Niche",
  era: "Fashion Era",
  mood: "Mood",
}

export const AESTHETIC_CATEGORY_ORDER: ReadonlyArray<AestheticCategory> = [
  "mainstream",
  "niche",
  "era",
  "mood",
]
