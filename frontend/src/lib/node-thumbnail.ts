import type { ReactNode } from "react"
import type { WorkflowNode } from "@/types/nodes"
import { getParameterPickerMeta } from "./parameter-picker-registry"

/** Matches URLs whose extension is a known video container. Used so a node
 *  field that happens to hold a video URL (e.g. a character's starred motion
 *  default in `defaultAssetUrl`) is routed to `<video>` rather than `<img>`. */
function looksLikeVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)
}

/**
 * Extracts a thumbnail URL for a node, if any. Walks common image-bearing
 * data fields across the node families (generators, uploads, identity refs).
 * Returns `undefined` if the node has no image URL — callers should fall
 * back to `getNodePickerVisual` or a category icon.
 *
 * Kept liberal on the field list rather than per-type-discriminated so it
 * naturally picks up any node that happens to store an image URL in a
 * conventionally-named field. Values that look like video URLs are skipped
 * so an `.mp4` never lands inside an `<img>` — `getNodeVideoUrl` picks those
 * up instead.
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
    if (typeof thumb === "string" && thumb.length > 0) return thumb
    if (typeof main === "string" && main.length > 0 && !looksLikeVideoUrl(main)) return main
  }

  // Common single-URL fields across image / video / audio nodes + identity
  // refs (character `defaultAssetUrl`/`sourceImageUrl`, youtube/reference-audio
  // posters). `thumbnailUrl` and the poster fields are listed BEFORE video
  // fields so a node carrying both renders the poster, not the .mp4. Any value
  // that looks like a video URL is skipped (handled by `getNodeVideoUrl`).
  for (const key of [
    "generatedImageUrl",
    "imageUrl",
    "url",
    "thumbnailUrl",
    "downloadedThumbnailUrl",
    "videoThumbnail",
    "defaultAssetUrl",
    "sourceImageUrl",
    "generatedVideoUrl",
    "videoUrl",
    "referenceImageUrl",
    "mainImageUrl",
    "portraitUrl",
    "generatedMaskUrl",
  ] as const) {
    const v = (data as Record<string, unknown>)[key]
    if (typeof v === "string" && v.length > 0 && !looksLikeVideoUrl(v)) return v
  }

  return undefined
}

/**
 * Returns the node's playable video URL, or `undefined` if there isn't one.
 *
 * Detection is conservative: per-result, a video result is one whose entry
 * has BOTH a `url` (the .mp4) AND a `thumbnailUrl` (the poster) — that's the
 * shape `poll-job.ts` writes for video jobs (image jobs leave `thumbnailUrl`
 * unset). Top-level fields `generatedVideoUrl` / `videoUrl` are taken as-is,
 * and a `defaultAssetUrl` is taken only when its extension looks like video
 * (a character/location's starred motion clip).
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
  const def = data.defaultAssetUrl
  if (typeof def === "string" && looksLikeVideoUrl(def)) return def
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

/** A compact, render-agnostic config descriptor — the data both the canvas
 *  search modal and the handle popover surface for a node. `icon: "ratio"`
 *  asks the renderer to draw the aspect-ratio glyph next to the value. */
export interface NodeConfigChip {
  readonly key: string
  readonly value: string
  readonly icon?: "ratio"
}

/** Max picker value chips shown before collapsing the rest into a `+N` chip. */
const MAX_PICKER_CHIPS = 4

/** Value field map for the handful of simple parameter nodes that are NOT in
 *  the picker registry (no catalog) — their single meaningful scalar. Keeps
 *  the summary deterministic rather than guessing field names. */
const SIMPLE_PARAM_FIELDS: Readonly<
  Record<string, { readonly field: string; readonly prefix?: string; readonly suffix?: string; readonly snippet?: boolean }>
> = {
  "scene-count": { field: "count", prefix: "× " },
  tone: { field: "tone" },
  motion: { field: "motion" },
  "style-guide": { field: "text", snippet: true },
  "text-prompt": { field: "text", snippet: true },
}

function asIdArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim().length > 0 ? [value] : []
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
  return []
}

function snippet(text: string, max = 48): string {
  const trimmed = text.trim().replace(/\s+/g, " ")
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/**
 * Resolves a node's meaningful configuration into compact chips, shared by the
 * canvas search modal and the handle (connect) popover so both surfaces show
 * the same data.
 *
 * - Parameter pickers: selected id(s) → catalog labels, resolved through the
 *   picker registry's OWN catalog (single source of truth — new pickers work
 *   automatically). Handles `string | string[]`, caps at `MAX_PICKER_CHIPS`.
 * - Generators / media: provider (or "N models"), model, aspect ratio,
 *   resolution/quality, duration, voice, repeat count.
 * - Simple param nodes (scene-count, tone, …): their single scalar value.
 */
export function getNodeConfigSummary(node: WorkflowNode | undefined): NodeConfigChip[] {
  if (!node?.type) return []
  const data = (node.data ?? {}) as Record<string, unknown>

  // ── Parameter pickers: resolve selected ids → labels via the catalog ──
  const meta = getParameterPickerMeta(node.type)
  if (meta) {
    const labels = new Map<string, string>()
    if (meta.kind === "single") {
      for (const e of meta.entries) labels.set(e.id, e.label)
    } else {
      for (const e of meta.catalogEntries) labels.set(e.id, e.label)
    }
    const ids: string[] = []
    if (meta.kind === "single") {
      ids.push(...asIdArray(data[meta.valueField]))
    } else {
      for (const field of meta.fields) ids.push(...asIdArray(data[field]))
    }
    const chips: NodeConfigChip[] = ids
      .slice(0, MAX_PICKER_CHIPS)
      .map((id, i) => ({ key: `pick-${i}`, value: labels.get(id) ?? id }))
    if (ids.length > MAX_PICKER_CHIPS) {
      chips.push({ key: "more", value: `+${ids.length - MAX_PICKER_CHIPS}` })
    }
    return chips
  }

  // ── Generators / media / simple params ──
  const out: NodeConfigChip[] = []

  const provider = typeof data.provider === "string" ? data.provider : undefined
  const providers = Array.isArray(data.providers) ? (data.providers as string[]) : undefined
  if (providers && providers.length > 1) {
    out.push({ key: "provider", value: `${providers.length} models` })
  } else if (provider) {
    out.push({ key: "provider", value: provider })
  } else if (typeof data.model === "string" && data.model) {
    out.push({ key: "model", value: data.model })
  }

  // Aspect ratio: generator `aspectRatio`, or the aspect-ratio node's `ratio`.
  const aspect =
    (typeof data.aspectRatio === "string" && data.aspectRatio) ||
    (typeof data.ratio === "string" && data.ratio) ||
    undefined
  if (aspect) out.push({ key: "aspect", value: aspect, icon: "ratio" })

  if (typeof data.resolution === "string" && data.resolution) {
    out.push({ key: "resolution", value: data.resolution })
  } else if (typeof data.quality === "string" && data.quality) {
    out.push({ key: "quality", value: data.quality })
  }

  // Duration: a `seconds`/`duration` number (duration node + video generators).
  const seconds =
    typeof data.seconds === "number" ? data.seconds : typeof data.duration === "number" ? data.duration : undefined
  if (typeof seconds === "number" && seconds > 0) out.push({ key: "duration", value: `${seconds}s` })

  const voice =
    (typeof data.voiceName === "string" && data.voiceName) ||
    (typeof data.voiceId === "string" && data.voiceId) ||
    undefined
  if (voice) out.push({ key: "voice", value: voice })

  const repeat = data.repeatCount as number | undefined
  if (typeof repeat === "number" && repeat > 1) out.push({ key: "repeat", value: `× ${repeat}` })

  // Simple single-value param nodes not covered above.
  if (out.length === 0) {
    const simple = SIMPLE_PARAM_FIELDS[node.type]
    if (simple) {
      const v = data[simple.field]
      if (typeof v === "string" && v.trim().length > 0) {
        out.push({ key: "value", value: simple.snippet ? snippet(v) : v })
      } else if (typeof v === "number") {
        out.push({ key: "value", value: `${simple.prefix ?? ""}${v}${simple.suffix ?? ""}` })
      }
    }
  }

  return out.slice(0, 5)
}
