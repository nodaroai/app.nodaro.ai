/**
 * Workflow-node parameter normalization.
 *
 * The config panels already prevent an impossible provider/parameter pair from
 * being *selected*: their dropdowns are provider-aware and a fail-safe effect
 * snaps stale values when the provider changes. But both of those are React
 * effects — they only run when that specific node's panel or hover strip is
 * mounted. A node written straight into workflow JSON by a non-UI author (an
 * agent, an import, a template) is never seen by either, so its invalid pair
 * survives all the way to the provider call.
 *
 * That is the 2026-08-09 incident: one `generate-image` node carrying
 * `gpt-image` + `16:9` (GPT Image 1.5 renders 1:1 / 3:2 / 2:3 only) reached KIE,
 * got rejected, and aborted a run whose five sibling nodes had already produced
 * — and billed for — their images.
 *
 * This module is the write-boundary guard: it heals the node instead of
 * rejecting it, so the user sees a valid value on the canvas rather than a
 * failed run. It reads exclusively from `MODEL_CATALOG`, so a model added later
 * is covered without touching this file.
 *
 * Besides the image trio below, it holds three single levers: a Video Upscale
 * node's `targetResolution`, a Motion Transfer node's `resolution`, and a
 * video node's stored Seedance reference task type (`referenceTaskType`,
 * removed where no model the node runs lists it).
 */

import { autoAspectNeedsSourceImage, MODEL_CATALOG, normalizeModelInput, type ModelInputAdjustment, type ModelInputAdjustmentField } from "./model-catalog.js"
import { imageGenAutoAspectNeedsSourceImage, motionTransferResolution } from "./credit-identifiers.js"
import { normalizeVideoUpscaleResolution, VIDEO_UPSCALE_RESOLUTIONS, videoUpscaleResolutionsFor } from "./video-upscale-params.js"
import {
  applyDefaultVideoSelection,
  DEFAULT_VIDEO_TO_VIDEO_PROVIDER,
  LEGACY_VIDEO_NODE_DEFAULT_PROVIDER,
  listedSeedanceTaskType,
  resolveVideoProviderForMode,
} from "./model-constants.js"

/**
 * Node types whose `data` carries catalog-governed model parameters under the
 * shape this module understands (`provider` + aspectRatio/resolution/quality).
 *
 * IMAGE ONLY, deliberately. The video nodes route several of these fields
 * through mode-dependent defaults (`"adaptive"` for Seedance/Hailuo, duration
 * composites tied to pricing) that this flat normalizer would flatten wrongly;
 * they get their own pass once those defaults are catalog-derived too.
 *
 * `modify-image` carries the same provider/aspectRatio/resolution/quality trio
 * as `image-to-image` (it routes through the same worker), and `edit-image`
 * carries provider + aspectRatio. `edit-image`'s `targetResolution` is an
 * UPSCALE target, a different field this module never reads — so listing the
 * type here heals its ratio without touching what it is priced on.
 */
export const MODEL_PARAM_NODE_TYPES: ReadonlySet<string> = new Set([
  "generate-image",
  "image-to-image",
  "modify-image",
  "edit-image",
])

/**
 * The image node types that transform a SOURCE image (their required `image`
 * input). On these "auto" means "keep the source photo's shape", and the run
 * resolves it against that image — natively on a model that lists "auto", else
 * to the model's nearest listed ratio (`normalizeModelInput`'s `sourceImage`).
 *
 * `generate-image` is absent: its photo is optional, and it is the first image
 * its references ASSEMBLE to, not a node input — see
 * `AUTO_ASPECT_AT_RUN_NODE_TYPES`.
 */
export const SOURCE_IMAGE_NODE_TYPES: ReadonlySet<string> = new Set([
  "image-to-image",
  "modify-image",
  "edit-image",
])

/**
 * The node types whose "auto" aspect ratio the RUN resolves against a photo,
 * so a write boundary (which has no photo) keeps it: the source-image types,
 * plus `generate-image`, whose photo is the first reference the run assembles
 * (or its inpaint / refine base). A Generate Image run with no photo snaps
 * "auto" exactly as this boundary used to — the value that reaches a provider
 * never changes there.
 */
export const AUTO_ASPECT_AT_RUN_NODE_TYPES: ReadonlySet<string> = new Set([
  ...SOURCE_IMAGE_NODE_TYPES,
  "generate-image",
])

/**
 * The image nodes whose aspect-ratio dropdown leads with the photo "Auto" tile
 * (Generate Image and Modify Image: `withPhotoAuto` in the editor). On these an
 * UNSET ratio IS Auto — the dropdown shows Auto for it, and both engines send
 * "auto" for it — so what the editor shows is what the run asks for.
 *
 * It used to send nothing, which handed the ratio to the provider's own
 * default (16:9 on nearly every model) while the panel displayed "Auto" or the
 * model's first listed ratio: a 3:4 photo through Modify Image came back 16:9
 * (#2009). "auto" then resolves exactly as a chosen Auto does — natively on a
 * model that lists it, else to the model's ratio nearest the photo, else (no
 * photo) the model's first listed ratio.
 */
export const PHOTO_AUTO_ASPECT_NODE_TYPES: ReadonlySet<string> = new Set([
  "generate-image",
  "modify-image",
])

/**
 * The aspect ratio a node asks for: its stored value, or "auto" when it is
 * unset on a photo-Auto node (`PHOTO_AUTO_ASPECT_NODE_TYPES`). Every other node
 * type gets its value back unchanged (undefined stays undefined).
 */
export function nodeAspectRatio(nodeType: "generate-image" | "modify-image", aspectRatio: unknown): string
export function nodeAspectRatio(nodeType: string | undefined, aspectRatio: unknown): string | undefined
export function nodeAspectRatio(nodeType: string | undefined, aspectRatio: unknown): string | undefined {
  if (typeof aspectRatio === "string" && aspectRatio.trim() !== "") return aspectRatio
  return nodeType !== undefined && PHOTO_AUTO_ASPECT_NODE_TYPES.has(nodeType) ? "auto" : undefined
}

export interface NodeParamAdjustment extends Omit<ModelInputAdjustment, "field"> {
  /** A catalog-governed parameter, or a video node's stored `referenceTaskType` (always removed: `to` is undefined). */
  field: ModelInputAdjustmentField | "referenceTaskType"
  nodeId: string
  provider: string
}

export interface NormalizedNodes<T> {
  nodes: T[]
  /** Empty when nothing needed correcting. */
  adjustments: NodeParamAdjustment[]
}

interface NodeLike {
  id?: unknown
  type?: unknown
  data?: unknown
}

/**
 * Return `nodes` with every catalog-governed image parameter coerced into a
 * combination its provider actually accepts, plus the list of what changed.
 *
 * Immutable: nodes that need no correction are returned by reference, and a
 * corrected node is a fresh object (never a mutation of the caller's input).
 *
 * Multi-provider nodes (`data.providers` holding 2+ entries) are SKIPPED: the
 * valid set there is the intersection across every selected provider, and when
 * a stored value falls outside it there is no single defensible replacement —
 * picking one provider's default would silently misconfigure the others. Those
 * nodes are still guarded interactively by the panel's intersection dropdown.
 */
export function normalizeNodeModelParams<T extends NodeLike>(
  nodes: readonly T[],
): NormalizedNodes<T> {
  const adjustments: NodeParamAdjustment[] = []
  const out = nodes.map((node) => {
    const type = typeof node.type === "string" ? node.type : ""
    if (type === "video-upscale") return normalizeVideoUpscaleNode(node, adjustments)
    if (type === "motion-transfer") return normalizeMotionTransferNode(node, adjustments)
    // The stored reference task type: the one rule every workflow write runs.
    if (REFERENCE_TASK_TYPE_NODE_MODES.has(type)) return withListedReferenceTaskTypes([node], adjustments)[0]!
    if (!MODEL_PARAM_NODE_TYPES.has(type)) return node

    const data = node.data
    if (!data || typeof data !== "object" || Array.isArray(data)) return node
    const d = data as Record<string, unknown>

    const multi = Array.isArray(d.providers) ? (d.providers as unknown[]) : []
    if (multi.length > 1) return node

    const provider =
      typeof d.provider === "string"
        ? d.provider
        : typeof multi[0] === "string"
          ? (multi[0] as string)
          : undefined
    if (!provider) return node

    // A write boundary has no photo, so "auto" on a node the run resolves it for
    // is left for the run to resolve against the photo — snapping it here would
    // discard the very request ("keep my photo's shape") the run can honour. It
    // is stored in its canonical spelling, the one the image routes' ratio enum
    // accepts. A Generate Image run snaps against its model's i2i sibling once
    // references attach, and this boundary cannot count them (wired ones come
    // from edges), so it asks about both.
    const deferAuto = AUTO_ASPECT_AT_RUN_NODE_TYPES.has(type) && (
      type === "generate-image"
        ? imageGenAutoAspectNeedsSourceImage({ provider, aspectRatio: d.aspectRatio })
        : autoAspectNeedsSourceImage(provider, d.aspectRatio)
    )
    const normalized = normalizeModelInput(provider, {
      aspectRatio: !deferAuto && typeof d.aspectRatio === "string" ? d.aspectRatio : undefined,
      resolution: typeof d.resolution === "string" ? d.resolution : undefined,
      quality: typeof d.quality === "string" ? d.quality : undefined,
    })
    const respell = deferAuto && d.aspectRatio !== "auto"
    if (normalized.adjustments.length === 0 && !respell) return node

    const nodeId = typeof node.id === "string" ? node.id : "(unknown node)"
    for (const adj of normalized.adjustments) {
      adjustments.push({ ...adj, nodeId, provider })
    }

    // Only the three governed keys are rewritten; everything else on the node
    // is passed through untouched. A dropped lever is written as `undefined`
    // rather than deleted so the shape stays stable for downstream readers.
    return {
      ...node,
      data: {
        ...d,
        aspectRatio: deferAuto ? "auto" : normalized.aspectRatio,
        resolution: normalized.resolution,
        quality: normalized.quality,
      },
    }
  })

  return { nodes: out, adjustments }
}

/**
 * A Video Upscale node: its `targetResolution` held to what its provider takes,
 * only for a provider whose catalog entry declares its resolutions
 * (`normalizeVideoUpscaleResolution`; today Nodaro Video Upscale's 1080p / 2K /
 * 4K). Every other provider's node — Topaz's, VEO's, Seedance HD's — is
 * returned as it came: its run reads the field by its own rules. Only that one
 * key is rewritten, and only when it holds a value some Video Upscale provider
 * takes (`VIDEO_UPSCALE_RESOLUTIONS`, spelled any way); an unset value and any
 * other value are left alone.
 */
function normalizeVideoUpscaleNode<T extends NodeLike>(node: T, adjustments: NodeParamAdjustment[]): T {
  const data = node.data
  if (!data || typeof data !== "object" || Array.isArray(data)) return node
  const d = data as Record<string, unknown>
  if (typeof d.targetResolution !== "string" || d.targetResolution === "") return node
  const provider = typeof d.provider === "string" && d.provider !== "" ? d.provider : "topaz"
  if (videoUpscaleResolutionsFor(provider).length === 0) return node
  const asked = d.targetResolution.trim().toLowerCase()
  if (!(VIDEO_UPSCALE_RESOLUTIONS as readonly string[]).includes(asked)) return node
  const normalized = normalizeVideoUpscaleResolution(provider, d.targetResolution)
  if (normalized.targetResolution === d.targetResolution) return node
  const nodeId = typeof node.id === "string" ? node.id : "(unknown node)"
  if (normalized.adjustment) adjustments.push({ ...normalized.adjustment, nodeId, provider })
  return { ...node, data: { ...d, targetResolution: normalized.targetResolution } }
}

/**
 * A Motion Transfer node: its `resolution` held to the size its model runs at
 * (`motionTransferResolution`: a Wan Animate node at 1080p runs as 720p), the
 * same rule its run is sent and charged by. Only that key is rewritten, and
 * only when the rule moves it; an unset size is left for the run's default.
 */
function normalizeMotionTransferNode<T extends NodeLike>(node: T, adjustments: NodeParamAdjustment[]): T {
  const data = node.data
  if (!data || typeof data !== "object" || Array.isArray(data)) return node
  const d = data as Record<string, unknown>
  if (typeof d.resolution !== "string" || d.resolution === "") return node
  const provider = typeof d.provider === "string" && d.provider !== "" ? d.provider : "kling"
  const sized = motionTransferResolution(provider, d.resolution)
  if (sized.resolution === d.resolution) return node
  const nodeId = typeof node.id === "string" ? node.id : "(unknown node)"
  for (const adj of sized.adjustments) adjustments.push({ ...adj, nodeId, provider })
  return { ...node, data: { ...d, resolution: sized.resolution } }
}

/** A video run's mode: the twin of an aliased model it sends to (`resolveVideoProviderForMode`). */
type VideoRunMode = "image-to-video" | "text-to-video"

/**
 * The video node types that store a Seedance reference task type
 * (`referenceTaskType`, "Use the reference video as"), each with the modes its
 * run sends a model in: Generate Video either (the wiring picks), Image to
 * Video and Text to Video their own, Video to Video none (its model's own id;
 * its run is an edit whatever is stored).
 */
const REFERENCE_TASK_TYPE_NODE_MODES: ReadonlyMap<string, readonly VideoRunMode[]> = new Map([
  ["generate-video", ["image-to-video", "text-to-video"]],
  ["image-to-video", ["image-to-video"]],
  ["text-to-video", ["text-to-video"]],
  ["video-to-video", []],
])

const namedModel = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)

/**
 * The models a video node's run uses: each entry of a Provider list
 * (`data.providers`, two or more, each run on its own), else its one model —
 * the run's own default when it names none (Generate Video's
 * `applyDefaultVideoSelection`, the legacy Image / Text to Video default, Video
 * to Video's).
 */
function videoRunModels(type: string, d: Record<string, unknown>): string[] {
  const list = Array.isArray(d.providers) ? d.providers.flatMap((p) => namedModel(p) ?? []) : []
  if (list.length >= 2) return list
  const named = namedModel(d.provider)
  if (type === "generate-video") return [applyDefaultVideoSelection({ provider: named }).provider]
  return [named ?? (type === "video-to-video" ? DEFAULT_VIDEO_TO_VIDEO_PROVIDER : LEGACY_VIDEO_NODE_DEFAULT_PROVIDER)]
}

/**
 * A video node's stored reference task type (decided 2026-11-13): kept, the
 * node returned as it came, while a model its run sends to lists the value
 * (`listedSeedanceTaskType`, the one membership test the run itself asks —
 * matched exactly, read from `MODEL_CATALOG[id].referenceTaskTypes`);
 * otherwise the key is REMOVED (absent is Auto, the setting's own meaning).
 * A run already ignores such a value, so nothing a run sends or is charged
 * changes; what changes is that it can no longer ride hidden on a model that
 * ignores it and come back when the node is later switched to one that reads
 * it. `auto`, a wrong case, a number and every value no model lists are
 * removed on every model. A node storing no value is returned as it came.
 */
function normalizeReferenceTaskTypeNode<T extends NodeLike>(node: T, type: string, adjustments: NodeParamAdjustment[]): T {
  const data = node.data
  if (!data || typeof data !== "object" || Array.isArray(data)) return node
  const d = data as Record<string, unknown>
  const value = d.referenceTaskType
  // Unset (absent, or an in-memory `undefined` the editor writes for Auto): nothing to judge.
  if (value === undefined) return node
  const modes = REFERENCE_TASK_TYPE_NODE_MODES.get(type) ?? []
  const models = videoRunModels(type, d)
  const sentTo = models.flatMap((m) => [m, ...modes.map((mode) => resolveVideoProviderForMode(m, mode))])
  if (sentTo.some((m) => listedSeedanceTaskType(m, value) !== undefined)) return node

  const listedAnywhere = Object.values(MODEL_CATALOG).some((m) => m.referenceTaskTypes?.some((t) => t === value))
  const label = MODEL_CATALOG[models[0]!]?.label ?? models[0]!
  const reason = listedAnywhere
    ? `${label} does not take the reference task type "${String(value)}": removed, so the run declares none (Auto).`
    : `"${String(value)}" is not a reference task type a model takes (reference, edit or extend): removed — Auto is the setting left unset.`
  const nodeId = typeof node.id === "string" ? node.id : "(unknown node)"
  adjustments.push({ field: "referenceTaskType", from: typeof value === "number" ? value : String(value), to: undefined, reason, nodeId, provider: models[0]! })
  const { referenceTaskType: _removed, ...rest } = d
  return { ...node, data: rest }
}

/**
 * A workflow graph's nodes with every stored Seedance reference task type held
 * to the models its node runs (decided 2026-11-13) — the ONE rule for that
 * field, which {@link normalizeNodeModelParams} runs too: on a Generate Video,
 * Image to Video, Text to Video or Video to Video node, a `referenceTaskType`
 * no model the node runs lists (and `auto`, or any value no model lists) is
 * removed; nothing else on any node is touched.
 *
 * Every path that stores a workflow graph runs it: the editor's saves, the
 * REST and MCP writes, imports, copies, template clones and the published
 * snapshots. So a value can never sit unused on a model that ignores it and
 * take effect when the node is later switched to one that reads it.
 *
 * Takes the stored value as it comes (`nodes` may be any JSON): anything that
 * is not an array is returned as it came. The SAME array is returned when no
 * node changes, and an unchanged node keeps its reference, so a graph without
 * such a value is written byte for byte as before.
 *
 * @param adjustments told each removal (what `normalizeNodeModelParams` reports).
 */
export function withListedReferenceTaskTypes<N>(nodes: N, adjustments?: NodeParamAdjustment[]): N {
  if (!Array.isArray(nodes)) return nodes
  const sink = adjustments ?? []
  let changed = false
  const out = (nodes as unknown[]).map((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node
    const n = node as NodeLike
    const type = typeof n.type === "string" ? n.type : ""
    if (!REFERENCE_TASK_TYPE_NODE_MODES.has(type)) return node
    const next = normalizeReferenceTaskTypeNode(n, type, sink)
    if (next !== n) changed = true
    return next
  })
  return (changed ? out : nodes) as N
}

/** One-line-per-change summary, for surfacing back to an agent or a log. */
export function describeNodeAdjustments(adjustments: readonly NodeParamAdjustment[]): string[] {
  return adjustments.map(
    (a) => `${a.nodeId} (${a.provider}): ${a.field} "${a.from}" → ${a.to === undefined ? "removed" : `"${a.to}"`} — ${a.reason}`,
  )
}
