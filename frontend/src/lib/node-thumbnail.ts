import type { ReactNode } from "react"
import type { WorkflowNode } from "@/types/nodes"
import { getParameterPickerMeta } from "./parameter-picker-registry"

/**
 * Extracts a thumbnail URL for a node, if any. Walks common image-bearing
 * data fields across the node families (generators, uploads, identity refs).
 * Returns `undefined` if the node has no image URL — callers should fall
 * back to `getNodePickerVisual` or a category icon.
 *
 * Kept liberal on the field list rather than per-type-discriminated so it
 * naturally picks up any node that happens to store an image URL in a
 * conventionally-named field.
 */
export function getNodeThumbnailUrl(node: WorkflowNode | undefined): string | undefined {
  if (!node) return undefined
  const data = node.data as Record<string, unknown> | undefined
  if (!data) return undefined

  // Generators: active result first, then top-level fallback fields.
  const generatedResults = data.generatedResults as ReadonlyArray<{ url?: string }> | undefined
  if (Array.isArray(generatedResults) && generatedResults.length > 0) {
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
    const url = generatedResults[activeIndex]?.url ?? generatedResults[0]?.url
    if (typeof url === "string" && url.length > 0) return url
  }

  // Common single-URL fields across image / video / audio nodes + identity refs.
  for (const key of [
    "generatedImageUrl",
    "imageUrl",
    "url",
    "generatedVideoUrl",
    "videoUrl",
    "thumbnailUrl",
    "referenceImageUrl",
    "mainImageUrl",
    "portraitUrl",
  ] as const) {
    const v = (data as Record<string, unknown>)[key]
    if (typeof v === "string" && v.length > 0) return v
  }

  return undefined
}

/**
 * For parameter-picker nodes (Setting, Mood, Style, Lens, Lighting, etc.),
 * returns the same in-node visual that the node body itself shows —
 * looked up via `getParameterPickerMeta(node.type).renderIcon(value)`.
 * Returns `undefined` for non-picker nodes OR pickers without a renderIcon
 * (the multi-dimensional pickers don't supply a single-glyph render).
 */
export function getNodePickerVisual(node: WorkflowNode | undefined): ReactNode | undefined {
  if (!node) return undefined
  const meta = getParameterPickerMeta(node.type)
  if (!meta || meta.kind !== "single" || !meta.renderIcon) return undefined
  const data = (node.data ?? {}) as Record<string, unknown>
  const value = data[meta.valueField] as string | undefined
  if (!value || typeof value !== "string") return undefined
  return meta.renderIcon(value)
}
