import { NODE_DEFINITIONS } from "@/types/nodes"

/**
 * Derives the focused node's previewable result media for the fullscreen
 * lightbox (Alt+F). Data-driven on purpose: the media type comes from the
 * node's declared `exposableOutputs` and the URLs from the shared
 * `generatedResults` shape (with a single-field fallback), so new media nodes
 * work here without edits. Text/data outputs are intentionally not previewable.
 */

export type FocusedMediaType = "image" | "video" | "audio"

export interface FocusedNodeMedia {
  readonly type: FocusedMediaType
  /** URL of the currently-active result (what a single-result modal shows). */
  readonly url: string
  /** Every result, for the modal's prev/next carousel. */
  readonly results: ReadonlyArray<{ url: string; type: FocusedMediaType }>
  /** Index of the active result within `results`. */
  readonly initialIndex: number
}

const MEDIA_TYPES: ReadonlySet<string> = new Set(["image", "video", "audio"])

const SINGLE_FIELD: Record<FocusedMediaType, string> = {
  video: "generatedVideoUrl",
  image: "generatedImageUrl",
  audio: "generatedAudioUrl",
}

/** The node's primary previewable media type, from its declared outputs. */
function primaryMediaType(nodeType: string | null | undefined): FocusedMediaType | null {
  const def = NODE_DEFINITIONS.find((d) => d.type === nodeType)
  for (const out of def?.exposableOutputs ?? []) {
    if (MEDIA_TYPES.has(out.outputType)) return out.outputType as FocusedMediaType
  }
  return null
}

export function getFocusedNodeMedia(
  node: { type?: string | null; data?: unknown } | null | undefined,
): FocusedNodeMedia | null {
  if (!node) return null
  const type = primaryMediaType(node.type)
  if (!type) return null

  const data = (node.data ?? {}) as Record<string, unknown>
  const rawResults = Array.isArray(data.generatedResults) ? data.generatedResults : []

  let urls = rawResults
    .map((r) => (r && typeof (r as { url?: unknown }).url === "string" ? (r as { url: string }).url : null))
    .filter((u): u is string => !!u)

  if (urls.length === 0) {
    const single = data[SINGLE_FIELD[type]]
    if (typeof single === "string" && single) urls = [single]
  }

  if (urls.length === 0) return null

  const rawIndex = typeof data.activeResultIndex === "number" ? data.activeResultIndex : 0
  const initialIndex = Math.min(Math.max(rawIndex, 0), urls.length - 1)

  return {
    type,
    url: urls[initialIndex],
    results: urls.map((url) => ({ url, type })),
    initialIndex,
  }
}
