/**
 * Which photo an image node's "auto" aspect ratio keeps the shape of, read
 * from the run's graph — shared by the payload builder, which sends it, and
 * the size read ahead of the synchronous build (`source-size-build.ts`). One
 * definition, so the size the run reads is always the size of the image the
 * provider is sent.
 *
 * A source-image node (image-to-image / modify-image / edit-image) transforms
 * its wired or stored image, known before the build. Generate Image's photo is
 * the first image its references ASSEMBLE to (or its inpaint / refine base),
 * known only once the build has run — `generateImageMayUsePhotoSize` says when
 * it is worth finding.
 */
import { SOURCE_IMAGE_NODE_TYPES, autoAspectNeedsSourceImage, defaultImageModel, imageGenAutoAspectNeedsSourceImage } from "@nodaro/shared"
import { savedOutputFor } from "./output-extractor.js"
import type { NodeExecutionState, ResolvedInputs, SimpleEdge, SimpleNode } from "./types.js"

/** The slice of the run's graph these helpers read (a `PayloadBuildContext` satisfies it). */
export interface SourceImageGraph {
  nodes?: SimpleNode[]
  edges?: SimpleEdge[]
  nodeStates?: Record<string, NodeExecutionState>
}

/** `items` in the user's `order` (ids it names first, the rest after, in their original order). */
export function applyOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  if (!order.length) return [...items]
  const ordered: T[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const item = items.find((i) => i.id === id)
    if (item) {
      ordered.push(item)
      seen.add(id)
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      ordered.push(item)
    }
  }
  return ordered
}

/** Get image URL from execution state, falling back to saved node data (matches frontend) — only for a node this run did not run or gate. */
export function getNodeImageUrl(
  node: SimpleNode,
  nodeStates: Record<string, NodeExecutionState>,
): string | undefined {
  return nodeStates[node.id]?.output?.imageUrl ?? savedOutputFor(node, nodeStates[node.id])?.imageUrl
}

/** The model an image-to-image / modify-image / edit-image node runs on: its
 *  own `provider`, else the default each of those branches applies. */
export function sourceImageNodeProvider(type: string, data: Record<string, unknown>): string {
  return (data.provider as string)
    ?? (type === "edit-image" ? "recraft-upscale" : defaultImageModel("edit", data.aspectRatio as string | undefined))
}

/** The model a Generate Image node runs on: its own `provider`, else the
 *  platform's general default for its ratio — the default the generate-image
 *  branch applies. */
export function generateImageNodeProvider(data: Record<string, unknown>): string {
  return (data.provider as string) ?? defaultImageModel("general", data.aspectRatio as string | undefined)
}

/**
 * True when a Generate Image node asks for "auto" on a model that can lack a
 * native auto — the only case where its photo's size can change what the build
 * sends, and so the only case worth building to find the photo. Before its
 * references assemble the build may snap against the node's model or the i2i
 * sibling references swap it to, so this asks about both; the build step then
 * asks again with the references it assembled (`generateImageAutoNeedsPhotoSize`).
 */
export function generateImageMayUsePhotoSize(node: SimpleNode): boolean {
  return node.type === "generate-image" &&
    imageGenAutoAspectNeedsSourceImage({ provider: generateImageNodeProvider(node.data), aspectRatio: node.data.aspectRatio })
}

/**
 * Whether a built Generate Image payload's "auto" needs its photo's size: the
 * model the build snapped against — `normalizedImageGenModelId` with the
 * ASSEMBLED reference count, the same inputs the build's
 * `resolveNormalizedImageGen` call took — has no native auto.
 */
export function generateImageAutoNeedsPhotoSize(node: SimpleNode, assembledRefCount: number): boolean {
  return imageGenAutoAspectNeedsSourceImage({
    provider: generateImageNodeProvider(node.data),
    aspectRatio: node.data.aspectRatio,
    refCount: assembledRefCount,
  })
}

/** The image a source-image node transforms (`main`) and, when the user
 *  reordered the wired media (`connectedMediaOrder`), the rest in that order.
 *  The reorder promotes its first wired image to the main slot; without one the
 *  wired / stored `imageUrl` is the main and `rest` is undefined, so each branch
 *  keeps its own reference default. */
export function orderedSourceImages(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  graph: SourceImageGraph | undefined,
): { main: unknown; rest?: string[] } {
  const main = resolvedInputs.imageUrl || node.data.imageUrl
  const order = node.data.connectedMediaOrder as string[] | undefined
  if (!order?.length || !resolvedInputs.referenceImageUrls?.length) return { main }
  const allNodes = graph?.nodes ?? []
  const states = graph?.nodeStates ?? {}
  const sourceNodes = (graph?.edges ?? [])
    .filter((e) => e.target === node.id)
    .map((e) => allNodes.find((n) => n.id === e.source))
    .filter((n): n is SimpleNode => !!n)
  const orderedUrls = applyOrder(sourceNodes, order)
    .map((n) => getNodeImageUrl(n, states))
    .filter((u): u is string => !!u)
  return orderedUrls.length > 0 ? { main: orderedUrls[0], rest: orderedUrls.slice(1) } : { main }
}

/**
 * The url whose size decides this node's "auto" aspect ratio, or undefined when
 * the build will not use a size: only a source-image node
 * (`SOURCE_IMAGE_NODE_TYPES`) asking for "auto" on a model without a native
 * auto. The caller reads the size (the builder is synchronous) and hands it
 * back as `PayloadBuildContext.sourceImage`.
 */
export function autoAspectSourceImageUrl(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  graph?: SourceImageGraph,
): string | undefined {
  if (!SOURCE_IMAGE_NODE_TYPES.has(node.type)) return undefined
  if (!autoAspectNeedsSourceImage(sourceImageNodeProvider(node.type, node.data), node.data.aspectRatio)) return undefined
  const { main } = orderedSourceImages(node, resolvedInputs, graph)
  return typeof main === "string" && main.length > 0 ? main : undefined
}
