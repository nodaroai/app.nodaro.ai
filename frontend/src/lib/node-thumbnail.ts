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
  // Prefer `thumbnailUrl` (poster) over `url` so video results (.mp4) — which
  // can't render inside `<img>` — fall back to their poster image. For image
  // results, `thumbnailUrl` is typically a Cloudflare-resized variant of the
  // same image; either is fine.
  const generatedResults = data.generatedResults as
    | ReadonlyArray<{ url?: string; thumbnailUrl?: string }>
    | undefined
  if (Array.isArray(generatedResults) && generatedResults.length > 0) {
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
    const active = generatedResults[activeIndex] ?? generatedResults[0]
    const thumb = active?.thumbnailUrl
    const main = active?.url
    const url = typeof thumb === "string" && thumb.length > 0 ? thumb : main
    if (typeof url === "string" && url.length > 0) return url
  }

  // Common single-URL fields across image / video / audio nodes + identity refs.
  // `thumbnailUrl` is listed BEFORE video fields so a node carrying both
  // (poster + video) renders the poster, not the .mp4.
  for (const key of [
    "generatedImageUrl",
    "imageUrl",
    "url",
    "thumbnailUrl",
    "generatedVideoUrl",
    "videoUrl",
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
 * Returns the node's playable video URL, or `undefined` if there isn't one.
 *
 * Detection is conservative: per-result, a video result is one whose entry
 * has BOTH a `url` (the .mp4) AND a `thumbnailUrl` (the poster) — that's the
 * shape `poll-job.ts` writes for video jobs (image jobs leave `thumbnailUrl`
 * unset). Top-level fields `generatedVideoUrl` / `videoUrl` are taken as-is.
 */
export function getNodeVideoUrl(node: WorkflowNode | undefined): string | undefined {
  if (!node) return undefined
  const data = node.data as Record<string, unknown> | undefined
  if (!data) return undefined

  const generatedResults = data.generatedResults as
    | ReadonlyArray<{ url?: string; thumbnailUrl?: string }>
    | undefined
  if (Array.isArray(generatedResults) && generatedResults.length > 0) {
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
    const active = generatedResults[activeIndex] ?? generatedResults[0]
    const hasPoster = typeof active?.thumbnailUrl === "string" && active.thumbnailUrl.length > 0
    const url = active?.url
    if (hasPoster && typeof url === "string" && url.length > 0) return url
  }

  for (const key of ["generatedVideoUrl", "videoUrl"] as const) {
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
