/**
 * Seedream 5.5 layer decomposition on KIE's market lane (Split into Layers):
 * one image in, a base picture and its layers out.
 *
 *   input = { image_url, size, max_images, prompt? }
 *   poll  → JSON.parse(resultJson) = { resultObject: { layers_data: [...] }, resultUrls: [...] }
 *
 * `max_images` counts the base. `layers_data[]` describes every image: the base
 * (z_index 0, a size, its url — no box, name or description) and each layer
 * (z_index from 1, its own `size` "WxH", `bounding_box.absolute` [x1, y1, x2, y2]
 * in the base's pixels and `bounding_box.normalized` the same box on 0–1000,
 * `name`, `description`, `url`). A layer is NOT in the base's pixels: it is a
 * transparent PNG cropped to its element at about the size tier's pixel budget,
 * at the element's own shape, so it is put back in place by scaling it to its
 * box. More elements than `max_images` allows merge into fewer layers.
 * Read 2026-11-11 from the docs and three direct runs (1K twice, `auto` once):
 * `resultUrls` listed the base first and the layers in `layers_data`'s order,
 * but the layers are still matched to their files by URL, never by position.
 *
 * Not sent: `output_format` (the base stays PNG; layers are always PNG),
 * `text_recognition` (no visible change in the record), and the content filter
 * `nsfw_checker`, declared as a safety lever in models.ts and applied by the
 * createTask chokepoint only when an admin sets it.
 */
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { createKieTask, createSanitizedError, pollKieTask } from "./client.js"
import { kieTaskCreditsConsumed } from "./image-cost.js"
import { LAYER_DECOMPOSITION_MODEL_KEY, LAYER_DECOMPOSITION_WIRE_MODEL } from "./models.js"

/** What one run asks for. */
export interface LayerDecompositionRequest {
  readonly imageUrl: string
  /** The most images to return, the base included (2 to 100). */
  readonly maxImages: number
  readonly size: "1K" | "1.5K" | "2K" | "auto"
  /** Which elements to separate; absent = the model finds the main ones itself. */
  readonly prompt?: string
}

/** A box on the base picture: its corners, x1/y1 the top left. */
export interface LayerBox {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/** One layer as the provider returned it. */
export interface DecomposedLayer {
  /** The provider's file (a transparent PNG cropped to the element). */
  readonly url: string
  /** Stacking order: 1 sits on the base, higher is drawn above. */
  readonly zIndex: number
  readonly name?: string
  readonly description?: string
  /** The layer file's own pixels (not the base's). */
  readonly width?: number
  readonly height?: number
  /** Where it sits on the base, in the base's pixels. */
  readonly box?: LayerBox
  /** The same box on a 0–1000 scale of the base's width and height. */
  readonly boxNormalized?: LayerBox
}

export interface LayerDecompositionResult {
  readonly taskId: string
  /** The provider's base picture (opaque PNG). */
  readonly baseUrl: string
  readonly baseWidth?: number
  readonly baseHeight?: number
  /** The layers, bottom to top (zIndex order). */
  readonly layers: readonly DecomposedLayer[]
  /** What the task really cost, in KIE credits, from its own record; undefined when the record says nothing. */
  readonly kieCredits?: number
  readonly providerMs?: number
}

/** The request body's `input` (pure): the prompt only when there is one. */
export function layerDecompositionInput(req: LayerDecompositionRequest): Record<string, unknown> {
  return {
    image_url: req.imageUrl,
    size: req.size,
    max_images: req.maxImages,
    ...(req.prompt ? { prompt: req.prompt } : {}),
  }
}

/** Decompose one image and poll the task to its end. Every failure is the client's sanitized error (refunded by the worker's failure path). */
export async function runLayerDecomposition(req: LayerDecompositionRequest, reconcileOpts?: ReconcileOpts): Promise<LayerDecompositionResult> {
  const { taskId } = await createKieTask(LAYER_DECOMPOSITION_WIRE_MODEL, layerDecompositionInput(req), {
    modelKey: LAYER_DECOMPOSITION_MODEL_KEY,
    dimensions: { resolution: req.size, images: req.maxImages, ...reconcileOpts?.dimensions },
  })
  await fireOnTaskCreated(reconcileOpts, taskId, "[KIE.ai layer decomposition]")
  const { resultJson, providerMs, rawRecordInfo } = await pollKieTask(taskId)
  return layerDecompositionResultOf({ taskId, resultJson, kieCredits: kieTaskCreditsConsumed(rawRecordInfo), providerMs })
}

/** A finished task as its poll read it: its parsed `resultJson`, and what it cost and took. */
export interface LayerDecompositionTask {
  readonly taskId: string
  readonly resultJson: unknown
  /** What the task really cost, in KIE credits, from its own record; undefined when the record says nothing. */
  readonly kieCredits?: number
  readonly providerMs?: number
}

/**
 * The run's result from its finished task (pure): the base and layers of its
 * `resultJson` (`parseLayerDecompositionResult`), with what it cost and took.
 * The ONE assembly for the worker's run and for a recovery that reads the same
 * task again (backend/src/nodes/split-into-layers/recover.ts), so both hand the
 * delivery the same result. Throws, as the parser does, on a task with no base.
 */
export function layerDecompositionResultOf(task: LayerDecompositionTask): LayerDecompositionResult {
  const parsed = parseLayerDecompositionResult(task.resultJson, task.taskId)
  return {
    ...parsed,
    ...(task.kieCredits !== undefined ? { kieCredits: task.kieCredits } : {}),
    ...(task.providerMs !== undefined ? { providerMs: task.providerMs } : {}),
  }
}

// =============================================================================
// RESULT PARSER (pure)
// =============================================================================

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

const urlOf = (v: unknown): string | undefined => (typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim() : undefined)

const textOf = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined)

/** "1727x607" → { width, height }; undefined for anything else. */
function sizeOf(v: unknown): { width: number; height: number } | undefined {
  const m = typeof v === "string" ? /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(v) : null
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined
}

/** [x1, y1, x2, y2] of finite numbers → a box; undefined for anything else. */
function boxOf(v: unknown): LayerBox | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined
  const [x1, y1, x2, y2] = v as number[]
  return { x1: x1!, y1: y1!, x2: x2!, y2: y2! }
}

const zOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/**
 * The base and layers of a finished task's `resultJson`. The base is the
 * `layers_data` entry at z_index 0 (else the first of `resultUrls`); each other
 * entry is a layer, matched to its file by URL, in z_index order. A file in
 * `resultUrls` that no entry describes is still a layer (with no data), after
 * the described ones. A task with no base fails — never an empty success; one
 * with a base and no layer is a base-only result.
 */
export function parseLayerDecompositionResult(resultJson: unknown, taskId: string): Omit<LayerDecompositionResult, "kieCredits" | "providerMs"> {
  const root = asRecord(resultJson)
  const entries = (Array.isArray(asRecord(root?.resultObject)?.layers_data) ? (asRecord(root?.resultObject)!.layers_data as unknown[]) : [])
    .map(asRecord)
    .filter((e): e is Record<string, unknown> => e !== undefined)
  const urls = (Array.isArray(root?.resultUrls) ? (root!.resultUrls as unknown[]) : []).map(urlOf).filter((u): u is string => u !== undefined)

  const baseEntry = entries.find((e) => zOf(e.z_index) === 0)
  const baseUrl = urlOf(baseEntry?.url) ?? urls[0]
  if (!baseUrl) throw createSanitizedError("layer decomposition succeeded but returned no base image", "Layer split")
  const baseSize = sizeOf(baseEntry?.size)

  const seen = new Set<string>([baseUrl])
  const described: DecomposedLayer[] = entries
    .filter((e) => e !== baseEntry && zOf(e.z_index) !== 0)
    .map((e, i) => ({ e, i, url: urlOf(e.url) }))
    .filter((x): x is { e: Record<string, unknown>; i: number; url: string } => x.url !== undefined && !seen.has(x.url) && (seen.add(x.url), true))
    .sort((a, b) => (zOf(a.e.z_index) ?? Number.MAX_SAFE_INTEGER) - (zOf(b.e.z_index) ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
    .map(({ e, url }) => {
      const size = sizeOf(e.size)
      const box = asRecord(e.bounding_box)
      const absolute = boxOf(box?.absolute)
      const normalized = boxOf(box?.normalized)
      const name = textOf(e.name)
      const description = textOf(e.description)
      return {
        url,
        zIndex: zOf(e.z_index) ?? 0,
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(size ? { width: size.width, height: size.height } : {}),
        ...(absolute ? { box: absolute } : {}),
        ...(normalized ? { boxNormalized: normalized } : {}),
      }
    })
  const undescribed = urls.filter((u) => !seen.has(u) && (seen.add(u), true))
  const top = described.reduce((m, l) => Math.max(m, l.zIndex), 0)
  const layers = [...described, ...undescribed.map((url, i) => ({ url, zIndex: top + i + 1 }))]
    // Stacking order from 1, in the order returned, whatever the provider numbered.
    .map((l, i) => ({ ...l, zIndex: i + 1 }))
  return {
    taskId,
    baseUrl,
    ...(baseSize ? { baseWidth: baseSize.width, baseHeight: baseSize.height } : {}),
    layers,
  }
}
