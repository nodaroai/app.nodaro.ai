import {
  applyDefaultVideoSelection,
  audioSoundtrackActive,
  audioSoundtrackClipSec,
  billsReferenceVideoSeconds,
  isSeedanceVideoEditProvider,
  pricedOutputDurationSec,
  SEEDANCE_VIDEO_EDIT_TASK_TYPE,
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
import { wiredCharacterSubjectClips } from "@nodaro/shared/video"
import { seedanceFinalizeDraftQuote, type SeedanceFinalizeDraftOptions } from "@nodaro/render-rules"
import type { ChargedPriceTable, EstimateEdge, EstimateNode } from "./credits.js"
import { plannedSeedanceDraftFinalizePlan, seedance2RefVideoQuote } from "./seedance2-ref-video-quote.js"
import { seedanceDraftFinalizeRefBaseCredits } from "./seedance2-ref-video-credits.js"
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

export interface RefVideoEstimateRequest {
  provider: string
  resolution?: string
  duration?: number | string
  draft: boolean
  /**
   * The reference task type the run's payload requests, as the workflow
   * builder sets it (`payload-builder.ts`): a generation node's payload
   * requests the node's own setting as stored, and Video to Video's Seedance
   * edit lane requests `edit` (its request is already in the edit's shape, so
   * that declaration moves nothing priced). Unvalidated: the quote declares it
   * on the clips by the run's own rule and prices the length the run is sent
   * at, with the resolved type sizing the hold.
   */
  referenceTaskType: unknown
  /** One entry per clip wire: the upstream node, when the estimate has it. */
  clipSources: ReadonlyArray<EstimateNode | undefined>
  /**
   * Kling 4.0 audio soundtrack (`audioSoundtrackActive`): the first audio clip
   * goes as one more reference video, as long as the audio within [2 s, the
   * output] — `source` is its upstream node, when the estimate has it.
   */
  soundtrack?: { readonly source: EstimateNode | undefined }
  /** The node's trim of its source clip (per-second Gemini Omni: it decides what is billed). */
  videoTrim: { start: unknown; end: unknown }
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
  const selectedProvider = applyDefaultVideoSelection({ provider: data.provider as string | undefined, duration: data.duration as number | string | undefined }).provider
  const soundtrack = isGeneration && audioSoundtrackActive({
    provider: selectedProvider,
    audioSoundtrack: typeof data.audioSoundtrack === "boolean" ? data.audioSoundtrack : undefined,
    audioRefCount: audioEdges.length,
  })
  // Kling 4.0 video subjects: a wired Character's own clip rides as one more
  // reference video (`seatCharacterVideos`), priced as one.
  const subjectClips = node.type === "generate-video" ? characterSubjectClipSources(node, nodes, edges, selectedProvider, clipEdges.map((e) => e.source)) : []
  if (clipSourceIds.length === 0 && !soundtrack && subjectClips.length === 0) return undefined
  let provider: string
  let resolution: string | undefined
  let duration: number | string | undefined
  let referenceTaskType: RefVideoEstimateRequest["referenceTaskType"]
  if (isGeneration) {
    const sel = applyDefaultVideoSelection({ provider: data.provider as string | undefined, duration: data.duration as number | string | undefined })
    provider = sel.provider
    resolution = data.resolution as string | undefined
    duration = sel.duration
    referenceTaskType = data.referenceTaskType
  } else {
    provider = (data.provider as string | undefined) ?? ""
    if (!isSeedanceVideoEditProvider(provider)) return undefined
    resolution = data.v2vResolution as string | undefined
    duration = VIDEO_DURATION_AUTO
    referenceTaskType = SEEDANCE_VIDEO_EDIT_TASK_TYPE
  }
  if (!billsReferenceVideoSeconds(provider)) return undefined
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return {
    provider, resolution, duration, draft: data.draft === true, referenceTaskType,
    videoTrim: { start: data.videoTrimStart, end: data.videoTrimEnd },
    clipSources: [...clipSourceIds.map((id) => (id === undefined ? undefined : byId.get(id))), ...subjectClips],
    ...(soundtrack ? { soundtrack: { source: byId.get(audioEdges[0]!.source) } } : {}),
  }
}

/**
 * The clips a Generate Video run sends as its characters' video subjects on
 * `provider` (`wiredCharacterSubjectClips`: Kling 4.0 / Flash only, a character
 * that gives an image, the run's first `characters` of them), each as the
 * upload it is — a file the run sends as it is, so the pre-pass probes it —
 * keyed by its Character node (an app input the user replaces stays the worst
 * case). A clip that is also one of the wired clips (an upload's file, or a
 * generation's current result) is that seat, not one more, as the run seats it
 * (`seatCharacterVideos`). Only Generate Video carries video subjects: the
 * older Image to Video / Text to Video nodes never do (decided 2026-11-13).
 */
function characterSubjectClipSources(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  provider: string,
  wiredSourceIds: ReadonlyArray<string | undefined>,
): EstimateNode[] {
  if (!node.id || !edges) return []
  const graphNodes = nodes.flatMap((n) => (n.id === undefined ? [] : [{ ...n, id: n.id }]))
  const graphEdges = edges.flatMap((e) => (e.source === undefined ? [] : [{ ...e, source: e.source }]))
  const clips = wiredCharacterSubjectClips(node.id, graphNodes, graphEdges, provider)
  if (clips.length === 0) return []
  const byId = new Map(graphNodes.map((n) => [n.id, n]))
  const wiredUrls = new Set(wiredSourceIds.flatMap((id) => {
    const source = id === undefined ? undefined : byId.get(id)
    const url = knownClipUrl(source) ?? activeResultUrl(source?.data)
    return typeof url === "string" && url ? [url.trim()] : []
  }))
  const owner = (url: string) =>
    graphNodes.find((n) => n.type === "character" && String((n.data as { subjectVideoUrl?: unknown } | undefined)?.subjectVideoUrl ?? "").trim() === url)?.id
  return clips
    .filter((url) => !wiredUrls.has(url))
    .map((url) => ({ id: owner(url), type: "upload-video", data: { url } }))
}

/** A node's current result (its active one in `generatedResults`), when it has one. */
function activeResultUrl(data: Record<string, unknown> | undefined): string | undefined {
  const results = Array.isArray(data?.generatedResults) ? (data.generatedResults as unknown[]) : []
  const index = typeof data?.activeResultIndex === "number" ? data.activeResultIndex : 0
  const url = (results[index] as { url?: unknown } | null | undefined)?.url
  return typeof url === "string" && url ? url : undefined
}

/**
 * What one run of `node` sends when its price follows reference clips, as an
 * estimate knows it, else undefined: the request's levers, the clips whose
 * length the estimate knows (`prices.uploadClipSec`, what the pre-pass
 * probed), and how many it does not (each the worst case). The one reading
 * of a node's clips every estimate of its run shares — its own price, and the
 * price of a Seedance 2.5 HD finalize of the draft it makes
 * ({@link seedanceDraftFinalizeEstimateCredits}).
 */
export function seedanceRefVideoEstimateInput(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  prices: Pick<ChargedPriceTable, "uploadClipSec">,
): (Omit<RefVideoEstimateRequest, "clipSources" | "soundtrack"> & { durationsSec: number[]; unknownClips: number }) | undefined {
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
  const { clipSources: _clips, soundtrack: _soundtrack, ...levers } = request
  return { ...levers, durationsSec, unknownClips }
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
  const input = seedanceRefVideoEstimateInput(node, nodes, edges, prices)
  if (!input) return undefined
  return seedance2RefVideoQuote({
    provider: input.provider,
    resolution: input.resolution,
    duration: input.duration,
    draft: input.draft,
    referenceTaskType: input.referenceTaskType,
    durationsSec: input.durationsSec,
    unknownClips: input.unknownClips,
    videoTrim: input.videoTrim,
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

/**
 * A Seedance 2.5 HD finalize (Video Upscale, provider `seedance-2-5-hd`) in the
 * server's workflow estimates — the run estimate, the published-app listing
 * and the balance checks (decided 2026-11-12). Which node is the draft, and
 * whether the run makes it, is the shared rule the editor's Run total reads
 * too (`seedanceFinalizeDraftQuote`, @nodaro/render-rules):
 *
 *  - the run MAKES the draft: priced at the length the draft's run reserves
 *    for, which is also the most the finalize bills for output — so the
 *    figure is a true ceiling:
 *    - no reference video: the finalize row for its priced length
 *      (`seedance-2-5-hd:{N}s`), its charged price;
 *    - reference video(s): the draft's request as its own estimate reads it
 *      ({@link seedanceRefVideoEstimateInput}: an uploaded clip at its probed
 *      length, any other at the worst case), priced as a finalize of that
 *      draft (`plannedSeedanceDraftFinalizePlan`) and marked up once at the
 *      finalize's id — the reference lane of
 *      `seedanceDraftFinalizeChargedCredits`, step for step. The editor gets
 *      this figure from `POST /v1/credits/seedance-hd-estimate`
 *      (`plannedDraft`), which prices the same plan;
 *  - the draft EXISTS: its exact price, as the finalize's own gate prices it,
 *    when the estimate resolved it (`prices.seedanceDrafts`, by task id — a
 *    run-set estimate of the user's own run); else as before.
 *
 * Undefined for every other node, for a finalize with no draft wired, and for
 * an existing draft the estimate could not price: priced as before.
 */
export function seedanceDraftFinalizeEstimateCredits(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  rerunIds: ReadonlySet<string>,
  prices: ChargedPriceTable,
): number | undefined {
  const quote = seedanceFinalizeDraftQuoteOf(node, nodes, edges, rerunIds, { stateTaskIdOf: prices.seedanceDrafts?.stateTaskIdOf })
  if (!quote) return undefined
  if (quote.kind === "existing") return prices.seedanceDrafts?.credits.get(quote.taskId)
  if (!quote.hasRefVideo) {
    const base = prices.base(quote.creditId)
    return base === undefined ? undefined : prices.charge(quote.creditId, base)
  }
  const draft = seedanceRefVideoEstimateInput(quote.draft as EstimateNode, nodes, edges, prices)
  if (!draft) return undefined
  const plan = plannedSeedanceDraftFinalizePlan({
    provider: draft.provider,
    resolution: draft.resolution,
    duration: draft.duration,
    referenceTaskType: draft.referenceTaskType,
    durationsSec: draft.durationsSec,
    unknownClips: draft.unknownClips,
  })
  return prices.charge(plan.creditId, seedanceDraftFinalizeRefBaseCredits(plan))
}

/** {@link seedanceFinalizeDraftQuote} on an estimate's graph (nodes and edges without an id or a source left out). */
export function seedanceFinalizeDraftQuoteOf(
  node: EstimateNode,
  nodes: ReadonlyArray<EstimateNode>,
  edges: ReadonlyArray<EstimateEdge> | undefined,
  rerunIds: ReadonlySet<string>,
  options: SeedanceFinalizeDraftOptions = {},
): ReturnType<typeof seedanceFinalizeDraftQuote> {
  if (node.type !== "video-upscale" || node.id === undefined || !edges) return undefined
  const graphNodes = nodes.flatMap((n) => (n.id === undefined ? [] : [{ ...n, id: n.id }]))
  const graphEdges = edges.flatMap((e) => (e.source === undefined ? [] : [{ ...e, source: e.source }]))
  return seedanceFinalizeDraftQuote({ ...node, id: node.id }, graphNodes, graphEdges, rerunIds, options)
}
