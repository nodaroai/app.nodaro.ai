import {
  applyDefaultVideoSelection,
  audioSoundtrackActive,
  audioSoundtrackClipSec,
  billsReferenceVideoSeconds,
  isSeedanceVideoEditProvider,
  pricedOutputDurationSec,
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
import type { ChargedPriceTable, EstimateEdge, EstimateNode } from "./credits.js"
import { seedance2RefVideoQuote } from "./seedance2-ref-video-quote.js"
import { knownClipUrl } from "./upload-clip-lengths.js"

/**
 * Seedance reference-video runs in the server's workflow estimates (the run
 * estimate and the published-app listing).
 *
 * Such a run is held at `unit × (Σ clips + held output)`
 * (`seedance2RefVideoHeldOutputSec`), so the estimate prices it through the
 * reservation's own quote arithmetic
 * (`seedance2RefVideoQuote`, the one `POST /v1/credits/seedance-ref-estimate`
 * uses), from the clips' probed lengths:
 *
 *  - a clip whose file the estimate knows — an upload the run sends as it is —
 *    is probed by the async pre-pass (`withUploadClipLengths`, fed
 *    {@link refVideoClipSources}), once per URL (a listing re-prices without
 *    re-probing);
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

interface RefVideoEstimateRequest {
  provider: string
  resolution?: string
  duration?: number | string
  draft: boolean
  /** One entry per clip wire: the upstream node, when the estimate has it. */
  clipSources: ReadonlyArray<EstimateNode | undefined>
  /**
   * Kling 4.0 audio soundtrack (`audioSoundtrackActive`): the first audio clip
   * goes as one more reference video, as long as the audio within [2 s, the
   * output] — `source` is its upstream node, when the estimate has it.
   */
  soundtrack?: { readonly source: EstimateNode | undefined }
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
  const data = node.data ?? {}
  const audioEdges = isGeneration && edges && node.id
    ? edges.filter((e) => e.target === node.id && referenceModalityForHandle(e.targetHandle) === "audio")
    : []
  const soundtrack = isGeneration && audioSoundtrackActive({
    provider: applyDefaultVideoSelection({ provider: data.provider as string | undefined, duration: data.duration as number | string | undefined }).provider,
    audioSoundtrack: typeof data.audioSoundtrack === "boolean" ? data.audioSoundtrack : undefined,
    audioRefCount: audioEdges.length,
  })
  if (clipSourceIds.length === 0 && !soundtrack) return undefined
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
  if (!billsReferenceVideoSeconds(provider)) return undefined
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return {
    provider, resolution, duration, draft: data.draft === true,
    clipSources: clipSourceIds.map((id) => (id === undefined ? undefined : byId.get(id))),
    ...(soundtrack ? { soundtrack: { source: byId.get(audioEdges[0]!.source) } } : {}),
  }
}

/**
 * The charged credits of one run of `node` when its price follows reference
 * clips, else undefined. `prices.uploadClipSec` holds the lengths the
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
    const sec = url === undefined ? undefined : prices.uploadClipSec?.get(url)
    if (sec === undefined) unknownClips += 1
    else durationsSec.push(sec)
  }
  if (request.soundtrack) {
    // Known whatever the audio: an unread one is as long as the output, the longest the clip can be.
    const url = knownClipUrl(request.soundtrack.source)
    const audioSec = url === undefined ? undefined : prices.uploadClipSec?.get(url)
    durationsSec.push(audioSoundtrackClipSec(audioSec ?? Number.NaN, pricedOutputDurationSec(request.provider, request.duration)))
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

/**
 * The upstream nodes wired as reference clips of every Seedance
 * reference-video node in the graph — what the estimate's pre-pass probes
 * (`withUploadClipLengths` keeps only the uploads among them).
 */
export function refVideoClipSources(
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
): Array<EstimateNode | undefined> {
  return nodes.flatMap((node) => {
    const request = refVideoEstimateRequest(withWiredSettings(node, nodes, edges) as EstimateNode, nodes, edges)
    return request ? [...request.clipSources, ...(request.soundtrack ? [request.soundtrack.source] : [])] : []
  })
}
