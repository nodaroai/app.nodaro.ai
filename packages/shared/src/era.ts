/**
 * Canonical catalog of Era / Period choices.
 *
 * Single-pick parameter node — user picks ONE historical era or speculative
 * period. Each promptHint bundles wardrobe + environment + photographic
 * treatment so the model gets a coherent world rather than a stray decade
 * label. Color, lighting, grain and signature props are all part of the
 * descriptor because period-piece looks live or die on those cues.
 *
 * Categories:
 *   - decade-20c: 20th-century decades from 1920s flapper to 2000s tabloid
 *   - pre-modern: pre-20th-century historical eras (medieval -> Edwardian)
 *   - speculative: future, retrofuture, post-apocalyptic, dieselpunk etc.
 *
 * Shared between the picker UI, the standalone Era parameter node, and the
 * prompt-hint injection on both the frontend DAG executor and the backend
 * orchestrator.
 */

export type EraCategory = "decade-20c" | "pre-modern" | "speculative"

export interface Era {
  readonly id: string
  readonly label: string
  readonly category: EraCategory
  readonly description: string
  readonly promptHint: string
}

export const ERAS: ReadonlyArray<Era> = [
  // -------------------- 20th-century decades --------------------
  {
    id: "1920s-flapper",
    label: "1920s Flapper",
    category: "decade-20c",
    description: "Jazz-age speakeasy glamour",
    promptHint:
      "set in the 1920s flapper era — beaded drop-waist dresses, finger waves, feathered headbands and long pearl ropes in smoky speakeasies, with sepia-toned silver-rich monochrome and soft halation",
  },
  {
    id: "1930s-art-deco",
    label: "1930s Art Deco",
    category: "decade-20c",
    description: "Streamlined deco glamour",
    promptHint:
      "set in the 1930s art-deco era — bias-cut satin gowns, wide pinstripe suits and chrome geometric interiors, with dramatic theatrical key light and a polished black-and-white tonality",
  },
  {
    id: "1940s-wartime",
    label: "1940s Wartime",
    category: "decade-20c",
    description: "Wartime utility and victory rolls",
    promptHint:
      "set in the 1940s wartime era — utility dresses, victory rolls, seamed stockings and military uniforms in train stations and home-front kitchens, with warm sepia tones and gentle film grain",
  },
  {
    id: "1950s-diner",
    label: "1950s Diner / Pin-up",
    category: "decade-20c",
    description: "Chrome diners and bouffant pin-ups",
    promptHint:
      "set in the 1950s diner pin-up era — full circle skirts, cropped denim, leather jackets and bouffant hair in chrome diners and drive-ins, with saturated Kodachrome reds and turquoise",
  },
  {
    id: "1960s-mod",
    label: "1960s Mod",
    category: "decade-20c",
    description: "Swinging-London mod graphic",
    promptHint:
      "set in the 1960s mod era — geometric A-line dresses, op-art prints, white go-go boots and graphic eyeliner on mini-skirted Carnaby Street, with crisp graphic color and bright daylight",
  },
  {
    id: "1970s-disco",
    label: "1970s Disco",
    category: "decade-20c",
    description: "Studio-54 mirror-ball glitter",
    promptHint:
      "set in the 1970s disco era — sequined jumpsuits, wide-collar shirts, flares and feathered hair in mirror-ball nightclubs, with hot strobe-saturated color and lens-flared neon",
  },
  {
    id: "1980s-neon",
    label: "1980s Neon",
    category: "decade-20c",
    description: "Power-suit MTV neon excess",
    promptHint:
      "set in the 1980s neon era — power-shoulder blazers, leg warmers, perms and bright neon eye shadow under hard pink-and-blue gels, with chromatic-aberration neon color and grain",
  },
  {
    id: "1990s-mall",
    label: "1990s Mall",
    category: "decade-20c",
    description: "Mall-rat grunge-and-pop nineties",
    promptHint:
      "set in the 1990s mall era — denim and crop tops, slip dresses, chokers and platform sneakers under fluorescent food-court lighting, with slight VHS-grain and a warm disposable-camera flash cast",
  },
  {
    id: "2000s-y2k",
    label: "2000s Tabloid / Y2K",
    category: "decade-20c",
    description: "Paparazzi-flash low-rise tabloid",
    promptHint:
      "set in the 2000s tabloid Y2K era — low-rise jeans, butterfly tops, trucker hats and chrome flip phones outside celebrity nightclubs, with harsh paparazzi flash, deep blacks and faint chromatic gloss",
  },

  // -------------------- Pre-modern --------------------
  {
    id: "medieval",
    label: "Medieval",
    category: "pre-modern",
    description: "Stone-castle European Middle Ages",
    promptHint:
      "set in the medieval era — heavy linen tunics, woolen cloaks, leather belts and chain-mail in candlelit stone halls and muddy villages, with smoky firelight color and earthen pigment",
  },
  {
    id: "renaissance",
    label: "Renaissance",
    category: "pre-modern",
    description: "Florentine velvet-and-fresco grandeur",
    promptHint:
      "set in the Renaissance era — velvet doublets, brocade gowns, pearl headdresses and fresco-painted halls, with chiaroscuro candle light and rich oil-painting color",
  },
  {
    id: "victorian",
    label: "Victorian",
    category: "pre-modern",
    description: "Gaslit corseted-and-lace 19th-century",
    promptHint:
      "set in the Victorian era — corseted bustled gowns, top hats, lace gloves and pocket watches on cobbled gaslit London streets, with sepia-toned monochrome and dense atmospheric fog",
  },
  {
    id: "edwardian",
    label: "Edwardian",
    category: "pre-modern",
    description: "Belle-epoque tea-garden refinement",
    promptHint:
      "set in the Edwardian era — high-collared tea dresses, parasols, three-piece suits and pocket squares in manicured tea gardens, with soft warm afternoon light and gentle pastel color",
  },
  {
    id: "wild-west",
    label: "Wild West",
    category: "pre-modern",
    description: "Sun-baked frontier-cowboy Americana",
    promptHint:
      "set in the Wild West era — leather dusters, wide-brim hats, prairie dresses and tin-stars on dusty saloon porches and red-rock canyons, with hot orange-and-teal grading and sun-bleached grain",
  },
  {
    id: "ancient-rome",
    label: "Ancient Rome",
    category: "pre-modern",
    description: "Marble-columned imperial Rome",
    promptHint:
      "set in ancient Rome — draped togas, leather sandals, gilded laurel wreaths and bronze armor among marble columns and frescoed villas, with warm Mediterranean sun and umber-and-ochre color",
  },
  {
    id: "ancient-egypt",
    label: "Ancient Egypt",
    category: "pre-modern",
    description: "Pharaonic gold-and-linen Nile",
    promptHint:
      "set in ancient Egypt — pleated linen kalasiris, gold collars, kohl eyeliner and uraeus crowns beside sandstone temples and Nile reeds, with hot sand-yellow color and crisp midday shadows",
  },
  {
    id: "feudal-japan",
    label: "Feudal Japan",
    category: "pre-modern",
    description: "Edo-period samurai-and-geisha",
    promptHint:
      "set in feudal Japan — layered kimono, wooden geta, samurai armor and paper lanterns in shoji-screened tea houses and snowy castle courtyards, with cool ink-wash color and quiet fog",
  },
  {
    id: "roaring-prewar",
    label: "Pre-War Roaring",
    category: "pre-modern",
    description: "Late-1910s art-nouveau cusp",
    promptHint:
      "set in the late-1910s pre-war era — art-nouveau drapery, chignon hair, lace collars and cane-and-cloak in gas-lit Paris cafes, with sepia-bronze monochrome and soft halation",
  },

  // -------------------- Speculative --------------------
  {
    id: "near-future",
    label: "Near-Future",
    category: "speculative",
    description: "Plausible 5-to-15-years-ahead",
    promptHint:
      "set in a plausible near-future — minimalist technical fabrics, slim AR earpieces and clean modular interiors with subtle ambient-screen glow, with cool desaturated color and crisp digital clarity",
  },
  {
    id: "far-future",
    label: "Far-Future",
    category: "speculative",
    description: "Centuries-ahead spacefaring",
    promptHint:
      "set in a far-future spacefaring era — sleek bodysuits, exo-skeletons and holographic visors in arcology corridors and starship bridges, with luminous bioplastic color and volumetric LED light",
  },
  {
    id: "dieselpunk",
    label: "Dieselpunk",
    category: "speculative",
    description: "1930s-40s industrial alt-history",
    promptHint:
      "set in a dieselpunk alt-history — riveted leather jackets, brass goggles, military trench coats and oil-stained mechanic boots in soot-blackened industrial cities, with smoky amber-grey color",
  },
  {
    id: "atompunk",
    label: "Atompunk",
    category: "speculative",
    description: "1950s-future space-age optimism",
    promptHint:
      "set in an atompunk 1950s-future — chrome-finned dresses, ray-gun props, mid-century furniture and tail-finned cars under candy-pastel skies, with clean Technicolor saturation",
  },
  {
    id: "cyberpunk-future",
    label: "Cyberpunk Future",
    category: "speculative",
    description: "Neon-megacity high-tech low-life",
    promptHint:
      "set in a cyberpunk future — chrome-trimmed jackets, holographic eyewear, mesh tops and cybernetic implants in neon mega-city alleys, with electric magenta-cyan color and rain-soaked reflections",
  },
  {
    id: "post-apocalyptic",
    label: "Post-Apocalyptic",
    category: "speculative",
    description: "Scavenger wasteland survival",
    promptHint:
      "set in a post-apocalyptic wasteland — patched leather, gas masks, scavenged armor and rust-stained scarves in ruined highways and broken cityscapes, with desaturated dust-orange color and gritty grain",
  },
  {
    id: "retrofuturism",
    label: "Retrofuturism",
    category: "speculative",
    description: "Yesterday's tomorrow nostalgia",
    promptHint:
      "set in a retrofuturist tomorrow — silver lame jumpsuits, bubble helmets, aerodynamic furniture and analog spaceport interiors, with optimistic Technicolor saturation and chrome-bright highlights",
  },
] as const

const eraById = new Map<string, Era>(ERAS.map((e) => [e.id, e]))

export function getEra(id: string | undefined | null): Era | undefined {
  if (!id) return undefined
  return eraById.get(id)
}

export function getEraLabel(id: string | undefined | null, fallback?: string): string {
  const e = getEra(id)
  if (e) return e.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getEraPromptHint(id: string | undefined | null): string {
  return getEra(id)?.promptHint ?? ""
}

export const ERA_IDS: ReadonlyArray<string> = ERAS.map((e) => e.id)

export const ERA_CATEGORY_LABELS: Readonly<Record<EraCategory, string>> = {
  "decade-20c": "20th-Century Decade",
  "pre-modern": "Pre-Modern",
  speculative: "Speculative",
}

export const ERA_CATEGORY_ORDER: ReadonlyArray<EraCategory> = [
  "decade-20c",
  "pre-modern",
  "speculative",
]
