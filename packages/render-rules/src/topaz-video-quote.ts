/**
 * How a Topaz Video Upscale is QUOTED before its run, on every estimate — the
 * editor's pill, its Run button and the workflow badge, and the server's run
 * estimate, an app's listing and a continuation's credit check (decided
 * 2026-11-14: "Same as source" reads the clip's known frame and rate on both
 * sides, the documented minimum where they are not known).
 *
 * The run measures the source and holds `topazVideoHoldUnits` of its target
 * (`resolveTopazVideoTarget` over the probed clip: its frame, its rate). A quote
 * reads the same rule over what the graph knows of the clip wired into the
 * node's `video` input ({@link topazWiredSource}):
 * - its FRAME (width × height, {@link runWireFrame}): an upload's recorded size
 *   (the result row of the file it holds, else its upload metadata while that
 *   upload is the file it holds), and the size recorded with the take a node
 *   that does not run in this run hands on; carried through Trim and Loop
 *   (which keep it) and a Combine Videos whose clips all share it. A node that
 *   runs again in this run has no size before it: its earlier take is not the
 *   clip this run makes, and a model's aspect or resolution SETTING is not a
 *   size (many render off their nominal ratio).
 * - its RATE: a declared `fps`, as `runWireFps` reads it (an upload's, carried
 *   through Trim, Loop and a Combine Videos whose clips share it).
 * Unknown, each falls to the documented minimum: a 16:9 frame, 30 fps; a
 * length nothing knows, a 10-second clip (`topazVideoEstimateUnits`).
 */
import { clampTopazVideoFps, isTopazVideoResolution, resolveTopazVideoTarget, TOPAZ_VIDEO_FALLBACK_FPS, type TopazVideoResolution, type TopazVideoSource } from "@nodaro/shared/models"
import { resolveGraphOrigin, type EstimateGraphEdge, type EstimateGraphNode } from "./apply-edl-estimate"
import { activeTake, runningNodeIdsOf } from "./measured-wire-length"
import { topazTargetFpsOf, topazVideoHoldUnits, TOPAZ_VIDEO_ESTIMATE_FALLBACK_SEC } from "./topaz-pricing"
import { runWireFps } from "./utility-wire-length"

/** A clip's pixel size. */
export type VideoFrame = Pick<TopazVideoSource, "width" | "height">

/** What an estimate knows of the clip wired into a Video Upscale. */
export interface TopazWiredSource {
  /** Its recorded pixel size, when known. */
  readonly frame?: VideoFrame
  /** Its declared frame rate, when known. */
  readonly fps?: number
}

const positivePx = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)

/** A row's recorded size, when it records both sides. */
function frameOf(row: unknown): VideoFrame | undefined {
  const r = row as Record<string, unknown> | null | undefined
  const width = positivePx(r?.width)
  const height = positivePx(r?.height)
  return width !== undefined && height !== undefined ? { width, height } : undefined
}

/** An upload's recorded size: the result row of the file it holds, else its upload metadata while that upload is the file it holds. */
function uploadFrameOf(data: Record<string, unknown>): VideoFrame | undefined {
  const url = typeof data.url === "string" ? data.url.trim() : ""
  if (url === "") return undefined
  const rows = Array.isArray(data.generatedResults) ? (data.generatedResults as readonly unknown[]) : []
  for (const r of rows) {
    const row = r as Record<string, unknown> | null | undefined
    if (typeof row?.url !== "string" || row.url.trim() !== url) continue
    const frame = frameOf(row)
    if (frame) return frame
  }
  // A link pasted on the node (URL mode) clears the metadata; only an upload's own metadata is its size.
  return data.externalUrl ? undefined : frameOf(data.metadata)
}

/** The steps whose output keeps the frame of the video they are given. */
const FRAME_KEEPING_TYPES: ReadonlySet<string> = new Set(["trim-video", "loop-video"])

/**
 * The pixel size of the video on a wire when a run is estimated, or
 * `undefined` when the graph does not know it (see the module note).
 *
 * @param rerunIds the nodes the priced run executes (empty for a single node's own price); frozen ones are removed here.
 */
export function runWireFrame(
  sourceId: string | undefined,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
): VideoFrame | undefined {
  const running = runningNodeIdsOf(nodes, rerunIds)
  const walk = (id: string | undefined, seen: ReadonlySet<string>): VideoFrame | undefined => {
    const origin = resolveGraphOrigin(nodes.find((n) => n.id === id), nodes, edges)
    if (!origin) return undefined
    const type = origin.type ?? ""
    const data = (origin.data ?? {}) as Record<string, unknown>
    if (FRAME_KEEPING_TYPES.has(type) || type === "combine-videos") {
      if (seen.has(origin.id)) return undefined
      const walked = new Set(seen).add(origin.id)
      const frames = edges.filter((e) => e.target === origin.id).map((e) => walk(e.source, walked))
      if (FRAME_KEEPING_TYPES.has(type)) return frames.find((f) => f !== undefined)
      // Combine Videos: one size only when every clip's is known and they all share it.
      const first = frames[0]
      return first && frames.every((f) => f !== undefined && f.width === first.width && f.height === first.height) ? first : undefined
    }
    if (type === "upload-video") return uploadFrameOf(data)
    // Made again in this run: its earlier take is not this run's clip.
    if (running.has(origin.id)) return undefined
    return frameOf(activeTake(data))
  }
  return walk(sourceId, new Set())
}

/** A source's data with every recorded size and rate removed: a recording the app user replaces says nothing of the file they will give. */
export function withoutMediaShape(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const { fps: _fps, width: _width, height: _height, ...out } = { ...(data ?? {}) } as Record<string, unknown>
  if (Array.isArray(out.generatedResults)) {
    out.generatedResults = out.generatedResults.map((r: unknown) => {
      if (!r || typeof r !== "object") return r
      const { width: _w, height: _h, fps: _f, ...rest } = r as Record<string, unknown>
      return rest
    })
  }
  if (out.metadata && typeof out.metadata === "object") {
    const { width: _w, height: _h, fps: _f, ...rest } = out.metadata as Record<string, unknown>
    out.metadata = rest
  }
  return out
}

/**
 * What the graph knows of the clip on a Video Upscale's `video` wire: its
 * recorded frame ({@link runWireFrame}) and its declared rate (`runWireFps`).
 * `replacedIds`: sources whose file the run's user replaces (an app listing's
 * open recordings) — their sample's size and rate are not read.
 */
export function topazWiredSource(
  nodeId: string | undefined,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  replacedIds: ReadonlySet<string> = new Set(),
): TopazWiredSource {
  const edge = nodeId === undefined ? undefined : edges.find((e) => e.target === nodeId && (e.targetHandle === "video" || e.targetHandle == null))
  if (!edge) return {}
  const read = replacedIds.size === 0 ? nodes : nodes.map((n) => (replacedIds.has(n.id) ? { ...n, data: withoutMediaShape(n.data as Record<string, unknown> | undefined) } : n))
  const frame = runWireFrame(edge.source, read, edges, rerunIds)
  const fps = runWireFps(edge.source, read, edges)
  return { ...(frame ? { frame } : {}), ...(fps !== undefined ? { fps } : {}) }
}

/** The old relative levers a saved Video Upscale may still hold (the run's resolver reads them). */
const TOPAZ_LEGACY_FACTORS: ReadonlySet<string> = new Set(["1", "2", "4"])

/** The old 1×/2×/4× factor a Topaz Video Upscale still runs by — only while it names no resolution Topaz takes (a target, once set, replaces it). */
export function topazLegacyFactorOf(data: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (!data || isTopazVideoResolution(data.targetResolution)) return undefined
  const factor = typeof data.upscaleFactor === "string" ? data.upscaleFactor.trim() : ""
  return TOPAZ_LEGACY_FACTORS.has(factor) ? factor : undefined
}

/**
 * The target a Topaz Video Upscale is quoted at: the run's own resolver over
 * what the graph knows of its clip — its resolution (a target, else the old
 * factor over the clip's known short side, else 1080p) and its frame rate (the
 * node's own, as the run reads it — `topazTargetFpsOf`; else the clip's
 * declared rate; else 30 fps).
 */
export function topazQuotedTarget(
  data: Readonly<Record<string, unknown>>,
  wired: TopazWiredSource,
): { readonly resolution: TopazVideoResolution; readonly fps: number; readonly legacyFactor?: string } {
  const legacyFactor = topazLegacyFactorOf(data)
  const { resolution } = resolveTopazVideoTarget({
    targetResolution: typeof data.targetResolution === "string" ? data.targetResolution : undefined,
    upscaleFactor: legacyFactor,
    source: legacyFactor !== undefined ? wired.frame : undefined,
  })
  const asked = topazTargetFpsOf(data.targetFps)
  const fps = asked ?? (wired.fps !== undefined && wired.fps > 0 ? clampTopazVideoFps(wired.fps) : TOPAZ_VIDEO_FALLBACK_FPS)
  return legacyFactor === undefined ? { resolution, fps } : { resolution, fps, legacyFactor }
}

/**
 * The Topaz units a Video Upscale is QUOTED at (see the module note): its
 * quoted target ({@link topazQuotedTarget}) over the clip's length (`durationSec`,
 * the measured walk's reading; unknown, a 10-second clip) and its known frame
 * (unknown, 16:9) — the hold's own rule (`topazVideoHoldUnits`).
 */
export function topazVideoQuoteUnits(data: Readonly<Record<string, unknown>>, durationSec: number | null | undefined, wired: TopazWiredSource): number {
  const target = topazQuotedTarget(data, wired)
  return topazVideoHoldUnits({
    resolution: target.resolution,
    fps: target.fps,
    durationSec: durationSec != null && durationSec > 0 ? durationSec : TOPAZ_VIDEO_ESTIMATE_FALLBACK_SEC,
    ...(wired.frame ? { source: wired.frame } : {}),
  })
}
