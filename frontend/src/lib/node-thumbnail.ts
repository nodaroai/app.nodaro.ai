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

/** Per-type fallback: a node whose ONLY meaningful config is a single field
 *  with an ambiguous name we don't want to scan globally (`mode`, `field`,
 *  `separator`, `type`, …) — so it's keyed by node type instead. Fires only
 *  when the global field scan produced nothing. Keeps the summary deterministic
 *  rather than guessing field names. */
const SIMPLE_PARAM_FIELDS: Readonly<
  Record<string, { readonly field: string; readonly prefix?: string; readonly suffix?: string; readonly snippet?: boolean }>
> = {
  "scene-count": { field: "count", prefix: "× " },
  tone: { field: "tone" },
  motion: { field: "motion" },
  "style-guide": { field: "text", snippet: true },
  "text-prompt": { field: "text", snippet: true },
  // Utility / control-flow nodes — their lone config field has a generic name,
  // so it's scoped here per-type rather than scanned across every node.
  "combine-text": { field: "separator" },
  "split-text": { field: "separator" },
  "extract-field": { field: "field" },
  "json-process": { field: "mode" },
  "suno-separate": { field: "type" },
  "image-to-text": { field: "detailLevel" },
  "manual-edit": { field: "mode" },
  "merge-lists": { field: "mode" },
  "sort-list": { field: "field" },
  deduplicate: { field: "field" },
  reduce: { field: "strategyId" },
  "web-scrape": { field: "url", snippet: true },
  "rss-feed": { field: "feedUrl", snippet: true },
  "upload-audio": { field: "filename", snippet: true },
  "extract-frame": { field: "timestamp", suffix: "s" },
}

/** A well-known config field scanned across every non-picker node, in display
 *  order. The first present field in `fields` yields one chip; `render` shapes
 *  the value (and may return undefined to skip — e.g. a count of 1). ONE entry
 *  here covers that field for every node type that uses the name, so new nodes
 *  reusing these conventional fields are summarized with no per-type code. */
interface ConfigFieldSpec {
  readonly key: string
  readonly fields: readonly string[]
  readonly icon?: "ratio"
  readonly render?: (value: string | number) => string | undefined
}

const CONFIG_FIELDS: readonly ConfigFieldSpec[] = [
  // Aspect ratio: generator `aspectRatio`, aspect-ratio node `ratio`, resize `targetAspect`.
  { key: "aspect", fields: ["aspectRatio", "ratio", "targetAspect"], icon: "ratio" },
  { key: "resolution", fields: ["resolution", "quality"] },
  { key: "upscale", fields: ["upscaleFactor"], render: (v) => `${v}×` },
  // Duration in seconds — duration node (`seconds`), video generators (`duration`),
  // composition/FX nodes (`durationSeconds`), split-media (`chunkDuration`).
  {
    key: "duration",
    fields: ["seconds", "duration", "durationSeconds", "chunkDuration"],
    render: (v) => (typeof v === "number" && v > 0 ? `${v}s` : undefined),
  },
  { key: "fps", fields: ["fps"], render: (v) => (typeof v === "number" && v > 0 ? `${v} fps` : undefined) },
  { key: "voice", fields: ["voiceName", "voiceId", "voiceLabel"] },
  { key: "language", fields: ["language", "targetLanguage"] },
  { key: "style", fields: ["style"], render: (v) => (typeof v === "string" ? snippet(v, 24) : undefined) },
  { key: "voiceDesc", fields: ["voiceDescription"], render: (v) => (typeof v === "string" ? snippet(v, 28) : undefined) },
  { key: "platform", fields: ["platform"] },
  { key: "format", fields: ["format", "codec"] },
  { key: "versions", fields: ["versions"], render: (v) => (typeof v === "number" && v > 1 ? `${v} versions` : undefined) },
  { key: "repeat", fields: ["repeatCount"], render: (v) => (typeof v === "number" && v > 1 ? `× ${v}` : undefined) },
]

/** First field in `fields` whose value is a non-empty string or finite number. */
function firstFieldValue(
  data: Record<string, unknown>,
  fields: readonly string[],
): string | number | undefined {
  for (const f of fields) {
    const v = data[f]
    if (typeof v === "string" && v.trim().length > 0) return v
    if (typeof v === "number" && Number.isFinite(v)) return v
  }
  return undefined
}

function asIdArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim().length > 0 ? [value] : []
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
  return []
}

/** Collapse whitespace and truncate to `max` chars with an ellipsis. Shared by
 *  the config summary and the search-modal row description. */
export function snippet(text: string, max = 48): string {
  const trimmed = text.trim().replace(/\s+/g, " ")
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** Build the capped catalog-label chips for a picker's selected ids, collapsing
 *  the overflow into a `+N` chip. Shared by the single- and multi-dim branches. */
function pickerChips(ids: readonly string[], labels: ReadonlyMap<string, string>): NodeConfigChip[] {
  const chips: NodeConfigChip[] = ids
    .slice(0, MAX_PICKER_CHIPS)
    .map((id, i) => ({ key: `pick-${i}`, value: labels.get(id) ?? id }))
  if (ids.length > MAX_PICKER_CHIPS) {
    chips.push({ key: "more", value: `+${ids.length - MAX_PICKER_CHIPS}` })
  }
  return chips
}

/**
 * Resolves a node's meaningful configuration into compact chips, shared by the
 * canvas search modal and the handle (connect) popover so both surfaces show
 * the same data.
 *
 * - Parameter pickers: selected id(s) → catalog labels, resolved through the
 *   picker registry's OWN catalog (single source of truth — new pickers AND
 *   drifted multi-picker dimensions work automatically). `string | string[]`,
 *   capped at `MAX_PICKER_CHIPS`.
 * - Generators / media / everything else: provider (or "N models") / model, then
 *   the `CONFIG_FIELDS` registry (aspect, resolution, duration, fps, voice,
 *   language, style, platform, format, …) — one ordered list scanned for every
 *   node, so coverage is data-driven rather than per-type.
 * - Per-type fallback (`SIMPLE_PARAM_FIELDS`): a node whose only config is one
 *   ambiguously-named field (scene-count, tone, separator, mode, …).
 */
export function getNodeConfigSummary(node: WorkflowNode | undefined): NodeConfigChip[] {
  if (!node?.type) return []
  const data = (node.data ?? {}) as Record<string, unknown>

  // ── Parameter pickers: resolve selected ids → labels via the catalog ──
  const meta = getParameterPickerMeta(node.type)
  if (meta) {
    if (meta.kind === "single") {
      const labels = new Map(meta.entries.map((e) => [e.id, e.label] as const))
      return pickerChips(asIdArray(data[meta.valueField]), labels)
    }
    // Multi-dim picker. The flattened catalog is the single source of truth for
    // "this id is a configured dimension", so resolve selected values through it
    // rather than trusting the registry's hand-listed `fields` to be complete:
    // read the declared fields first (stable, intended order), THEN any OTHER
    // data key whose value resolves to a catalog label. That second pass picks
    // up dimensions the `fields` array has drifted behind (styling's
    // outfit/top/bottom, lighting's colorTemperature, …) with zero per-picker
    // maintenance.
    const labels = new Map(meta.catalogEntries.map((e) => [e.id, e.label] as const))
    const ids: string[] = []
    const seen = new Set<string>()
    const add = (raw: unknown, gated: boolean) => {
      for (const id of asIdArray(raw)) {
        if (seen.has(id) || (gated && !labels.has(id))) continue
        seen.add(id)
        ids.push(id)
      }
    }
    const declared = new Set(meta.fields)
    for (const field of meta.fields) add(data[field], false)
    for (const key of Object.keys(data)) if (!declared.has(key)) add(data[key], true)
    return pickerChips(ids, labels)
  }

  // ── Generators / media / simple params ──
  const out: NodeConfigChip[] = []

  // Provider/model: bespoke "N models" collapse for multi-provider nodes; else
  // the single provider; else a model id (`model`, or the LLM nodes' `llmModel`).
  const provider = typeof data.provider === "string" ? data.provider : undefined
  const providers = Array.isArray(data.providers) ? (data.providers as string[]) : undefined
  const model =
    (typeof data.model === "string" && data.model) ||
    (typeof data.llmModel === "string" && data.llmModel) ||
    undefined
  if (providers && providers.length > 1) {
    out.push({ key: "provider", value: `${providers.length} models` })
  } else if (provider) {
    out.push({ key: "provider", value: provider })
  } else if (model) {
    out.push({ key: "model", value: model })
  }

  // Well-known config fields, scanned in display order (single source of truth
  // for which fields surface, across all node types — see CONFIG_FIELDS).
  for (const spec of CONFIG_FIELDS) {
    const v = firstFieldValue(data, spec.fields)
    if (v === undefined) continue
    const value = spec.render ? spec.render(v) : String(v)
    if (value) out.push({ key: spec.key, value, icon: spec.icon })
  }

  // Per-type fallback for ambiguous single-field nodes, only if nothing matched.
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
