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
 * glass", "a pillow made of leather", "a train made of plastic"). The compact
 * `term` keeps that same head ("made of polished gold"): without it the
 * fragment stops saying what the subject IS and merely names a material
 * present in the scene, which is a different image.
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

import { resolveTerm, type PickerHintMode } from "./term.js"

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
  /**
   * Compact professional term (see `term.ts`). Authored on EVERY material, and
   * always in the catalog's `"made of ..."` grammar — that grammar is what
   * makes the fragment mean "the subject IS this material" rather than "this
   * material is somewhere in the scene", so it belongs to the term as much as
   * to the hint. It also carries the qualifier the label drops where the bare
   * noun would mislead: "gold"/"silver" alone read as COLORS, "mesh" as 3D
   * geometry, "Subsurface Glow" is a UI label for subsurface scattering.
   */
  readonly term?: string
}

export const MATERIALS: ReadonlyArray<Material> = [
  // -------------------- Fabric --------------------
  { id: "silk",      label: "Silk",      category: "fabric", description: "Smooth glossy silk",         promptHint: "made of smooth glossy silk with a subtle natural sheen and delicate fluid drape", term: "made of silk" },
  { id: "cotton",    label: "Cotton",    category: "fabric", description: "Soft matte cotton",          promptHint: "made of soft matte cotton fabric with a natural woven texture and subtle wrinkles", term: "made of cotton" },
  { id: "denim",     label: "Denim",     category: "fabric", description: "Heavy indigo denim",         promptHint: "made of heavy indigo denim with visible diagonal weave, worn edges and subtle fading", term: "made of heavy indigo denim" },
  { id: "leather",   label: "Leather",   category: "fabric", description: "Rich supple leather",        promptHint: "made of rich supple leather with a soft satin sheen, natural grain and warm brown tones", term: "made of leather" },
  { id: "velvet",    label: "Velvet",    category: "fabric", description: "Plush velvet",               promptHint: "made of plush velvet with a deep soft nap, rich saturated color and directional sheen", term: "made of velvet" },
  { id: "satin",     label: "Satin",     category: "fabric", description: "Glossy satin",               promptHint: "made of glossy satin with a lustrous mirror-like surface and fluid draping folds", term: "made of satin" },
  { id: "lace",      label: "Lace",      category: "fabric", description: "Delicate patterned lace",    promptHint: "made of delicate patterned lace with intricate floral openwork and a fine translucent texture", term: "made of lace" },
  { id: "wool",      label: "Wool",      category: "fabric", description: "Warm woven wool",            promptHint: "made of warm woven wool with a soft matte surface, visible fibers and a cozy textured feel", term: "made of wool" },
  { id: "linen",     label: "Linen",     category: "fabric", description: "Natural textured linen",     promptHint: "made of natural linen with a loose open weave, slight slubs and a slightly wrinkled airy drape", term: "made of linen" },
  { id: "tweed",     label: "Tweed",     category: "fabric", description: "Rustic woven tweed",         promptHint: "made of rustic tweed with a flecked multi-color woven texture and a rough heritage feel", term: "made of tweed" },
  { id: "cashmere",  label: "Cashmere",  category: "fabric", description: "Luxurious soft cashmere",    promptHint: "made of luxurious cashmere with an ultra-soft matte texture and a fine dense weave", term: "made of cashmere" },
  { id: "chiffon",   label: "Chiffon",   category: "fabric", description: "Sheer flowing chiffon",      promptHint: "made of sheer chiffon with a lightweight floating drape, soft translucent layers and a gentle shimmer", term: "made of chiffon" },
  { id: "fur",       label: "Fur",       category: "fabric", description: "Thick plush fur",            promptHint: "made of thick plush fur with long dense strands, natural variation and a soft directional flow", term: "made of fur" },
  { id: "suede",     label: "Suede",     category: "fabric", description: "Soft napped suede",          promptHint: "made of soft napped suede with a matte velvety surface, fine fuzzy texture and a warm leather feel", term: "made of suede" },
  { id: "mesh",      label: "Mesh",      category: "fabric", description: "See-through net mesh",       promptHint: "made of see-through net mesh with an open woven grid, sheer transparency and an athletic technical feel", term: "made of sheer mesh fabric" },
  { id: "patent-leather", label: "Patent Leather", category: "fabric", description: "High-gloss patent leather", promptHint: "made of high-gloss patent leather with a mirror-bright reflective surface, deep saturated color and a slick lacquered finish", term: "made of patent leather" },

  // -------------------- Metal --------------------
  { id: "gold",      label: "Gold",      category: "metal",  description: "Polished gold",              promptHint: "made of polished gold with a warm yellow metallic sheen and rich mirror-like reflections", term: "made of polished gold" },
  { id: "silver",    label: "Silver",    category: "metal",  description: "Polished silver",            promptHint: "made of polished silver with a cool bright metallic sheen and clean mirror-like reflections", term: "made of polished silver" },
  { id: "bronze",    label: "Bronze",    category: "metal",  description: "Patinaed cast bronze",       promptHint: "made of cast bronze with a warm brown-gold metallic surface and a mottled greenish patina in the recesses", term: "made of patinated cast bronze" },
  { id: "chrome",    label: "Chrome",    category: "metal",  description: "Hyper-reflective chrome",    promptHint: "made of hyper-reflective polished chrome with liquid mirror surfaces and sharp environmental reflections", term: "made of polished chrome" },
  { id: "copper",    label: "Copper",    category: "metal",  description: "Warm copper with patina",    promptHint: "made of warm copper with a rich rose-orange metallic gleam and touches of blue-green oxidation", term: "made of patinated copper" },
  { id: "brass",     label: "Brass",     category: "metal",  description: "Antique brass",              promptHint: "made of antique brass with a warm yellow-gold hue, brushed texture and slight tarnish in the crevices", term: "made of antique brass" },
  { id: "steel",     label: "Steel",     category: "metal",  description: "Brushed stainless steel",    promptHint: "made of brushed stainless steel with fine directional grain and cool soft reflections", term: "made of brushed stainless steel" },
  { id: "iron",      label: "Iron",      category: "metal",  description: "Rough wrought iron",         promptHint: "made of rough wrought iron with a dark matte surface, hammered texture and traces of rust", term: "made of wrought iron" },
  { id: "platinum",  label: "Platinum",  category: "metal",  description: "Lustrous platinum",          promptHint: "made of lustrous platinum with a cool white-grey metallic sheen and premium polished finish", term: "made of polished platinum" },
  { id: "titanium",  label: "Titanium",  category: "metal",  description: "Matte industrial titanium",  promptHint: "made of matte titanium with a cool silvery-grey surface, subtle anodized tints and an industrial precision finish", term: "made of matte titanium" },

  // -------------------- Stone --------------------
  { id: "marble",        label: "Marble",        category: "stone", description: "White marble with veins",  promptHint: "made of polished white marble with grey-blue veining, a smooth glossy surface and classical elegance", term: "made of polished marble" },
  { id: "granite",       label: "Granite",       category: "stone", description: "Speckled polished granite", promptHint: "made of polished granite with a speckled grey-black crystalline surface and a cool glossy finish", term: "made of polished granite" },
  { id: "obsidian",      label: "Obsidian",      category: "stone", description: "Glossy black obsidian",    promptHint: "made of polished black obsidian with a deep glassy surface, subtle rainbow flecks and razor-sharp highlights", term: "made of polished obsidian" },
  { id: "sandstone",     label: "Sandstone",     category: "stone", description: "Warm layered sandstone",   promptHint: "made of warm weathered sandstone with horizontal layered striations, soft ochre tones and a rough grainy surface", term: "made of weathered sandstone" },
  { id: "slate",         label: "Slate",         category: "stone", description: "Dark flat slate",          promptHint: "made of dark slate with flat matte grey-blue surfaces, subtle cleavage lines and a cool sedimentary texture", term: "made of slate" },
  { id: "jade",          label: "Jade",          category: "stone", description: "Translucent green jade",   promptHint: "made of polished jade with a translucent green glow, fine internal veining and a smooth waxy surface", term: "made of polished jade" },
  { id: "onyx",          label: "Onyx",          category: "stone", description: "Banded polished onyx",     promptHint: "made of polished onyx with dramatic black-and-white banding, translucent depth and a glossy finish", term: "made of polished onyx" },
  { id: "concrete",      label: "Concrete",      category: "stone", description: "Cast industrial concrete", promptHint: "made of cast concrete with a rough grey surface, visible formwork lines, scattered aggregate and an industrial brutalist feel", term: "made of cast concrete" },
  { id: "terrazzo",      label: "Terrazzo",      category: "stone", description: "Composite terrazzo with chips", promptHint: "made of polished terrazzo with embedded marble and glass chips suspended in a smooth cement matrix, a mid-century speckled surface and a glossy finish", term: "made of polished terrazzo" },

  // -------------------- Wood --------------------
  { id: "oak",          label: "Oak",          category: "wood", description: "Rich grained oak",          promptHint: "made of rich grained oak with warm honey-brown tones, strong vertical grain lines and a satin finish", term: "made of oak" },
  { id: "mahogany",     label: "Mahogany",     category: "wood", description: "Deep red mahogany",         promptHint: "made of polished mahogany with a deep reddish-brown tone, tight swirling grain and a glossy heirloom finish", term: "made of polished mahogany" },
  { id: "walnut",       label: "Walnut",       category: "wood", description: "Dark walnut",               promptHint: "made of walnut with deep chocolate-brown tones, flowing grain patterns and a soft satin sheen", term: "made of walnut" },
  { id: "bamboo",       label: "Bamboo",       category: "wood", description: "Light segmented bamboo",    promptHint: "made of pale bamboo with visible horizontal node segments, clean vertical grain and a light natural finish", term: "made of bamboo" },
  { id: "birch",        label: "Birch",        category: "wood", description: "Pale smooth birch",         promptHint: "made of pale birch with fine close grain, a smooth cream-white surface and subtle warmth", term: "made of birch" },
  { id: "driftwood",    label: "Driftwood",    category: "wood", description: "Weathered driftwood",       promptHint: "made of weathered driftwood with silver-grey sun-bleached surfaces, smoothed edges and a raw organic texture", term: "made of weathered driftwood" },

  // -------------------- Glass / Ceramic --------------------
  { id: "glass",           label: "Glass",             category: "glass-ceramic", description: "Clear transparent glass",    promptHint: "made of clear transparent glass with sharp refracted highlights, crisp edge caustics and subtle internal reflections", term: "made of clear glass" },
  { id: "stained-glass",   label: "Stained Glass",     category: "glass-ceramic", description: "Jewel-toned stained glass",  promptHint: "made of stained glass with jewel-toned panels, dark lead caming and vibrant light filtering through saturated color", term: "made of stained glass" },
  { id: "crystal",         label: "Crystal",           category: "glass-ceramic", description: "Faceted clear crystal",      promptHint: "made of faceted clear crystal with sharp prismatic facets, rainbow caustics and brilliant internal reflections", term: "made of faceted crystal" },
  { id: "porcelain",       label: "Porcelain",         category: "glass-ceramic", description: "Smooth white porcelain",     promptHint: "made of smooth white porcelain with a soft satin glaze, delicate translucency and a fine ceramic finish", term: "made of porcelain" },
  { id: "ceramic-glazed",  label: "Glazed Ceramic",    category: "glass-ceramic", description: "Earthy glazed ceramic",      promptHint: "made of glazed ceramic with warm earth tones, a glossy vitrified surface and subtle kiln-fired variation", term: "made of glazed ceramic" },
  { id: "terracotta",      label: "Terracotta",        category: "glass-ceramic", description: "Warm unglazed terracotta",   promptHint: "made of unglazed terracotta with a warm orange-brown matte surface, fine clay texture and a rustic handmade feel", term: "made of unglazed terracotta" },

  // -------------------- Natural / Elemental --------------------
  { id: "water",      label: "Water",      category: "natural", description: "Flowing translucent water",    promptHint: "made of flowing translucent water with dynamic refractions, moving highlights and rippled internal caustics", term: "made of flowing water" },
  { id: "fire",       label: "Fire",       category: "natural", description: "Living flame",                 promptHint: "made of living flame with dancing orange-yellow tongues, glowing ember cores and wisps of drifting smoke", term: "made of living flame" },
  { id: "ice",        label: "Ice",        category: "natural", description: "Translucent crystalline ice",  promptHint: "made of translucent crystalline ice with internal fractures, cool blue highlights and a frosted glossy surface", term: "made of crystalline ice" },
  { id: "smoke",      label: "Smoke",      category: "natural", description: "Drifting ethereal smoke",      promptHint: "made of drifting ethereal smoke with soft volumetric wisps, translucent layers and a slow hypnotic flow", term: "made of drifting smoke" },
  { id: "sand",       label: "Sand",       category: "natural", description: "Fine granular sand",           promptHint: "made of fine granular sand with a soft golden matte surface, subtle grain texture and gentle shifting edges", term: "made of fine sand" },
  { id: "moss",       label: "Moss",       category: "natural", description: "Lush living moss",             promptHint: "made of lush living moss with a soft velvety green surface, fine plant texture and an organic overgrown feel", term: "made of living moss" },
  { id: "leaves",     label: "Leaves",     category: "natural", description: "Layered plant leaves",         promptHint: "made of layered plant leaves with overlapping green foliage, visible veining and a natural dappled texture", term: "made of layered plant leaves" },

  // -------------------- Exotic / Futuristic --------------------
  { id: "holographic",   label: "Holographic",      category: "exotic", description: "Iridescent hologram",          promptHint: "made of holographic iridescent material with shifting rainbow sheen, prismatic highlights and a futuristic shimmer", term: "made of holographic iridescent material" },
  { id: "liquid-metal",  label: "Liquid Metal",     category: "exotic", description: "Reflective liquid chrome",    promptHint: "made of reflective liquid metal with a flowing mercury-like chrome surface, seamless reflections and metallic pooling highlights", term: "made of liquid metal" },
  { id: "neon",          label: "Neon Glow",        category: "exotic", description: "Glowing neon tubing",         promptHint: "made of glowing neon tubing with saturated magenta and cyan light, a soft halo glow and a cybernetic futuristic feel", term: "made of glowing neon tubing" },
  { id: "translucent",   label: "Translucent Resin", category: "exotic", description: "Frosted glowing resin",      promptHint: "made of frosted translucent resin with soft internal glow, milky subsurface scattering and a smooth cast finish", term: "made of translucent resin" },
  { id: "subsurface",    label: "Subsurface Glow",   category: "exotic", description: "Light glows beneath the surface", promptHint: "made of a soft translucent material with pronounced subsurface scattering, light penetrating beneath the surface and glowing warmly from within", term: "made of translucent subsurface-scattering material" },
  { id: "mirror",        label: "Mirror",           category: "exotic", description: "Perfect mirror surface",      promptHint: "made of perfect mirror surface with flawless reflections, no tint and razor-sharp reflected detail", term: "made of perfect mirror surface" },
  { id: "plasma",        label: "Plasma",           category: "exotic", description: "Glowing electric plasma",     promptHint: "made of glowing electric plasma with arcing internal bolts, a radiant violet-pink core and a haze of ionized energy", term: "made of glowing electric plasma" },
  { id: "crystal-shard", label: "Crystal Shards",   category: "exotic", description: "Shattered glowing crystal",   promptHint: "made of fractured glowing crystal shards with sharp prismatic facets, internal luminescence and dynamic rainbow refraction", term: "made of fractured glowing crystal shards" },
  { id: "obsidian-glass", label: "Obsidian Glass",  category: "exotic", description: "Dark volcanic glass",         promptHint: "made of dark obsidian volcanic glass with a glossy black surface, razor-sharp edges and subtle iridescent highlights", term: "made of dark volcanic obsidian glass" },
  { id: "iridescent",     label: "Iridescent",      category: "exotic", description: "Color-shifting iridescent surface", promptHint: "made of iridescent rainbow-shifting surface, the kind of color play seen on oil slicks, butterfly wings and mother-of-pearl, with hues that shift as the angle changes", term: "made of iridescent color-shifting material" },
  { id: "mother-of-pearl", label: "Mother-of-Pearl", category: "exotic", description: "Pearlescent inner shell layer", promptHint: "made of mother-of-pearl with a pearlescent cream surface, soft iridescent shimmer and the layered nacre depth seen in inlay work and fine jewelry", term: "made of mother-of-pearl" },
  { id: "carbon-fiber",   label: "Carbon Fiber",    category: "exotic", description: "Woven black carbon-fiber composite", promptHint: "made of woven carbon-fiber composite with a glossy black checkered weave pattern, a hi-tech aerospace feel and subtle directional sheen", term: "made of woven carbon fiber" },
  { id: "holographic-film", label: "Holographic Film", category: "exotic", description: "Light-refracting holographic film", promptHint: "made of light-refracting holographic film with a thin reflective sheet surface, prismatic rainbow shimmer and shifting spectral highlights as the angle changes", term: "made of holographic film" },
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

/**
 * Compact counterpart of `getMaterialPromptHint`: the short professional term
 * this material injects in compact hint mode ("made of brushed stainless
 * steel" where the hint is the full "made of ..." paragraph). The `"made of"`
 * grammar is part of the TERM, not a wrapper the consumer adds — it is what
 * distinguishes "the subject is made of glass" from "there is glass in the
 * scene", and a thin client injecting `term` standalone (see
 * `ProjectedCatalogOption`) has nothing else to reconstruct it from. Empty
 * string for an unknown id.
 */
export function getMaterialTerm(id: string | undefined | null): string {
  return resolveTerm(getMaterial(id))
}

/**
 * Multi-pick: 1-2 material ids → composite material clause. Single → entry's
 * own promptHint. Two → "made of {A} and {B}" using lowercased entry labels.
 * Covers leather+brass handbag, wood+steel chair, glass+chrome lamp, etc.
 *
 * @param mode `"compact"` emits the bare material term(s) instead (delegates
 *   to `buildMaterialTerms`).
 */
export function buildMaterialHints(value: unknown, mode: PickerHintMode = "full"): string {
  if (mode === "compact") return buildMaterialTerms(value)
  const ids: string[] = []
  if (typeof value === "string" && value) ids.push(value)
  else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  if (ids.length === 0) return ""
  if (ids.length === 1) return getMaterialPromptHint(ids[0])
  const labels = ids
    .slice(0, 2)
    .map((id) => getMaterial(id)?.label?.toLowerCase() ?? "")
    .filter((s): s is string => Boolean(s))
  if (labels.length < 2) return getMaterialPromptHint(ids[0])
  return `made of ${labels[0]} and ${labels[1]}`
}

/**
 * Compact counterpart of `buildMaterialHints`: one material's term, or two
 * joined with " and " ("made of polished gold and made of walnut"). Each term
 * carries its own "made of" grammar, so the join needs no wrapper and a
 * pack-added entry whose term is only the derived label still reads correctly.
 */
export function buildMaterialTerms(value: unknown): string {
  const ids: string[] = []
  if (typeof value === "string" && value) ids.push(value)
  else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  const terms = ids
    .slice(0, 2)
    .map((id) => getMaterialTerm(id))
    .filter((t) => t.length > 0)
  return terms.join(" and ")
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
