/**
 * The image models whose price depends on how many input images a run sends:
 * GPT Image 2.6 Flare and Sunburst, MiniMax H3 Image, Seedream 5.5 and Kling Image
 * 4.0 (by input item: a reference image or a named subject). Every place that
 * prices a run counts those images through here, so a model that joins
 * `isPricedPerInputImage` is counted on every path at once. FLUX 3 Klein is
 * counted the same way (`priceReadsInputImages`): its price does not move with
 * the images, but whether any go decides the id it runs, and is priced, on.
 */
import {
  GPT_IMAGE_2_6_MOODBOARD_MAX_IMAGES,
  isGptImage26I2i,
  isGptImage26Tiered,
} from "./gpt-image-2-6.js"
import { isMinimaxH3Image, isMinimaxH3ImageI2i } from "./minimax-h3-image.js"
import { isSeedream55, isSeedream55I2i } from "./seedream-5-5.js"
import { isKlingImage4, isKlingImage4I2i } from "./kling-image-4.js"
import { isFlux3Klein } from "./flux-3-klein.js"
import { klingImage4EstimatedItems, type ImageInputGraphEdge, type ImageInputGraphNode } from "./kling-image-4-items.js"

/** The node an estimate prices and the graph around it. */
export interface ImageInputGraph {
  readonly nodeId: string
  readonly nodes: readonly ImageInputGraphNode[]
  readonly edges: readonly ImageInputGraphEdge[]
}

/** True for a model whose price counts the input images a run sends. */
export function isPricedPerInputImage(model: unknown): boolean {
  return typeof model === "string" && (isGptImage26Tiered(model) || isMinimaxH3Image(model) || isSeedream55(model) || isKlingImage4(model))
}

/** True for the edit id of such a model: it always sends at least its source. */
export function isPricedPerInputImageEdit(model: unknown): boolean {
  return typeof model === "string" && (isGptImage26I2i(model) || isMinimaxH3ImageI2i(model) || isSeedream55I2i(model) || isKlingImage4I2i(model))
}

/**
 * True for a model whose price id reads the input images a run sends: one
 * priced per input image ({@link isPricedPerInputImage}), or FLUX 3 Klein, which
 * runs on its edit id whenever an image goes (its text-to-image endpoint takes
 * none) and is priced on that id, at the same price. Every place that prices a
 * run counts the images through {@link pricedSentImages} and
 * {@link pricedEstimatedImages} for such a model, so the id priced is the id
 * the provider runs.
 */
export function priceReadsInputImages(model: unknown): boolean {
  return isPricedPerInputImage(model) || isFlux3Klein(model)
}

/**
 * The images a Generate Image run sends its provider: its references and, when
 * it edits a base image, that image too (the worker puts it first, unless it is
 * already one of the references). The base is counted only on a model whose
 * price reads the images ({@link priceReadsInputImages}); any other model is
 * priced, and held to its image limit, on its references alone, as before.
 */
export function pricedSentImages(
  provider: string | undefined,
  references: readonly string[],
  baseImageUrl: unknown,
): number {
  const countsBase =
    priceReadsInputImages(provider) &&
    typeof baseImageUrl === "string" &&
    baseImageUrl.length > 0 &&
    !references.includes(baseImageUrl)
  // Kling Image 4.0 sends each image once (its body builder drops a repeat),
  // so a repeated reference is priced, and held to the limit, once.
  const sent = isKlingImage4(provider) ? new Set(references).size : references.length
  return sent + (countsBase ? 1 : 0)
}

/**
 * The images an Image to Image run sends its provider: its source and its
 * references. Kling Image 4.0 sends each image once (a repeat, the source
 * included, is dropped by its body builder), so it is counted once; every
 * other model is counted as written, as always.
 */
export function imageToImageSentImages(provider: string | undefined, source: unknown, references: readonly string[] | undefined): number {
  const refs = references ?? []
  if (!isKlingImage4(provider)) return 1 + refs.length
  return new Set([...(typeof source === "string" && source.length > 0 ? [source] : []), ...refs]).size
}

function namesMoodboard(direction: unknown): boolean {
  if (direction === null || typeof direction !== "object") return false
  const style = (direction as Record<string, unknown>).style
  return (Array.isArray(style) ? style : [style]).some(
    (value) => typeof value === "string" && value.startsWith("moodboard:"),
  )
}

/**
 * The input images a workflow estimate counts for one node on a model whose
 * price reads them ({@link priceReadsInputImages}): every list on the node, its source or base image, what is
 * wired in, a moodboard its direction names (at the most a moodboard holds),
 * and an edit model's own source. An estimate may over-quote, never under.
 */
export function pricedEstimatedImages(
  model: string,
  data: Record<string, unknown>,
  wiredImages: number,
  graph?: ImageInputGraph,
): number {
  // Kling Image 4.0 counts input items, as its run does: with the graph, each
  // character's views are grouped and each image counted once.
  if (graph && isKlingImage4(model)) return klingImage4EstimatedItems(model, data, graph.nodeId, graph.nodes, graph.edges)
  const listed = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  const single = (v: unknown) => (typeof v === "string" && v.length > 0 ? 1 : 0)
  return (
    listed(data.referenceImageUrls) +
    listed(data.characterDefinitionIds) +
    listed(data.extraRefs) +
    single(data.referenceImageUrl) +
    single(data.baseImageUrl) +
    single(data.sourceImageUrl) +
    wiredImages +
    (namesMoodboard(data.direction) ? GPT_IMAGE_2_6_MOODBOARD_MAX_IMAGES : 0) +
    (isPricedPerInputImageEdit(model) ? 1 : 0)
  )
}
