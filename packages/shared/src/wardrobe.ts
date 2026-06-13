import { pickIds } from "./multi-pick.js"

export type WardrobeDimension =
  | "archetype" | "top" | "bottom" | "outerwear" | "footwear"
  | "headwear" | "accessories" | "color-palette" | "material" | "era"

export interface WardrobeEntry {
  readonly id: string
  readonly label: string
  readonly dimension: WardrobeDimension
  readonly promptHint: string
}

export interface WardrobeValue {
  archetype?: string
  top?: string
  bottom?: string
  outerwear?: string
  footwear?: string
  headwear?: string | ReadonlyArray<string>
  accessories?: string | ReadonlyArray<string>
  colorPalette?: string
  material?: string
  era?: string
}

export const WARDROBE_DIMENSION_ORDER: ReadonlyArray<WardrobeDimension> = [
  "archetype", "top", "bottom", "outerwear", "footwear",
  "headwear", "accessories", "color-palette", "material", "era",
]

export const WARDROBE_CATEGORY_LABELS: Readonly<Record<WardrobeDimension, string>> = {
  archetype: "Archetype", top: "Top", bottom: "Bottom", outerwear: "Outerwear",
  footwear: "Footwear", headwear: "Headwear", accessories: "Accessories",
  "color-palette": "Color Palette", material: "Material", era: "Era",
}

export const WARDROBE_FIELD_BY_DIMENSION: Record<WardrobeDimension, keyof WardrobeValue> = {
  archetype: "archetype", top: "top", bottom: "bottom", outerwear: "outerwear",
  footwear: "footwear", headwear: "headwear", accessories: "accessories",
  "color-palette": "colorPalette", material: "material", era: "era",
}

/** Multi-pick dims emit each picked entry independently. */
const MULTI_PICK: ReadonlySet<WardrobeDimension> = new Set(["headwear", "accessories"])
/** Sentinel ids that mean "nothing here" and emit no hint. */
const NONE_IDS: ReadonlySet<string> = new Set(["wd-outer-none"])

export const WARDROBE: ReadonlyArray<WardrobeEntry> = [
  // archetype
  { id: "wd-casual",     label: "Casual",     dimension: "archetype", promptHint: "in casual everyday clothing" },
  { id: "wd-business",   label: "Business",   dimension: "archetype", promptHint: "in smart business attire" },
  { id: "wd-formal",     label: "Formal",     dimension: "archetype", promptHint: "in elegant formal wear" },
  { id: "wd-streetwear", label: "Streetwear", dimension: "archetype", promptHint: "in contemporary streetwear" },
  { id: "wd-athletic",   label: "Athletic",   dimension: "archetype", promptHint: "in athletic sportswear" },
  { id: "wd-fantasy",    label: "Fantasy",    dimension: "archetype", promptHint: "in fantasy costume" },
  { id: "wd-scifi",      label: "Sci-Fi",     dimension: "archetype", promptHint: "in futuristic sci-fi attire" },
  { id: "wd-historical", label: "Historical", dimension: "archetype", promptHint: "in period historical dress" },
  { id: "wd-uniform",    label: "Uniform",    dimension: "archetype", promptHint: "in a uniform" },
  { id: "wd-loungewear", label: "Loungewear", dimension: "archetype", promptHint: "in relaxed loungewear" },
  // top
  { id: "wd-tshirt",     label: "T-Shirt",     dimension: "top", promptHint: "wearing a t-shirt" },
  { id: "wd-blouse",     label: "Blouse",      dimension: "top", promptHint: "wearing a blouse" },
  { id: "wd-hoodie",     label: "Hoodie",      dimension: "top", promptHint: "wearing a hoodie" },
  { id: "wd-buttondown", label: "Button-down", dimension: "top", promptHint: "wearing a button-down shirt" },
  { id: "wd-tank",       label: "Tank",        dimension: "top", promptHint: "wearing a tank top" },
  { id: "wd-sweater",    label: "Sweater",     dimension: "top", promptHint: "wearing a sweater" },
  { id: "wd-turtleneck", label: "Turtleneck",  dimension: "top", promptHint: "wearing a turtleneck" },
  // bottom
  { id: "wd-jeans",    label: "Jeans",    dimension: "bottom", promptHint: "wearing jeans" },
  { id: "wd-trousers", label: "Trousers", dimension: "bottom", promptHint: "wearing tailored trousers" },
  { id: "wd-skirt",    label: "Skirt",    dimension: "bottom", promptHint: "wearing a skirt" },
  { id: "wd-shorts",   label: "Shorts",   dimension: "bottom", promptHint: "wearing shorts" },
  { id: "wd-leggings", label: "Leggings", dimension: "bottom", promptHint: "wearing leggings" },
  { id: "wd-cargo",    label: "Cargo",    dimension: "bottom", promptHint: "wearing cargo pants" },
  // outerwear
  { id: "wd-outer-none",  label: "None",         dimension: "outerwear", promptHint: "" },
  { id: "wd-leatherjkt",  label: "Leather Jacket", dimension: "outerwear", promptHint: "in a leather jacket" },
  { id: "wd-blazer",      label: "Blazer",       dimension: "outerwear", promptHint: "in a blazer" },
  { id: "wd-trench",      label: "Trench Coat",  dimension: "outerwear", promptHint: "in a trench coat" },
  { id: "wd-parka",       label: "Parka",        dimension: "outerwear", promptHint: "in a parka" },
  { id: "wd-cloak",       label: "Cloak",        dimension: "outerwear", promptHint: "in a flowing cloak" },
  { id: "wd-denimjkt",    label: "Denim Jacket", dimension: "outerwear", promptHint: "in a denim jacket" },
  { id: "wd-cardigan",    label: "Cardigan",     dimension: "outerwear", promptHint: "in a cardigan" },
  // footwear
  { id: "wd-sneakers",  label: "Sneakers",   dimension: "footwear", promptHint: "wearing sneakers" },
  { id: "wd-boots",     label: "Boots",      dimension: "footwear", promptHint: "wearing boots" },
  { id: "wd-heels",     label: "Heels",      dimension: "footwear", promptHint: "wearing heels" },
  { id: "wd-sandals",   label: "Sandals",    dimension: "footwear", promptHint: "wearing sandals" },
  { id: "wd-dressshoe", label: "Dress Shoes", dimension: "footwear", promptHint: "wearing dress shoes" },
  { id: "wd-barefoot",  label: "Barefoot",   dimension: "footwear", promptHint: "barefoot" },
  // headwear (multi)
  { id: "wd-cap",      label: "Cap",      dimension: "headwear", promptHint: "wearing a cap" },
  { id: "wd-beanie",   label: "Beanie",   dimension: "headwear", promptHint: "wearing a beanie" },
  { id: "wd-widehat",  label: "Wide-brim Hat", dimension: "headwear", promptHint: "wearing a wide-brim hat" },
  { id: "wd-hood",     label: "Hood",     dimension: "headwear", promptHint: "with the hood up" },
  { id: "wd-crown",    label: "Crown",    dimension: "headwear", promptHint: "wearing a crown" },
  { id: "wd-helmet",   label: "Helmet",   dimension: "headwear", promptHint: "wearing a helmet" },
  // accessories (multi)
  { id: "wd-glasses",   label: "Glasses",   dimension: "accessories", promptHint: "wearing glasses" },
  { id: "wd-sunglasses", label: "Sunglasses", dimension: "accessories", promptHint: "wearing sunglasses" },
  { id: "wd-scarf",     label: "Scarf",     dimension: "accessories", promptHint: "wearing a scarf" },
  { id: "wd-gloves",    label: "Gloves",    dimension: "accessories", promptHint: "wearing gloves" },
  { id: "wd-jewelry",   label: "Jewelry",   dimension: "accessories", promptHint: "wearing statement jewelry" },
  { id: "wd-belt",      label: "Belt",      dimension: "accessories", promptHint: "with a belt" },
  { id: "wd-watch",     label: "Watch",     dimension: "accessories", promptHint: "wearing a watch" },
  // color-palette
  { id: "wd-neutral",   label: "Neutral",   dimension: "color-palette", promptHint: "in a neutral color palette" },
  { id: "wd-all-black", label: "All Black", dimension: "color-palette", promptHint: "in an all-black palette" },
  { id: "wd-earth",     label: "Earth Tones", dimension: "color-palette", promptHint: "in earth-tone colors" },
  { id: "wd-pastel",    label: "Pastel",    dimension: "color-palette", promptHint: "in pastel colors" },
  { id: "wd-jewel",     label: "Jewel Tones", dimension: "color-palette", promptHint: "in rich jewel-tone colors" },
  { id: "wd-neon",      label: "Neon",      dimension: "color-palette", promptHint: "in vivid neon colors" },
  { id: "wd-all-white", label: "All White", dimension: "color-palette", promptHint: "in an all-white palette" },
  // material
  { id: "wd-cotton",  label: "Cotton",  dimension: "material", promptHint: "in cotton fabric" },
  { id: "wd-denim",   label: "Denim",   dimension: "material", promptHint: "in denim" },
  { id: "wd-leather", label: "Leather", dimension: "material", promptHint: "in leather" },
  { id: "wd-silk",    label: "Silk",    dimension: "material", promptHint: "in silk" },
  { id: "wd-wool",    label: "Wool",    dimension: "material", promptHint: "in wool" },
  { id: "wd-latex",   label: "Latex",   dimension: "material", promptHint: "in latex" },
  { id: "wd-linen",   label: "Linen",   dimension: "material", promptHint: "in linen" },
  // era
  { id: "wd-contemporary", label: "Contemporary", dimension: "era", promptHint: "in contemporary fashion" },
  { id: "wd-1920s", label: "1920s",     dimension: "era", promptHint: "in 1920s fashion" },
  { id: "wd-1950s", label: "1950s",     dimension: "era", promptHint: "in 1950s fashion" },
  { id: "wd-1980s", label: "1980s",     dimension: "era", promptHint: "in 1980s fashion" },
  { id: "wd-victorian", label: "Victorian", dimension: "era", promptHint: "in Victorian-era dress" },
  { id: "wd-medieval", label: "Medieval", dimension: "era", promptHint: "in medieval dress" },
  { id: "wd-futuristic", label: "Futuristic", dimension: "era", promptHint: "in futuristic clothing" },
] as const

const BY_ID: Map<string, WardrobeEntry> = new Map(WARDROBE.map((e) => [e.id, e]))

/** Entries grouped by dimension — precomputed once so per-dimension lookups
 *  (the picker calls one per dimension per render) are O(1) with stable array
 *  refs, instead of a full WARDROBE scan each call. */
const BY_DIMENSION: Map<WardrobeDimension, WardrobeEntry[]> = (() => {
  const map = new Map<WardrobeDimension, WardrobeEntry[]>()
  for (const e of WARDROBE) {
    const list = map.get(e.dimension)
    if (list) list.push(e)
    else map.set(e.dimension, [e])
  }
  return map
})()

export function getWardrobeEntry(id: string | undefined | null): WardrobeEntry | undefined {
  return id ? BY_ID.get(id) : undefined
}

export function getWardrobePromptHint(id: string | undefined | null): string {
  return getWardrobeEntry(id)?.promptHint ?? ""
}

export function getWardrobeEntriesByDimension(dim: WardrobeDimension): WardrobeEntry[] {
  return BY_DIMENSION.get(dim) ?? []
}

export function buildWardrobeHints(value: Record<string, unknown> & WardrobeValue): string[] {
  const hints: string[] = []
  for (const dimension of WARDROBE_DIMENSION_ORDER) {
    const field = WARDROBE_FIELD_BY_DIMENSION[dimension]
    const raw = value[field]
    if (MULTI_PICK.has(dimension)) {
      for (const id of pickIds(raw)) {
        if (NONE_IDS.has(id)) continue
        const h = getWardrobePromptHint(id)
        if (h) hints.push(h)
      }
      continue
    }
    const id = typeof raw === "string" ? raw : undefined
    if (!id || NONE_IDS.has(id)) continue
    const h = getWardrobePromptHint(id)
    if (h) hints.push(h)
  }
  return hints
}
