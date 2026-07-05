// Object Studio asset presets — SINGLE SOURCE OF TRUTH for the Angles /
// Materials / Variations preset chips AND their generation prompt fragments.
//
// Both the frontend tab wrappers (`object-studio/{angles,materials,variations}-tab.tsx`)
// and the backend route (`generate-object-asset.ts` — VARIANTS validation +
// buildVariantPrompt) import from here, so the preset list can never drift
// between client and server.
//
// Why this file exists: the frontend shipped 9 / 13 / 11 presets while the
// backend enum only accepted 5 / 6 / 5, so ~17 chips 400'd with a silent
// failure (the route rejects any variant not in VARIANTS, and the studio sent
// them as assetType:"angles|materials|variations", NOT "custom"). Deriving both
// sides from one constant is the drift-proof fix.
//
// To add a preset: add ONE entry to the matching prompt map below. The key list
// and the backend validation update automatically.

/** Angle preset → prompt fragment (slotted into "<name>, <fragment>. <base>"). */
export const OBJECT_ANGLE_PROMPTS: Record<string, string> = {
  front: "front view, facing camera directly",
  side: "side profile view",
  top: "top-down view, bird's eye perspective",
  back: "back view, rear perspective",
  "three-quarter": "three-quarter angle view, dynamic perspective",
  detail: "extreme close-up detail shot, macro view of the surface and craftsmanship",
  "in-context": "shown in its natural environment and use context, real-world setting",
  exploded: "exploded technical view, components separated and floating apart",
  perspective: "dramatic low-angle perspective view, strong sense of depth",
}

/** Material preset → prompt fragment. */
export const OBJECT_MATERIAL_PROMPTS: Record<string, string> = {
  wood: "made of polished wood, wood grain texture visible",
  metal: "made of brushed metal, metallic surface with subtle reflections",
  glass: "made of transparent glass, see-through with subtle reflections",
  plastic: "made of smooth plastic, matte finish",
  fabric: "covered in soft fabric texture, textile material",
  stone: "carved from stone, rough granite or marble texture",
  ceramic: "made of glazed ceramic, smooth glossy fired-clay surface",
  leather: "wrapped in tanned leather, natural grain and visible stitching",
  paper: "made of folded paper and cardboard, matte fibrous texture",
  gold: "made of polished gold, warm reflective precious-metal sheen",
  silver: "made of polished silver, cool bright reflective metal",
  copper: "made of copper, warm reddish metal with a subtle patina",
  marble: "carved from marble, smooth polished stone with natural veining",
}

/** Variation preset → prompt fragment. */
export const OBJECT_VARIATION_PROMPTS: Record<string, string> = {
  clean: "brand new pristine condition, perfect and clean",
  weathered: "slightly weathered and aged, with wear marks",
  damaged: "battle-damaged with scratches and dents",
  ornate: "ornately decorated with intricate details and patterns",
  minimal: "minimalist design, clean simple lines",
  broken: "broken and cracked, shattered with missing pieces",
  antique: "antique vintage version, aged patina and period detailing",
  futuristic: "sleek futuristic sci-fi redesign, advanced materials with a subtle glow",
  holographic: "iridescent holographic finish, rainbow refractive sheen",
  dirty: "dirty and grimy, covered in dust, mud and stains",
  polished: "immaculately polished, mirror-bright showroom finish",
}

export const OBJECT_ANGLE_PRESETS: readonly string[] = Object.keys(OBJECT_ANGLE_PROMPTS)
export const OBJECT_MATERIAL_PRESETS: readonly string[] = Object.keys(OBJECT_MATERIAL_PROMPTS)
export const OBJECT_VARIATION_PRESETS: readonly string[] = Object.keys(OBJECT_VARIATION_PROMPTS)

export type ObjectPresetAssetType = "angles" | "materials" | "variations"

/** Preset key lists per asset type — backend VARIANTS validation reads this. */
export const OBJECT_ASSET_PRESETS: Record<ObjectPresetAssetType, readonly string[]> = {
  angles: OBJECT_ANGLE_PRESETS,
  materials: OBJECT_MATERIAL_PRESETS,
  variations: OBJECT_VARIATION_PRESETS,
}

/** Prompt-fragment maps per asset type — backend buildVariantPrompt reads this. */
export const OBJECT_ASSET_PROMPTS: Record<ObjectPresetAssetType, Record<string, string>> = {
  angles: OBJECT_ANGLE_PROMPTS,
  materials: OBJECT_MATERIAL_PROMPTS,
  variations: OBJECT_VARIATION_PROMPTS,
}
