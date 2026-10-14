import {
  applyDefaultVideoSelection,
  isSeedance2Provider,
  isSeedanceVideoEditProvider,
} from "@nodaro/shared/models"
import {
  referenceModalityForHandle,
} from "@nodaro/shared/workflow"
import {
  VIDEO_DURATION_AUTO,
} from "@nodaro/shared/model-catalog"
import {
  withWiredSettings,
} from "@nodaro/shared/nodes"
import { probeMediaDuration } from "../../providers/video/ffmpeg-utils.js"
import type { ChargedPriceTable, EstimateEdge, EstimateNode } from "./credits.js"
import { seedance2RefVideoQuote } from "./seedance2-ref-video-quote.js"

/**
 * Seedance reference-video runs in the server's workflow estimates (the run
 * estimate and the published-app listing).
 *
 * Such a run is billed `unit × (Σ clips + max(output, longest clip))`, so the
 * estimate prices it through the reservation's own quote arithmetic
 * (`seedance2RefVideoQuote`, the one `POST /v1/credits/seedance-ref-estimate`
 * uses), from the clips' probed lengths:
 *
 *  - a clip whose file the estimate knows — an upload the run sends as it is —
 *    is probed by the async pre-pass (`withRefVideoClipLengths`), once per URL
 *    per {@link CLIP_LENGTH_TTL_MS} (a listing re-prices without re-probing);
 *  - any other clip (a generation's output, an upload the app user replaces,
 *    no pre-pass, as in the static base estimate) is priced at the provider's
 *    worst case — never below what the run reserves.
 *
 * Two nodes make this call: Generate Video (and the legacy Image/Text to Video
 * nodes) with a clip on a reference-video handle, and Video to Video's Seedance
 * edit lane (its source clip IS reference video 1). Mirrors the editor's
 * `frontend/src/lib/seedance-ref-quote.ts`.
 */

const VIDEO_GENERATION_TYPES = new Set(["generate-video", "image-to-video", "text-to-video"])

/** How long a probed length is reused. A URL names its file; the TTL bounds memory, not staleness. */
const CLIP_LENGTH_TTL_MS = 30 * 60_000
const CLIP_LENGTH_CACHE_MAX = 2_000
const clipLengths = new Map<string, { sec: number; at: number }>()

/** Tests only: forget every probed length. */
export function __forgetRefVideoClipLengths(): void {
  clipLengths.clear()
}

interface RefVideoEstimateRequest {
  provider: string
  resolution?: string
  duration?: number | string
  draft: boolean
  /** One entry per clip wire: the upstream node, when the estimate has it. */
  clipSources: ReadonlyArray<EstimateNode | undefined>
}

/** The clip a source hands the run unchanged — an upload's file — else undefined. */
function knownClipUrl(source: EstimateNode | undefined): string | undefined {
  if (source?.type !== "upload-video") return undefined
  const url = (source.data as { url?: unknown } | undefined)?.url
  return typeof url === "string" && url.trim() !== "" ? url.trim() : undefined
}

/** The request `node` (already read through its Settings input) makes, or undefined when its price does not follow reference clips. */
function refVideoEstimateRequest(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
): RefVideoEstimateRequest | undefined {
  const isGeneration = VIDEO_GENERATION_TYPES.has(node.type)
  if (!isGeneration && node.type !== "video-to-video") return undefined
  // Video to Video's edit lane always sends exactly one clip, its source — so
  // an estimate without the wiring still knows it is a reference-video run
  // (one unknown clip). A generation's reference clips are a graph fact only.
  const clipEdges = edges && node.id
    ? edges.filter((e) => e.target === node.id && (
      isGeneration ? referenceModalityForHandle(e.targetHandle) === "video" : e.targetHandle === "video"
    ))
    : []
  const clipSourceIds: Array<string | undefined> = clipEdges.length > 0
    ? clipEdges.map((e) => e.source)
    : isGeneration ? [] : [undefined]
  if (clipSourceIds.length === 0) return undefined
  const data = node.data ?? {}
  let provider: string
  let resolution: string | undefined
  let duration: number | string | undefined
  if (isGeneration) {
    const sel = applyDefaultVideoSelection({ provider: data.provider as string | undefined, duration: data.duration as number | string | undefined })
    provider = sel.provider
    resolution = data.resolution as string | undefined
    duration = sel.duration
  } else {
    provider = (data.provider as string | undefined) ?? ""
    if (!isSeedanceVideoEditProvider(provider)) return undefined
    resolution = data.v2vResolution as string | undefined
    duration = VIDEO_DURATION_AUTO
  }
  if (!isSeedance2Provider(provider)) return undefined
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return { provider, resolution, duration, draft: data.draft === true, clipSources: clipSourceIds.map((id) => (id === undefined ? undefined : byId.get(id))) }
}

/**
 * The charged credits of one run of `node` when its price follows reference
 * clips, else undefined. `prices.refVideoClipSec` holds the lengths the
 * pre-pass probed; a clip not there is the worst case.
 */
export function seedanceRefVideoEstimateCredits(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  prices: ChargedPriceTable,
): number | undefined {
  const priced = withWiredSettings(node, nodes, edges) as EstimateNode
  const request = refVideoEstimateRequest(priced, nodes, edges)
  if (!request) return undefined
  const durationsSec: number[] = []
  let unknownClips = 0
  for (const source of request.clipSources) {
    const url = knownClipUrl(source)
    const sec = url === undefined ? undefined : prices.refVideoClipSec?.get(url)
    if (sec === undefined) unknownClips += 1
    else durationsSec.push(sec)
  }
  return seedance2RefVideoQuote({
    provider: request.provider,
    resolution: request.resolution,
    duration: request.duration,
    draft: request.draft,
    durationsSec,
    unknownClips,
    charge: (identifier, base) => prices.charge(identifier, base),
  }).credits
}

/** One URL's probed length (NaN = unreadable, which the quote counts as the worst case), cached. */
async function clipLengthSec(url: string): Promise<number> {
  const hit = clipLengths.get(url)
  if (hit && Date.now() - hit.at < CLIP_LENGTH_TTL_MS) return hit.sec
  const sec = await probeMediaDuration(url).catch(() => Number.NaN)
  if (clipLengths.size >= CLIP_LENGTH_CACHE_MAX) clipLengths.delete(clipLengths.keys().next().value as string)
  clipLengths.set(url, { sec, at: Date.now() })
  return sec
}

/**
 * `prices` with the lengths of the reference clips the estimate can know:
 * every upload wired as a reference clip of a Seedance reference-video node,
 * except those in `replaceable` (an app's or component's media inputs — the
 * app user's file replaces them, so they stay the worst case). Probes run in
 * parallel and are cached per URL.
 */
export async function withRefVideoClipLengths(
  prices: ChargedPriceTable,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  replaceable?: ReadonlySet<string>,
): Promise<ChargedPriceTable> {
  const urls = new Set<string>()
  for (const node of nodes) {
    const request = refVideoEstimateRequest(withWiredSettings(node, nodes, edges) as EstimateNode, nodes, edges)
    for (const source of request?.clipSources ?? []) {
      const url = source?.id && replaceable?.has(source.id) ? undefined : knownClipUrl(source)
      if (url) urls.add(url)
    }
  }
  if (urls.size === 0) return prices
  const lengths = await Promise.all([...urls].map(async (url) => [url, await clipLengthSec(url)] as const))
  return {
    base: (identifier) => prices.base(identifier),
    charge: (identifier, baseCredits) => prices.charge(identifier, baseCredits),
    editPlanPerMinute: prices.editPlanPerMinute,
    refVideoClipSec: new Map(lengths),
  }
}
