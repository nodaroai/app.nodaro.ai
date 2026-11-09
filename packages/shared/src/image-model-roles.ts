import { MODEL_CATALOG } from "./model-catalog.js"

/**
 * The platform's answer to "which image model, when the caller names none".
 *
 * One table by ROLE, so every surface that picks for the user (node defaults,
 * route and workflow fallbacks, MCP tools, studios, pipelines) reads the same
 * model instead of keeping its own literal. Before this table those literals
 * had drifted apart: the Generate Image node started on Nano Banana Pro, the
 * routes fell back to the original Nano Banana, and MCP used Nano Banana 2.1.
 *
 * Decided on 2026-10-08 from a blind five-model comparison, quality
 * first and price second:
 * - characters, general text-to-image and video anchors on GPT Image 2;
 * - edits on the current GPT Image Flare (2.6 since 2026-11-09), which renders
 *   at its default Medium when a run names no quality.
 * With reference images attached, GPT Image 2 runs as its i2i sibling (the
 * provider swaps it), so `character` covers identity-from-reference too.
 *
 * Nano Banana Pro is no longer a default. It remains a FALLBACK only: last in
 * the ratio chain below, the GPT-family safety-block retry, and the swimwear
 * dressing model.
 */
export const IMAGE_MODEL_ROLE_DEFAULTS = {
  character: "gpt-image-2",
  general: "gpt-image-2",
  anchor: "gpt-image-2",
  edit: "gpt-image-2-6-flare-i2i",
} as const

export type ImageModelRole = keyof typeof IMAGE_MODEL_ROLE_DEFAULTS

/**
 * Where a role's model goes when it cannot draw the requested aspect ratio.
 * GPT Image 2 draws only auto / 1:1 / 16:9 / 9:16 / 4:3 / 3:4, so 21:9, 3:2,
 * 2:3, 4:5, 5:4 and the other wide or in-between ratios move to GPT Image 2.6
 * Sunburst. GPT Image 2.5 Sunburst stays behind it for the ratios only 2.5
 * draws, and Nano Banana Pro comes last.
 */
export const IMAGE_MODEL_RATIO_FALLBACKS: Readonly<Record<ImageModelRole, readonly string[]>> = {
  character: ["gpt-image-2-6-sunburst", "gpt-image-2-5-sunburst", "nano-banana-pro"],
  general: ["gpt-image-2-6-sunburst", "gpt-image-2-5-sunburst", "nano-banana-pro"],
  anchor: ["gpt-image-2-6-sunburst", "gpt-image-2-5-sunburst", "nano-banana-pro"],
  edit: ["gpt-image-2-6-sunburst-i2i", "gpt-image-2-5-sunburst-i2i", "nano-banana-pro"],
}

/** True when the model's catalog entry lists the ratio (or no ratio was asked for). */
export function imageModelDrawsRatio(modelId: string, aspectRatio?: string | null): boolean {
  if (!aspectRatio) return true
  const ratios = MODEL_CATALOG[modelId]?.aspectRatios
  return ratios === undefined || ratios.includes(aspectRatio)
}

/**
 * The default image model for a role at the requested aspect ratio: the role's
 * model when it draws the ratio, else the first fallback that does, else the
 * role's model (whose own ratio normalization then snaps the ratio). Read from
 * the catalog, so widening a model's documented ratios moves this with it.
 */
export function defaultImageModel(role: ImageModelRole, aspectRatio?: string | null): string {
  const primary = IMAGE_MODEL_ROLE_DEFAULTS[role]
  if (imageModelDrawsRatio(primary, aspectRatio)) return primary
  return IMAGE_MODEL_RATIO_FALLBACKS[role].find((id) => imageModelDrawsRatio(id, aspectRatio)) ?? primary
}

/**
 * The model an image node that names none runs on, by node type: the same
 * default its route and its workflow branch apply. For the node types that
 * have one; undefined for any other.
 */
export function defaultImageModelForNode(nodeType: string, aspectRatio?: string | null): string | undefined {
  switch (nodeType) {
    case "generate-image":
      return defaultImageModel("general", aspectRatio)
    case "image-to-image":
    case "modify-image":
      return defaultImageModel("edit", aspectRatio)
    case "reference-board":
      return defaultImageModel("character", aspectRatio)
    default:
      return undefined
  }
}
