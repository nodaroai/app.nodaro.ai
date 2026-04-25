/**
 * Canonical catalog of Render Engine / Quality presets.
 *
 * "Render Quality" is the pure technical-stamp dimension — what tool the image
 * appears to have been rendered through, or what quality stamp it carries.
 * Distinct from Style (artistic medium), Lens (optics), and Camera Format
 * (capture medium): a "raytracing" hint says nothing about whether the look
 * is anime or photorealistic; it just promises ray-traced-grade reflections,
 * shadows, and global illumination.
 *
 * Three loose families, each adding a different kind of authority signal:
 *  - Engines: name a real render package (Unreal 5, Octane, Cycles…). Useful
 *    for hyper-stylized 3D illustration or game-trailer aesthetics.
 *  - Render-quality keywords: the technical buzzwords that lock in modern
 *    physically-correct lighting (raytracing, PBR, GI, lumen).
 *  - Resolution / Detail: explicit "sharp + detailed" stamps (4K/8K/16K,
 *    "ultra-detailed").
 *  - Style stamps: portmanteau quality markers ("masterpiece", "raw photo",
 *    "award-winning") that providers strongly weight.
 *
 * Single-pick — only one render-quality stamp is applied per consumer. Shared
 * between picker UI and prompt-hint injection in the frontend DAG executor
 * and the backend orchestrator.
 */

export interface RenderQuality {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const RENDER_QUALITIES: ReadonlyArray<RenderQuality> = [
  // ---------------------------- Engines ----------------------------
  { id: "unreal-engine-5",    label: "Unreal Engine 5",   description: "Real-time path-traced UE5 look", promptHint: "rendered in Unreal Engine 5, real-time path-traced lighting with Lumen reflections, Nanite-grade micro-detail and cinematic post-processing" },
  { id: "blender-cycles",     label: "Blender Cycles",    description: "Cycles unbiased path tracing",   promptHint: "rendered in Blender Cycles, unbiased path-traced lighting with physically accurate shadows, soft global illumination and clean denoise" },
  { id: "octane-render",      label: "Octane Render",     description: "GPU spectral path tracing",      promptHint: "rendered in Octane, GPU spectral path tracing with hyper-realistic materials, vivid color response and crisp specular highlights" },
  { id: "redshift",           label: "Redshift",          description: "Production GPU biased renderer", promptHint: "rendered in Redshift, production-quality GPU rendering with rich material response, controlled GI and film-grade depth" },
  { id: "houdini-mantra",     label: "Houdini Mantra",    description: "VFX-grade physical rendering",   promptHint: "rendered in Houdini Mantra, VFX-grade physically-based rendering with subtle volumetric scatter and ultra-clean shading" },

  // ---------------------------- Render-quality keywords ----------------------------
  { id: "raytracing",                    label: "Ray Tracing",            description: "Accurate reflections + shadows", promptHint: "ray-traced rendering, physically accurate reflections, refractions and contact shadows with realistic light bounce" },
  { id: "physically-based-rendering",    label: "PBR",                    description: "Physically-based materials",     promptHint: "physically-based rendering with energy-conserving materials, accurate metallic/roughness response and realistic Fresnel falloff" },
  { id: "global-illumination",           label: "Global Illumination",    description: "Realistic light bounce",         promptHint: "global illumination, realistic indirect light bounce with soft color bleeding between surfaces and naturally lit shadow regions" },
  { id: "lumen-reflections",             label: "Lumen Reflections",      description: "Real-time dynamic GI",           promptHint: "Lumen-style real-time dynamic global illumination with crisp screen-space reflections, soft contact shadows and beautifully lit indirect bounces" },

  // ---------------------------- Resolution / Detail ----------------------------
  { id: "8k-uhd",          label: "8K UHD",          description: "Ultra-sharp 8K resolution",         promptHint: "8K ultra-high-definition resolution, ultra-sharp detail with every micro-texture preserved and zero softness" },
  { id: "4k-uhd",          label: "4K UHD",          description: "Crisp 4K resolution",                promptHint: "4K UHD resolution, crisp detail with cinema-grade clarity and clean edge definition" },
  { id: "16k-megapixel",   label: "16K Megapixel",   description: "Insanely high-resolution detail",    promptHint: "16K megapixel-grade resolution, insanely high-resolution detail with surgically clean edges and microscopic surface fidelity" },
  { id: "ultra-detailed",  label: "Ultra Detailed",  description: "Maximum micro-detail rendering",     promptHint: "ultra-detailed rendering with intricate micro-surface detail, fine pore-level fidelity and meticulously preserved fine structures" },

  // ---------------------------- Style stamps ----------------------------
  { id: "raw-photo",       label: "Raw Photo",       description: "Unprocessed photographic feel",      promptHint: "raw photograph aesthetic, unprocessed natural color science, authentic photographic detail and untouched documentary realism" },
  { id: "masterpiece",     label: "Masterpiece",     description: "Hand-of-an-expert quality stamp",    promptHint: "masterpiece-quality rendering, hand-of-an-expert level execution with refined composition, immaculate detail and curated finish" },
  { id: "award-winning",   label: "Award Winning",   description: "Award-circuit caliber",              promptHint: "award-winning quality, award-circuit caliber image with editorial-grade composition, magazine-cover finish and signature visual authority" },
] as const

const renderQualityById = new Map<string, RenderQuality>(
  RENDER_QUALITIES.map((r) => [r.id, r]),
)

export function getRenderQuality(id: string | undefined | null): RenderQuality | undefined {
  if (!id) return undefined
  return renderQualityById.get(id)
}

export function getRenderQualityLabel(id: string | undefined | null, fallback?: string): string {
  const r = getRenderQuality(id)
  if (r) return r.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getRenderQualityPromptHint(id: string | undefined | null): string {
  return getRenderQuality(id)?.promptHint ?? ""
}

export const RENDER_QUALITY_IDS: ReadonlyArray<string> = RENDER_QUALITIES.map((r) => r.id)
