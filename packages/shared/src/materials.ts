/**
 * Canonical catalog of material presets ("Material").
 *
 * Material dimension — *what something is made of*. Works universally across
 * subjects (clothing, skin, body) and objects (furniture, vehicles, props,
 * surfaces). The same catalog can describe a silk dress, a chrome sculpture of
 * a person, a leather pillow, or a plastic train.
 *
 * Grammar: every entry's `promptHint` begins with `"made of ..."` — this reads
 * correctly regardless of target ("a dress made of silk", "a human made of
 * glass", "a pillow made of leather", "a train made of plastic").
 *
 * For clothing-specific phrasing ("wearing silk"), see the `fabric` dimension
 * on the Styling node. There is intentional overlap in vocabulary (leather,
 * silk, velvet appear in both) — Material uses the universal `"made of"`
 * grammar, Fabric uses the wardrobe-native `"wearing"` grammar.
 *
 * Shared between the picker UI, the standalone Material parameter node, and
 * the prompt-hint injection on both the frontend DAG executor and the
 * backend orchestrator.
 */

export type MaterialCategory =
  | "fabric"
  | "metal"
  | "stone"
  | "wood"
  | "glass-ceramic"
  | "natural"
  | "exotic"

export interface Material {
  readonly id: string
  readonly label: string
  readonly category: MaterialCategory
  readonly description: string
  readonly promptHint: string
}

export const MATERIALS: ReadonlyArray<Material> = [
  // -------------------- Fabric --------------------
  { id: "silk",      label: "Silk",      category: "fabric", description: "Smooth glossy silk",         promptHint: "made of smooth glossy silk with a subtle natural sheen and delicate fluid drape" },
  { id: "cotton",    label: "Cotton",    category: "fabric", description: "Soft matte cotton",          promptHint: "made of soft matte cotton fabric with a natural woven texture and subtle wrinkles" },
  { id: "denim",     label: "Denim",     category: "fabric", description: "Heavy indigo denim",         promptHint: "made of heavy indigo denim with visible diagonal weave, worn edges and subtle fading" },
  { id: "leather",   label: "Leather",   category: "fabric", description: "Rich supple leather",        promptHint: "made of rich supple leather with a soft satin sheen, natural grain and warm brown tones" },
  { id: "velvet",    label: "Velvet",    category: "fabric", description: "Plush velvet",               promptHint: "made of plush velvet with a deep soft nap, rich saturated color and directional sheen" },
  { id: "satin",     label: "Satin",     category: "fabric", description: "Glossy satin",               promptHint: "made of glossy satin with a lustrous mirror-like surface and fluid draping folds" },
  { id: "lace",      label: "Lace",      category: "fabric", description: "Delicate patterned lace",    promptHint: "made of delicate patterned lace with intricate floral openwork and a fine translucent texture" },
  { id: "wool",      label: "Wool",      category: "fabric", description: "Warm woven wool",            promptHint: "made of warm woven wool with a soft matte surface, visible fibers and a cozy textured feel" },
  { id: "linen",     label: "Linen",     category: "fabric", description: "Natural textured linen",     promptHint: "made of natural linen with a loose open weave, slight slubs and a slightly wrinkled airy drape" },
  { id: "tweed",     label: "Tweed",     category: "fabric", description: "Rustic woven tweed",         promptHint: "made of rustic tweed with a flecked multi-color woven texture and a rough heritage feel" },
  { id: "cashmere",  label: "Cashmere",  category: "fabric", description: "Luxurious soft cashmere",    promptHint: "made of luxurious cashmere with an ultra-soft matte texture and a fine dense weave" },
  { id: "chiffon",   label: "Chiffon",   category: "fabric", description: "Sheer flowing chiffon",      promptHint: "made of sheer chiffon with a lightweight floating drape, soft translucent layers and a gentle shimmer" },
  { id: "fur",       label: "Fur",       category: "fabric", description: "Thick plush fur",            promptHint: "made of thick plush fur with long dense strands, natural variation and a soft directional flow" },

  // -------------------- Metal --------------------
  { id: "gold",      label: "Gold",      category: "metal",  description: "Polished gold",              promptHint: "made of polished gold with a warm yellow metallic sheen and rich mirror-like reflections" },
  { id: "silver",    label: "Silver",    category: "metal",  description: "Polished silver",            promptHint: "made of polished silver with a cool bright metallic sheen and clean mirror-like reflections" },
  { id: "bronze",    label: "Bronze",    category: "metal",  description: "Patinaed cast bronze",       promptHint: "made of cast bronze with a warm brown-gold metallic surface and a mottled greenish patina in the recesses" },
  { id: "chrome",    label: "Chrome",    category: "metal",  description: "Hyper-reflective chrome",    promptHint: "made of hyper-reflective polished chrome with liquid mirror surfaces and sharp environmental reflections" },
  { id: "copper",    label: "Copper",    category: "metal",  description: "Warm copper with patina",    promptHint: "made of warm copper with a rich rose-orange metallic gleam and touches of blue-green oxidation" },
  { id: "brass",     label: "Brass",     category: "metal",  description: "Antique brass",              promptHint: "made of antique brass with a warm yellow-gold hue, brushed texture and slight tarnish in the crevices" },
  { id: "steel",     label: "Steel",     category: "metal",  description: "Brushed stainless steel",    promptHint: "made of brushed stainless steel with fine directional grain and cool soft reflections" },
  { id: "iron",      label: "Iron",      category: "metal",  description: "Rough wrought iron",         promptHint: "made of rough wrought iron with a dark matte surface, hammered texture and traces of rust" },
  { id: "platinum",  label: "Platinum",  category: "metal",  description: "Lustrous platinum",          promptHint: "made of lustrous platinum with a cool white-grey metallic sheen and premium polished finish" },
  { id: "titanium",  label: "Titanium",  category: "metal",  description: "Matte industrial titanium",  promptHint: "made of matte titanium with a cool silvery-grey surface, subtle anodized tints and an industrial precision finish" },

  // -------------------- Stone --------------------
  { id: "marble",        label: "Marble",        category: "stone", description: "White marble with veins",  promptHint: "made of polished white marble with grey-blue veining, a smooth glossy surface and classical elegance" },
  { id: "granite",       label: "Granite",       category: "stone", description: "Speckled polished granite", promptHint: "made of polished granite with a speckled grey-black crystalline surface and a cool glossy finish" },
  { id: "obsidian",      label: "Obsidian",      category: "stone", description: "Glossy black obsidian",    promptHint: "made of polished black obsidian with a deep glassy surface, subtle rainbow flecks and razor-sharp highlights" },
  { id: "sandstone",     label: "Sandstone",     category: "stone", description: "Warm layered sandstone",   promptHint: "made of warm weathered sandstone with horizontal layered striations, soft ochre tones and a rough grainy surface" },
  { id: "slate",         label: "Slate",         category: "stone", description: "Dark flat slate",          promptHint: "made of dark slate with flat matte grey-blue surfaces, subtle cleavage lines and a cool sedimentary texture" },
  { id: "jade",          label: "Jade",          category: "stone", description: "Translucent green jade",   promptHint: "made of polished jade with a translucent green glow, fine internal veining and a smooth waxy surface" },
  { id: "onyx",          label: "Onyx",          category: "stone", description: "Banded polished onyx",     promptHint: "made of polished onyx with dramatic black-and-white banding, translucent depth and a glossy finish" },
  { id: "concrete",      label: "Concrete",      category: "stone", description: "Cast industrial concrete", promptHint: "made of cast concrete with a rough grey surface, visible formwork lines, scattered aggregate and an industrial brutalist feel" },

  // -------------------- Wood --------------------
  { id: "oak",          label: "Oak",          category: "wood", description: "Rich grained oak",          promptHint: "made of rich grained oak with warm honey-brown tones, strong vertical grain lines and a satin finish" },
  { id: "mahogany",     label: "Mahogany",     category: "wood", description: "Deep red mahogany",         promptHint: "made of polished mahogany with a deep reddish-brown tone, tight swirling grain and a glossy heirloom finish" },
  { id: "walnut",       label: "Walnut",       category: "wood", description: "Dark walnut",               promptHint: "made of walnut with deep chocolate-brown tones, flowing grain patterns and a soft satin sheen" },
  { id: "bamboo",       label: "Bamboo",       category: "wood", description: "Light segmented bamboo",    promptHint: "made of pale bamboo with visible horizontal node segments, clean vertical grain and a light natural finish" },
  { id: "birch",        label: "Birch",        category: "wood", description: "Pale smooth birch",         promptHint: "made of pale birch with fine close grain, a smooth cream-white surface and subtle warmth" },
  { id: "driftwood",    label: "Driftwood",    category: "wood", description: "Weathered driftwood",       promptHint: "made of weathered driftwood with silver-grey sun-bleached surfaces, smoothed edges and a raw organic texture" },

  // -------------------- Glass / Ceramic --------------------
  { id: "glass",           label: "Glass",             category: "glass-ceramic", description: "Clear transparent glass",    promptHint: "made of clear transparent glass with sharp refracted highlights, crisp edge caustics and subtle internal reflections" },
  { id: "stained-glass",   label: "Stained Glass",     category: "glass-ceramic", description: "Jewel-toned stained glass",  promptHint: "made of stained glass with jewel-toned panels, dark lead caming and vibrant light filtering through saturated color" },
  { id: "crystal",         label: "Crystal",           category: "glass-ceramic", description: "Faceted clear crystal",      promptHint: "made of faceted clear crystal with sharp prismatic facets, rainbow caustics and brilliant internal reflections" },
  { id: "porcelain",       label: "Porcelain",         category: "glass-ceramic", description: "Smooth white porcelain",     promptHint: "made of smooth white porcelain with a soft satin glaze, delicate translucency and a fine ceramic finish" },
  { id: "ceramic-glazed",  label: "Glazed Ceramic",    category: "glass-ceramic", description: "Earthy glazed ceramic",      promptHint: "made of glazed ceramic with warm earth tones, a glossy vitrified surface and subtle kiln-fired variation" },
  { id: "terracotta",      label: "Terracotta",        category: "glass-ceramic", description: "Warm unglazed terracotta",   promptHint: "made of unglazed terracotta with a warm orange-brown matte surface, fine clay texture and a rustic handmade feel" },

  // -------------------- Natural / Elemental --------------------
  { id: "water",      label: "Water",      category: "natural", description: "Flowing translucent water",    promptHint: "made of flowing translucent water with dynamic refractions, moving highlights and rippled internal caustics" },
  { id: "fire",       label: "Fire",       category: "natural", description: "Living flame",                 promptHint: "made of living flame with dancing orange-yellow tongues, glowing ember cores and wisps of drifting smoke" },
  { id: "ice",        label: "Ice",        category: "natural", description: "Translucent crystalline ice",  promptHint: "made of translucent crystalline ice with internal fractures, cool blue highlights and a frosted glossy surface" },
  { id: "smoke",      label: "Smoke",      category: "natural", description: "Drifting ethereal smoke",      promptHint: "made of drifting ethereal smoke with soft volumetric wisps, translucent layers and a slow hypnotic flow" },
  { id: "sand",       label: "Sand",       category: "natural", description: "Fine granular sand",           promptHint: "made of fine granular sand with a soft golden matte surface, subtle grain texture and gentle shifting edges" },
  { id: "moss",       label: "Moss",       category: "natural", description: "Lush living moss",             promptHint: "made of lush living moss with a soft velvety green surface, fine plant texture and an organic overgrown feel" },
  { id: "leaves",     label: "Leaves",     category: "natural", description: "Layered plant leaves",         promptHint: "made of layered plant leaves with overlapping green foliage, visible veining and a natural dappled texture" },

  // -------------------- Exotic / Futuristic --------------------
  { id: "holographic",   label: "Holographic",      category: "exotic", description: "Iridescent hologram",          promptHint: "made of holographic iridescent material with shifting rainbow sheen, prismatic highlights and a futuristic shimmer" },
  { id: "liquid-metal",  label: "Liquid Metal",     category: "exotic", description: "Reflective liquid chrome",    promptHint: "made of reflective liquid metal with a flowing mercury-like chrome surface, seamless reflections and metallic pooling highlights" },
  { id: "neon",          label: "Neon Glow",        category: "exotic", description: "Glowing neon tubing",         promptHint: "made of glowing neon tubing with saturated magenta and cyan light, a soft halo glow and a cybernetic futuristic feel" },
  { id: "translucent",   label: "Translucent Resin", category: "exotic", description: "Frosted glowing resin",      promptHint: "made of frosted translucent resin with soft internal glow, milky subsurface scattering and a smooth cast finish" },
  { id: "mirror",        label: "Mirror",           category: "exotic", description: "Perfect mirror surface",      promptHint: "made of perfect mirror surface with flawless reflections, no tint and razor-sharp reflected detail" },
  { id: "plasma",        label: "Plasma",           category: "exotic", description: "Glowing electric plasma",     promptHint: "made of glowing electric plasma with arcing internal bolts, a radiant violet-pink core and a haze of ionized energy" },
  { id: "crystal-shard", label: "Crystal Shards",   category: "exotic", description: "Shattered glowing crystal",   promptHint: "made of fractured glowing crystal shards with sharp prismatic facets, internal luminescence and dynamic rainbow refraction" },
  { id: "obsidian-glass", label: "Obsidian Glass",  category: "exotic", description: "Dark volcanic glass",         promptHint: "made of dark obsidian volcanic glass with a glossy black surface, razor-sharp edges and subtle iridescent highlights" },
] as const

const materialById = new Map<string, Material>(MATERIALS.map((m) => [m.id, m]))

export function getMaterial(id: string | undefined | null): Material | undefined {
  if (!id) return undefined
  return materialById.get(id)
}

export function getMaterialLabel(id: string | undefined | null, fallback?: string): string {
  const m = getMaterial(id)
  if (m) return m.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getMaterialPromptHint(id: string | undefined | null): string {
  return getMaterial(id)?.promptHint ?? ""
}

export const MATERIAL_IDS: ReadonlyArray<string> = MATERIALS.map((m) => m.id)

export const MATERIAL_CATEGORY_LABELS: Readonly<Record<MaterialCategory, string>> = {
  fabric: "Fabric",
  metal: "Metal",
  stone: "Stone",
  wood: "Wood",
  "glass-ceramic": "Glass / Ceramic",
  natural: "Natural",
  exotic: "Exotic",
}

export const MATERIAL_CATEGORY_ORDER: ReadonlyArray<MaterialCategory> = [
  "fabric",
  "metal",
  "stone",
  "wood",
  "glass-ceramic",
  "natural",
  "exotic",
]
