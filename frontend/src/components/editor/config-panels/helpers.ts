import type { WorkflowNode, WorkflowEdge, FieldMappings, ProbedVideoInfo } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"
import { DEFAULT_TRANSCRIBE_NODE_PROVIDER, isSeedanceVideoEditProvider, applyDefaultVideoSelection, MUSIC_CREDIT_ID, dialogueProviderOf, sunoSeparateCreditId } from "@nodaro/shared/models"
import { videoMaskCreditId, resolveVideoMaskProvider, videoDepthCreditId, resolveVideoDepthProvider } from "@nodaro/shared/media"
import {
  buildCreditModelIdentifier as sharedBuildCreditModelIdentifier,
  buildVideoCreditModelIdentifier,
  seedanceVideoEditCreditId,
  buildMotionCreditModelIdentifier,
  resolveAiAvatarCreditId,
  resolveCinematicCreditId,
  buildVideoAnalysisCreditId,
  buildVideoAuditCreditId,
  sunoCreditType,
  speedRampCreditId,
  resolveTopazUpscale,
  contentRecipeCreditId,
  contentIdeasCreditId,
  videoSfxQuoteCreditId,
  textToAudioCreditId,
  LTX_EXTEND_PER_SECOND_CREDIT_ID,
  LTX_RETAKE_PER_SECOND_CREDIT_ID,
  pitchTempoQuoteCreditId,
  videoGenerationCreditId,
} from "@nodaro/shared/credits"
import {
  buildLlmCreditIdentifier,
  defaultReasoningEffort,
  LLM_FEATURE_DEFAULTS,
  motionGraphicsFeature,
  resolveVideoAnalysisModel,
  type LlmFeature,
} from "@nodaro/shared/llm-models"
import { buildScraperCreditId, isScraperActor, metaAdsScrapeCreditIdFromNode, instagramScrapeCreditIdFromNode, socialSearchCreditIdFromNode } from "@nodaro/shared/social"
import { captionRoutesToRemotion } from "@nodaro/shared/captions"
import { referenceSheetCreditId } from "@nodaro/shared/entities"
import { editPlanReserveCreditId, asEditPlanMode, asEditPlanTier } from "@nodaro/shared/edl"
import { isRenderNodeType, withWiredSettings } from "@nodaro/shared/nodes"
import { videoAuditAnalysisWired } from "@/components/editor/workflow-editor/types"
import { isUseCaseNodeType, renderEstimateCreditId, TOPAZ_VIDEO_UNIT_CREDIT_ID, usecaseFeeCreditId } from "@nodaro/render-rules"
import { sendsReferenceVideo } from "@/lib/audio-reference-handles"
import { bypassTeleports, drawnSourceId } from "@nodaro/render-rules"
import { editPlanOutputOf } from "@/lib/edit-plan-saved-output"
import { renderVideoCreditIdForNode } from "@/lib/render-video-plan"
import { resolveEditPlanEstimateDurationSec } from "@/lib/edit-plan-estimate"
import { editPlanPerMinuteReported } from "@/lib/edit-plan-modes"
import { audioSyncCreditId, audioSyncWiredSourceCount } from "@/lib/audio-sync"
import { wiredSocialPostsVideoSec } from "@/lib/video-analysis-handles"
import { isTopazVideoUpscaleProvider, pitchTempoQuotedSec, videoMaskQuotedSec, videoSfxQuotedSec } from "@/lib/video-utility-estimate"
import { upstreamVideoDurationSec } from "@/lib/upstream-video-duration"
import { speechQuote, upstreamSpeechText } from "@/lib/speech-estimate"
// The core price cache (the same one `getCachedCredits` under @/ee re-exports):
// a speech unit row cached there means the server prices speech by length.
import { getCachedModelCredits } from "@/hooks/use-model-credit-cost"
import { LLM_NODE_FEATURE_MAP, llmNodePriceIds, resolveLlmPriceId } from "@/lib/llm-price-ids"
import { IMAGE_MODEL_ROLE_DEFAULTS } from "@nodaro/shared/model-catalog"
import { TEXT_SOURCE_TYPES } from "./text-source-types"

export { TEXT_SOURCE_TYPES }

export const FIELD_COMPATIBLE_TYPES: Readonly<Record<string, ReadonlyArray<string>>> = {
  prompt: TEXT_SOURCE_TYPES,
  negativePrompt: TEXT_SOURCE_TYPES,
  style: ["style-guide", "style"],
  styleGuide: ["style-guide"],
  tone: TEXT_SOURCE_TYPES,
  provider: ["provider"],
  aspectRatio: ["aspect-ratio"],
  duration: ["duration"],
  targetLength: ["duration"],
  motion: ["motion"],
  sceneCount: ["scene-count"],
  // Text fields for fieldMappings + {} injection
  lyrics: TEXT_SOURCE_TYPES,
  title: TEXT_SOURCE_TYPES,
  description: TEXT_SOURCE_TYPES,
  voiceDescription: TEXT_SOURCE_TYPES,
  genre: TEXT_SOURCE_TYPES,
  mood: TEXT_SOURCE_TYPES,
  caption: TEXT_SOURCE_TYPES,
  transcript: TEXT_SOURCE_TYPES,
  directText: TEXT_SOURCE_TYPES,
  previousText: TEXT_SOURCE_TYPES,
  nextText: TEXT_SOURCE_TYPES,
  characterName: TEXT_SOURCE_TYPES,
  faceName: TEXT_SOURCE_TYPES,
  objectName: TEXT_SOURCE_TYPES,
  locationName: TEXT_SOURCE_TYPES,
  baseOutfit: TEXT_SOURCE_TYPES,
  systemPrompt: TEXT_SOURCE_TYPES,
  userInput: TEXT_SOURCE_TYPES,
  url: TEXT_SOURCE_TYPES,
  query: TEXT_SOURCE_TYPES,
  target: TEXT_SOURCE_TYPES,
  filename: TEXT_SOURCE_TYPES,
  content: TEXT_SOURCE_TYPES,
  text: TEXT_SOURCE_TYPES,
}

export function getCompatibleSources(
  field: string,
  sources: ReadonlyArray<SourceNodeInfo>,
  providerCategory?: string,
): ReadonlyArray<SourceNodeInfo> {
  const compatibleTypes = FIELD_COMPATIBLE_TYPES[field]
  if (!compatibleTypes) return sources

  const filtered = sources.filter((s) => {
    if (!compatibleTypes.includes(s.type)) return false
    if (s.type === "provider" && providerCategory && s.providerCategory !== providerCategory) return false
    return true
  })

  // Deduplicate by id to avoid React key warnings
  const seen = new Set<string>()
  return filtered.filter((s) => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
}

/**
 * Structural equality for two `getConnectedSources` results. Compares the
 * lightweight identity/label/value tuple AND the heavy `nodeData` blob so the
 * cache below only reuses the previous reference when nothing an upstream
 * consumer cares about changed. `nodeData` is compared recursively (it is the
 * upstream node's data record — `liveRefMap` reads its output via
 * extractNodeOutput, so a change there MUST bust the cache).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const aKeys = Object.keys(ao)
  const bKeys = Object.keys(bo)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false
    if (!deepEqual(ao[k], bo[k])) return false
  }
  return true
}

function sourcesEqual(
  prev: ReadonlyArray<SourceNodeInfo>,
  next: ReadonlyArray<SourceNodeInfo>,
): boolean {
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i]
    const n = next[i]
    if (
      p.id !== n.id ||
      p.type !== n.type ||
      p.label !== n.label ||
      p.value !== n.value ||
      p.providerCategory !== n.providerCategory ||
      p.sourceHandle !== n.sourceHandle ||
      p.targetHandle !== n.targetHandle ||
      p.edgeOutputMode !== n.edgeOutputMode
    ) {
      return false
    }
    if (!deepEqual(p.nodeData, n.nodeData)) return false
  }
  return true
}

// Single-consumer (ConfigPanel) cache of the last result so that typing into
// the *selected* node — which creates a fresh `nodes` array reference but does
// not change any upstream source — returns the SAME array reference. This keeps
// all [sources]-keyed memos in the config panels (and the PromptEditor refs)
// from thrashing on every keystroke.
let lastConnectedSources: ReadonlyArray<SourceNodeInfo> = []

/**
 * The nodes wired into `nodeId`, one per wire, as a config panel lists them.
 * A wire leaving a Teleport Receive carries exactly what entered its Send
 * (@nodaro/render-rules teleport-bypass.ts), so each source carries the ORIGIN's
 * type, pip and data — what the run reads — under the id the wire was DRAWN
 * from (`drawnSourceId`: the Receive), the id every per-wire setting and field
 * mapping is saved under. Takes the store's raw edges (or already-carried ones).
 */
export function getConnectedSources(
  nodeId: string,
  edges: ReadonlyArray<WorkflowEdge>,
  nodes: ReadonlyArray<WorkflowNode>,
): ReadonlyArray<SourceNodeInfo> {
  const sources: SourceNodeInfo[] = []
  for (const edge of bypassTeleports(nodes, edges)) {
    if (edge.target !== nodeId) continue
    const source = nodes.find((n) => n.id === edge.source)
    if (!source) continue
    const d = source.data as Record<string, unknown>
    sources.push({
      id: drawnSourceId(edge),
      type: source.type as string,
      label: (d.label as string) ?? source.type ?? source.id,
      value: extractDisplayValue(d, source.type as string),
      providerCategory: source.type === "provider" ? (d.category as string) : undefined,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      nodeData: d,
      edgeOutputMode: (edge.data as Record<string, unknown> | undefined)?.outputMode as string | undefined,
    })
  }
  // Content-stable: when the freshly-built list is structurally equal to the
  // previous one, return the previous reference so downstream memos keyed on
  // [sources] don't invalidate. Consumers that DO need upstream output changes
  // (liveRefMap → extractNodeOutput) still see them because `sourcesEqual`
  // deep-compares each source's `nodeData`.
  if (sourcesEqual(lastConnectedSources, sources)) {
    return lastConnectedSources
  }
  lastConnectedSources = sources
  return sources
}

/**
 * The nodes wired into `nodeId`, one per wire, for a panel that keys settings
 * per incoming node (track volumes, segment order, …): each is the node the wire
 * CARRIES — a Teleport Receive's origin, its type and data — with `id` set to
 * the id the wire was DRAWN from (`drawnSourceId`), the key its settings are
 * saved under. For display and setting keys only; never write one to the store.
 */
export function wiredInputNodes(
  nodeId: string | null | undefined,
  edges: ReadonlyArray<WorkflowEdge>,
  nodes: ReadonlyArray<WorkflowNode>,
): WorkflowNode[] {
  if (!nodeId) return []
  const out: WorkflowNode[] = []
  for (const edge of bypassTeleports(nodes, edges)) {
    if (edge.target !== nodeId) continue
    const carried = nodes.find((n) => n.id === edge.source)
    if (carried) out.push({ ...carried, id: drawnSourceId(edge) })
  }
  return out
}

export function getConnectedProviderModel(
  fieldMappings: FieldMappings,
  sources: ReadonlyArray<SourceNodeInfo>,
  nodes: ReadonlyArray<WorkflowNode>,
): string | undefined {
  const providerMapping = fieldMappings.provider
  if (!providerMapping) return undefined
  const source = sources.find((s) => s.id === providerMapping.sourceNodeId)
  if (!source || source.type !== "provider") return undefined
  // A provider sent through a Teleport pair is listed under the Receive's id
  // with the provider's data (getConnectedSources) — read that data.
  const d = source.nodeData ?? (nodes.find((n) => n.id === source.id)?.data as Record<string, unknown> | undefined)
  if (!d) return undefined
  return (d.model as string) ?? undefined
}

export function extractDisplayValue(data: Record<string, unknown>, nodeType: string): string {
  switch (nodeType) {
    case "text-prompt":
      return (data.text as string) ?? ""
    case "tone":
      return (data.tone as string) ?? ""
    case "style-guide":
      return (data.text as string) ?? ""
    case "provider":
      return `${data.provider ?? ""}/${data.model ?? ""}`
    case "scene-count":
      return `${data.count ?? ""} scenes`
    case "duration":
      return `${data.seconds ?? ""}s`
    case "aspect-ratio":
      return (data.ratio as string) ?? ""
    case "motion":
      return (data.motion as string) ?? ""
    case "reference-audio":
      return (data.videoTitle as string) || (data.extractedAudioUrl as string) ? "Audio ready" : "No audio"
    default:
      return (data.label as string) ?? ""
  }
}

// The LLM node → feature map, and each LLM node's two price ids, live in
// `@/lib/llm-price-ids` (the quick strip's model picker reads them too).
export { llmNodeFeature, llmNodePriceIds } from "@/lib/llm-price-ids"

/**
 * Does an edge feed this Add Captions node a TIMED caption source — a Transcript
 * on its `transcript` handle, or a transcribe node wired straight in? Either one
 * makes the render Remotion (`add-captions:kinetic`) whatever the node's own data
 * says, because the run resolves the wired source over `data.text`.
 *
 * UNKNOWN (no edges passed, or a node with no id) answers TRUE: the estimate may
 * over-quote, it must never under-quote. Mirror of the backend estimator's
 * `timedCaptionSourceWired` (ee/billing/credits.ts), which is the other half of
 * the same price.
 */
export function addCaptionsTimedSourceWired(
  nodeId: string | undefined,
  edges?: ReadonlyArray<WorkflowEdge>,
  nodes?: ReadonlyArray<WorkflowNode>,
): boolean {
  if (!edges || !nodeId) return true
  return edges.some((e) => {
    if (e.target !== nodeId) return false
    if (e.targetHandle === "transcript") return true
    return nodes?.some((n) => n.id === e.source && n.type === "transcribe") ?? false
  })
}

/**
 * The credit row an Add Captions node is priced against — the ONE place the
 * canvas badge, the panel's Generate button and every run-level estimate read,
 * so they cannot quote different prices for the same node.
 *
 * The price follows the RENDERER, via the same predicate the route's credit id,
 * payload-builder's reservation and the worker's dispatch use. `wiredTimedSource`
 * is the graph fact the node's own data cannot show (see above).
 */
export function addCaptionsCreditId(
  data: Record<string, unknown>,
  wiredTimedSource: boolean,
): "add-captions" | "add-captions:kinetic" {
  // `text` proves the cheap FFmpeg burn only when it is LITERAL: a `{Label}`
  // reference can resolve to nothing at run time, which leaves transcription as
  // the only source — timed captions, Remotion, the kinetic row.
  const rawText = typeof data.text === "string" ? data.text : undefined
  const literalText = rawText && !/\{[^{}]+\}/.test(rawText) ? rawText : undefined
  return captionRoutesToRemotion({
    style: data.style as string | undefined,
    text: literalText,
    segments: Array.isArray(data.segments) ? (data.segments as unknown[]) : undefined,
    transcript: wiredTimedSource ? {} : data.transcript,
    captions: Array.isArray(data.captions) ? (data.captions as unknown[]) : undefined,
    look: data.look,
    fontFamily: data.fontFamily,
    fontWeight: data.fontWeight,
    strokeColor: data.strokeColor,
    strokeWidth: data.strokeWidth,
    uppercase: data.uppercase,
    positionY: data.positionY,
    maxWordsPerLine: data.maxWordsPerLine,
  })
    ? "add-captions:kinetic"
    : "add-captions"
}

/**
 * The credit-cost row a node should be priced against.
 *
 * `edges` is optional graph context, read ONLY by node types whose price
 * depends on the graph rather than on their own data (today: video-audit,
 * whose credit FAMILY is chosen by whether an analysis is wired). Every caller
 * that has the edge list should pass it — without it those types fall back to
 * their never-under-quoting default family.
 *
 * `nodes` is the same idea one hop further out, for a price that lives in
 * another node's data: render-video is priced by the FRAME SIZE of the plan an
 * upstream composer holds. A caller that omits it quotes the flat render price
 * — right for every canvas-authored scene (whose aspects all cap at 1920 px)
 * and an under-quote only for an imported or MCP-written 2560 px plan.
 */
/** No upstream node re-runs: a single-node quote (its pill, its Run button). */
const NO_RERUNS_FOR_ID: ReadonlySet<string> = new Set()

export function getModelIdentifier(
  storedNode: WorkflowNode,
  edges?: ReadonlyArray<WorkflowEdge>,
  nodes?: ReadonlyArray<WorkflowNode>,
  /** The nodes about to run, for a whole-run estimate: a Social Search among
   *  them prices the Video Analysis after it at the ceiling (new posts). */
  reruns?: ReadonlySet<string>,
): string {
  // Priced as it runs: a wired Settings input sets the model and length.
  const node = withWiredSettings(storedNode, nodes, edges)
  const data = node.data as Record<string, unknown>
  // Dubbing: its language's per-minute row (Hebrew rides the separately priced
  // project API) — the row the route and the workflow run reserve on, × the
  // started minutes of the span (`getExactPricingUnits`).
  if (node.type === "dubbing") return /^(he|heb)$/i.test(String(data.targetLanguage ?? "")) ? "elevenlabs-dubbing-v2" : "elevenlabs-dubbing"
  // A use-case node (Tighten Episode) reserves its fee on its own id; its
  // steps are priced as the chain it builds (estimate-run-credits.ts).
  if (isUseCaseNodeType(node.type)) return usecaseFeeCreditId(node.type)


  // Render Video: the frame-size tier of the plan it will actually send, from
  // the SAME resolver the orchestrator uses to pick the row it charges.
  if (node.type === "render-video") return renderVideoCreditIdForNode(node, nodes, edges)

  // Generate Music reserves on the music id whatever the model (the route and
  // the orchestrator both do); the model id "minimax" is the MiniMax VIDEO price.
  if (node.type === "generate-music") return MUSIC_CREDIT_ID

  // Component nodes: return empty string so the fallback estimateNodeCredits is used
  // (component cost depends on estimatedCredits from the published metadata, not a model lookup)
  if (node.type === "component") return ""

  // Content Recipe / Content Ideas: the shared builders — the same ids the
  // cloud route, the orchestrator and the node badge use (the effective
  // model's tier; ideas add the per-five-ideas bucket).
  if (node.type === "content-recipe") return contentRecipeCreditId(data.llmModel, data.reasoningEffort as string | undefined)
  if (node.type === "content-ideas") return contentIdeasCreditId(data.count, data.llmModel, data.reasoningEffort as string | undefined)

  // A metered LLM node: its per-model estimate once the server has priced its
  // key as one (`llmNodePriceIds`), else today's id below — the tier id, for
  // the 3D scene nodes their own row, and for a Choose Best AI judge the node
  // type's. A cold cache and the tier-pricing rollback therefore quote exactly
  // what they always did.
  const llmIds = llmNodePriceIds(node)
  if (llmIds) {
    const resolved = resolveLlmPriceId(llmIds)
    if (resolved === llmIds.key) return resolved
  }

  // Choose Best's AI judge, not (yet) an estimate: the id its route reserves
  // and the server's estimate prices it at (`reduceCreditIdentifier` /
  // `CREDIT_COSTS["reduce"]`) — the judge model's tier, from the model alone.
  // The node type's own id is priced nowhere, so a judge used to quote 0.
  if (node.type === "reduce" && llmIds) {
    const judgeModel = (data.strategyConfig as { llmModel?: unknown } | undefined)?.llmModel
    return buildLlmCreditIdentifier("reduce:pick-best-llm", typeof judgeModel === "string" ? judgeModel : undefined)
  }

  // motion-graphics: feature is engine-dependent (design §8 — every credit-id site branches on engine)
  if (node.type === "motion-graphics") {
    const feature = motionGraphicsFeature(data.engine as string | undefined)
    return buildLlmCreditIdentifier(feature, (data.llmModel as string | undefined) || LLM_FEATURE_DEFAULTS[feature], data.reasoningEffort as string | undefined, data.advancedMode === true)
  }

  // LLM-powered nodes: use composite credit identifier based on selected model tier.
  // An unset effort is the one the run uses — the model's recipe effort for
  // the feature (describe-to-picker's high on Opus 5.5), else none.
  const llmFeature = LLM_NODE_FEATURE_MAP[node.type ?? ""]
  if (llmFeature) {
    const llmModel = data.llmModel as string | undefined
    const effort = (data.reasoningEffort as string | undefined) ?? defaultReasoningEffort(llmFeature, llmModel)
    return buildLlmCreditIdentifier(llmFeature, llmModel || LLM_FEATURE_DEFAULTS[llmFeature], effort, data.advancedMode === true)
  }

  const nodeType = node.type ?? "unknown"

  // Suno: the ROUTE contract decides which operations are version-priced
  // (routes/suno.ts — generate/cover/extend only). `sunoCreditType` gates on
  // the operation, and the node type IS the operation key, so this one call
  // covers every Suno node. Identical to the backend estimator's branch in
  // ee/billing/credits.ts — same function, no second copy to drift.
  // suno-separate is excluded because its branch below is a different axis.
  if (nodeType.startsWith("suno-") && nodeType !== "suno-separate") {
    return sunoCreditType(data.model as string | undefined, nodeType)
  }

  // Suno separate: each mode has its own price (the shared rule)
  if (nodeType === "suno-separate") {
    return sunoSeparateCreditId(data.type)
  }

  // Audio separation (Demucs): "best" quality costs more
  if (nodeType === "audio-separation") {
    return (data.quality as string) === "best" ? "audio-separation:best" : "audio-separation"
  }

  // Entity nodes: use provider field (default nano-banana)
  if (nodeType === "character" || nodeType === "face" || nodeType === "object" || nodeType === "location") {
    const entityProvider = (data.provider as string) || IMAGE_MODEL_ROLE_DEFAULTS.character
    return buildCreditModelIdentifier(entityProvider, data)
  }

  if (nodeType === "web-scrape") {
    const rawActor = data.actor
    const actor = isScraperActor(rawActor) ? rawActor : "google-search"
    const mode = data.mode === "site" ? "site" : "page"
    return buildScraperCreditId({ actor, mode })
  }

  // Meta Ads: tiered on count × sources — the same builder the node card
  // (estimateNodeCredits) and the backend guard/reservation use, so the run
  // total, the pre-run precheck and the >100cr confirm never under-quote.
  if (nodeType === "meta-ads-scrape") {
    // ONE identifier (packages/shared) from count × sources × analysis — the
    // same builder the backend guard + reservation use.
    return metaAdsScrapeCreditIdFromNode(data)
  }

  // Instagram: tiered on count × sources (+ analysis), like Meta Ads. It had no
  // branch here, so it fell through to the bare node type — and the panel's Run
  // button, the Execute total and the >100 cr confirm all quoted the flat
  // "instagram-scrape" row while the route reserved the tiered one. Same builder
  // as the backend estimator (ee/billing/credits.ts) and the guard.
  // Social Search: the page count the run reserves (one page per 20 posts) —
  // the builder the orchestrator and the plugin route share.
  if (nodeType === "social-search") {
    return socialSearchCreditIdFromNode(data)
  }
  if (nodeType === "instagram-scrape") {
    return instagramScrapeCreditIdFromNode(data)
  }

  // Add Captions: the price follows the RENDERER, not the style — see
  // addCaptionsCreditId, which the node's own badge reads too (through
  // use-add-captions-credit-id) so the pill and the panel cannot disagree.
  if (nodeType === "add-captions") {
    return addCaptionsCreditId(data, addCaptionsTimedSourceWired(node.id, edges, nodes))
  }

  // Video-analysis: tier+duration composite — the SAME id the node badge
  // requests, so the run-level estimates (Execute badge, run-confirm dialog,
  // precheck) hit the same model-cost row. Falling through to the bare
  // "video-analysis" key priced EVERY run at that row's seeded worst case
  // (smart @ 600s ceiling — the dialog quoted ~1868 for a run that billed 149,
  // 2026-08-03). Duration mirrors estimateNodeCredits: the YouTube probe is
  // trusted only while it still matches the node's current youtubeUrl; a wired
  // video's url-bound probe is the fallback; unknown → the TIER'S own ceiling
  // bucket (never the smart ceiling).
  if (nodeType === "video-analysis") {
    const probedYoutube = data.probedYoutube as { url: string; durationSec: number } | undefined
    const probedVideo = data.probedVideo as ProbedVideoInfo | undefined
    // A Social Search's posts wired in: the longest of their videos.
    const fromPosts = wiredSocialPostsVideoSec(node.id, edges, nodes, reruns)
    const durationSec = fromPosts !== null
      ? fromPosts
      : (probedYoutube && probedYoutube.url === data.youtubeUrl ? probedYoutube.durationSec : undefined) ?? probedVideo?.durationSec
    return buildVideoAnalysisCreditId(resolveVideoAnalysisModel(data.llmModel as string | undefined), durationSec)
  }

  // Video Depth: the duration bucket of the wired clip, through the SAME
  // provider resolution and bucket rule the backend estimator and the route
  // reserve by (`resolveVideoDepthProvider` + `videoDepthCreditId`) — the node's
  // own badge reads the same upstream length: the producer's own length field,
  // else the clip's metadata the node caches as `probedVideo`. Unknown length →
  // the provider's highest reachable row (fal 300 s, Replicate 120 s), never the
  // cheapest.
  if (nodeType === "video-depth") {
    const probedVideo = data.probedVideo as ProbedVideoInfo | undefined
    return videoDepthCreditId(
      resolveVideoDepthProvider(data.provider),
      upstreamVideoDurationSec(node.id, "video", nodes ?? [], edges ?? []) ?? probedVideo?.durationSec,
    )
  }

  // Video-audit: family × duration composite — the SAME id the node badge
  // requests (video-audit-node.tsx), so every run-level estimate (Execute
  // badge, run-confirm dialog, precheck) hits the same model-cost row the pill
  // shows. Falling through to the bare "video-audit" key would price EVERY run
  // at the re-audit family's 600s ceiling — under-quoting every auto-family run
  // (no analysis wired) and over-quoting every short clip. The family comes
  // from the EDGES (videoAuditAnalysisWired); the duration from the node's
  // url-bound probe, exactly as estimateNodeCredits reads them.
  if (nodeType === "video-audit") {
    const probedVideo = data.probedVideo as ProbedVideoInfo | undefined
    return buildVideoAuditCreditId({
      analysisProvided: videoAuditAnalysisWired(node.id, edges),
      durationSec: probedVideo?.durationSec,
    })
  }

  // Audio Sync: priced per source aligned to the reference — `audio-sync:<n>src`
  // from the number of recordings wired into `sources` (the SAME count the
  // node's pill and estimateNodeCredits read, lib/audio-sync). Without edges it
  // quotes the 6-source ceiling rather than the cheapest row.
  if (nodeType === "audio-sync") {
    return audioSyncCreditId(audioSyncWiredSourceCount(node.id, edges))
  }

  // Edit Plan: mode × tier × duration-bucket composite — the SAME id the reserve
  // builds (payload-builder), so the run-level estimates (Execute badge,
  // run-confirm dialog, precheck) hit the same seeded model-cost row. Falling through
  // to the bare "edit-plan" key priced EVERY run at the table MAX (1480) or, with
  // no NODE_CREDIT_COSTS entry, at the 1-credit placeholder — the documented
  // video-analysis under-quote trap (run fails mid-DAG after transcribe charged).
  // Duration is the MASTER source's length via the ONE resolver the node's cost
  // pill also uses (lib/edit-plan-estimate), so the pill and the run-level
  // estimates cannot disagree. Unknown → the tier's own ceiling bucket — never a
  // length borrowed from the wired transcript (see that module: this estimate
  // gates the run, and the browser's transcript is the PREVIOUS run's). Callers
  // MUST pass `nodes`; without them the master lane is blind.
  // Per started minute (decided 2026-10-07): when the server's plugin charges
  // that way (`GET /v1/edit-plan/capabilities` → perMinute) the id carries the
  // source's started minutes, priced flat + rate × N server-side; else the step.
  if (nodeType === "edit-plan") {
    const durationSec = resolveEditPlanEstimateDurationSec(node, nodes ?? [], edges ?? [])
    return editPlanReserveCreditId(asEditPlanMode(data.mode), asEditPlanTier(data.planTier), durationSec, editPlanPerMinuteReported())
  }

  // HeyGen avatar nodes + reference sheet are COMPOSITE-only priced (duration/
  // resolution reserve buckets; still/motion assembly). Delegate to the SAME
  // resolvers the per-node cost pills use so the model-costs batch requests a
  // seeded composite, not the bare provider/type key (`heygen` / `reference-sheet`
  // are intentionally unpriced — the bare key triggered the "operator must seed"
  // warning and would 503 at Run time).
  if (nodeType === "ai-avatar") return resolveAiAvatarCreditId(data)
  if (nodeType === "cinematic-avatar") return resolveCinematicCreditId(data)
  if (nodeType === "reference-sheet") {
    return referenceSheetCreditId(data.flavour as { outputFormat?: string } | undefined)
  }
  // SwitchX (Beeble): cost = frame-block tier × resolution, but the editor can't
  // know the source's frame count until the job runs. Show the WORST-CASE (240-
  // frame) tier for the chosen resolution so every estimate (run-button pill,
  // run-confirm gate, precheck) is one consistent SAFE UPPER bound — the real
  // reserve is always ≤ this, and it matches exactly for ~8s clips. (Bare
  // `beeble-switchx` is the resolution-blind 1080p worst-case — never use it for
  // a 720p node.) Must match the id in switchx-node.tsx's run-button pill.
  if (nodeType === "switchx") {
    return `beeble-switchx:240f:${data.maxResolution === 720 ? 720 : 1080}p`
  }

  // Video nodes with duration/audio-based variable pricing or T2V cost overrides.
  // generate-video uses i2v as the FE display default — the backend
  // payload-builder swaps for t2v dynamically at execution based on connected
  // inputs (matches generate-video-node.tsx's credit-estimate behavior).
  //
  // ABOVE the `!provider` bail on purpose: a provider-less video node is not an
  // unpriced node. The routes and the orchestrator both fill the provider from
  // `applyDefaultVideoSelection` (payload-builder's `generate-video` case, and
  // routes/generate-video.ts), so the estimate has to quote THAT model. Falling
  // through to the bare node type asked GET /v1/credits/model-cost for
  // "generate-video", which has no pricing row — 503 price_not_configured and a
  // blank cost on the Run button (production app-report, 2026-09-13).
  if (nodeType === "image-to-video" || nodeType === "text-to-video" || nodeType === "generate-video") {
    const sel = applyDefaultVideoSelection({
      provider: data.provider as string | undefined,
      duration: data.duration as number | string | undefined,
    })
    const sound = (data.sound ?? data.kling3Sound) as boolean | undefined
    const videoNodeType: "image-to-video" | "text-to-video" =
      nodeType === "text-to-video" ? "text-to-video" : "image-to-video"
    // The reference video is a GRAPH fact — a wired videoReferences edge —
    // never node data (nothing writes `referenceVideoUrls` into these nodes).
    // The shared builder applies the resolution fill + Seedance Draft the run
    // applies, so Generate Video and Video to Video's Seedance edit lane quote
    // one id for one KIE call.
    return videoGenerationCreditId({
      provider: sel.provider,
      duration: sel.duration,
      sound,
      nodeType: videoNodeType,
      mode: (data.videoSize ?? data.mode) as string | undefined,
      resolution: data.resolution as string | undefined,
      draft: data.draft === true,
      hasVideoRef: sendsReferenceVideo(node.id, sel.provider, typeof data.audioSoundtrack === "boolean" ? data.audioSoundtrack : undefined, edges ?? []),
    })
  }

  // Transcribe reserves on the ENGINE — execute-node sends
  // `d.provider || DEFAULT_TRANSCRIBE_NODE_PROVIDER` and payload-builder reserves
  // that same lane — so a provider-less node (agent-written / imported JSON; the
  // canvas default fills one in) must be quoted on the engine, not on the bare
  // `transcribe` row. ABOVE the `!provider` bail for exactly that reason. Mirror
  // of the backend estimator's transcribe branch (ee/billing/credits.ts).
  if (nodeType === "transcribe") {
    return (typeof data.provider === "string" && data.provider) || DEFAULT_TRANSCRIBE_NODE_PROVIDER
  }

  // Adjust Speed: the smooth tier is its own, dearer id (route + orchestrator
  // price it the same way), so the estimate must not quote the fast tier.
  if (nodeType === "speed-ramp") return speedRampCreditId(data.quality)

  // A render (Apply EDL, Speaker View): the per-minute row its registry entry
  // names for the render's quality — and, for Speaker View, the price tier its
  // graph tells (the edit on its wire, else its settings; `@nodaro/render-rules`)
  // — the id the route and the orchestrator reserve on. Every estimate
  // multiplies it by the render's minutes (PRICING_UNIT_ESTIMATORS).
  if (isRenderNodeType(nodeType)) {
    const id = renderEstimateCreditId({ id: node.id, type: nodeType, data }, nodes as never, edges as never, reruns ?? NO_RERUNS_FOR_ID, editPlanOutputOf)
    if (id !== undefined) return id
  }

  // Video Retake: priced per second of the replaced window — its per-second
  // row, which every estimate multiplies by the seconds (PRICING_UNIT_ESTIMATORS).
  if (nodeType === "video-retake") return LTX_RETAKE_PER_SECOND_CREDIT_ID

  // Text to Audio: the per-second row for the length the node asks for (no
  // duration = 5 s), on the engine the run uses — the default when the node
  // names none. The same id the route and the orchestrator reserve; ABOVE the
  // `!provider` bail so a provider-less node is quoted on the default engine.
  if (nodeType === "text-to-audio") return textToAudioCreditId(data.provider as string | undefined, data.duration)

  // Video SFX: the price row for the clip's length through the rule the run
  // charges by (videoSfxCreditId; the run itself measures the real file). A
  // clip whose length the graph tells (a render's output, a chain of
  // length-priced steps) is quoted at that length, at most 300 seconds, as the
  // listing and the server's run estimate quote it (decided 2026-10-07); else
  // the upstream video's reported duration. Unknown → the 300s row, the most a
  // run that measures the clip can be charged (videoSfxQuoteCreditId, decided
  // 2026-10-13), as the node's own Run button and the server quote it.
  if (nodeType === "video-sfx") {
    return videoSfxQuoteCreditId(videoSfxQuotedSec(node, nodes ?? [], edges ?? [], reruns))
  }

  // Pitch & Tempo: per started minute of its input (decided 2026-10-12) — the
  // `pitch-tempo:<N>m` id the route and the workflow run reserve from the
  // measured file. Quoted at the length the graph or the upstream node tells;
  // unknown → 30 minutes, the most a run is charged (it refuses a file it
  // cannot measure — pitchTempoQuoteCreditId, decided 2026-10-13).
  if (nodeType === "pitch-tempo") {
    return pitchTempoQuoteCreditId(pitchTempoQuotedSec(node, nodes ?? [], edges ?? [], reruns))
  }

  // Video Mask: the price row for the clip's length (videoMaskCreditId — the
  // rule the route and the run charge by; the run measures the real file at
  // the 30 fps basis). The clip length is read exactly as Video SFX reads it
  // (`videoMaskQuotedSec`), as the server's run estimate does. Unknown → the
  // longest row. ABOVE the provider fallthrough: `provider: "sam-3"` has no
  // price row of its own.
  if (nodeType === "video-mask") {
    return videoMaskCreditId(videoMaskQuotedSec(node, nodes ?? [], edges ?? [], reruns), resolveVideoMaskProvider(data.provider))
  }

  // Text to Speech / Text to Dialogue by length (decided 2026-10-06): when the
  // server serves the model's per-100-characters unit row (length pricing on — the
  // row is in the price cache), the estimate prices on the server's price for
  // the whole request once it is cached, else on the unit row; the units come
  // from the SAME pair in PRICING_UNIT_ESTIMATORS (workflow-editor/types.ts), so
  // the id and the units can never flip apart. A row not served (flag off, or
  // a cold cache) falls through to today's flat rows below.
  if (nodeType === "text-to-speech" || nodeType === "text-to-dialogue") {
    const speech = speechQuote(nodeType, data, upstreamSpeechText(node, nodes ?? [], edges ?? [], {}), getCachedModelCredits)
    if (speech) return speech.priced.id
  }

  // Text to Dialogue reserves on its dialogue model's own row — the route's
  // guard and the orchestrator both call dialogueProviderOf, so a node with no
  // (or an unknown) provider is quoted as the v3 dialogue it runs as. ABOVE the
  // `!provider` bail, which quoted the node-type row. Mirror of the backend
  // estimator's branch (ee/billing/credits.ts).
  if (nodeType === "text-to-dialogue") return dialogueProviderOf(data.provider)

  // Video Upscale on Topaz (the provider a node naming none runs on): metered —
  // the run holds the Topaz units its source needs at this one-unit row and is
  // charged the units Topaz reports. Every estimate multiplies the row by the
  // units it quotes (PRICING_UNIT_ESTIMATORS → videoUpscalePricingUnits). ABOVE
  // the `!provider` bail, which quoted the node-type row.
  if (nodeType === "video-upscale" && isTopazVideoUpscaleProvider(data.provider)) return TOPAZ_VIDEO_UNIT_CREDIT_ID

  const provider = data.provider as string | undefined
  if (!provider) return nodeType

  // Video to Video, Seedance EDIT lane: Seedance has no v2v endpoint — the node
  // dispatches a text-to-video job in edit shape — so it reserves on the
  // reference-video ladder at the model's longest clip. ONE shared builder with
  // the orchestrator's reserve (payload-builder.ts) and the node's cost pill, so
  // the Execute badge / run-confirm dialog / precheck quote exactly what the run
  // holds. Falling through to `buildCreditModelIdentifier` would ask
  // /v1/credits/model-cost for the bare `seedance-2-5` key — the 8s 720p row,
  // an under-quote of every longer or higher-res edit.
  if (nodeType === "video-to-video" && isSeedanceVideoEditProvider(provider)) {
    return seedanceVideoEditCreditId(provider, data.v2vResolution as string | undefined, data.draft === true)
  }

  // Extend-video: VEO quality costs more than fast
  if (nodeType === "extend-video" && provider === "veo-extend" && data.model === "quality") {
    return "veo-extend:quality"
  }

  // Extend-video: LTX 2.3 Pro is priced per second added — its per-second row,
  // which every estimate multiplies by the seconds (PRICING_UNIT_ESTIMATORS).
  if (nodeType === "extend-video" && provider === "ltx-2.3-pro") return LTX_EXTEND_PER_SECOND_CREDIT_ID

  // Motion transfer: duration-tiered pricing
  if (nodeType === "motion-transfer") {
    return buildMotionCreditModelIdentifier(
      (data.provider as string) ?? "kling",
      (data.resolution as string) ?? "720p",
      data.videoDuration as number | undefined,
    )
  }

  return buildCreditModelIdentifier(provider, data)
}

/**
 * Build composite credit model identifier from provider + node data.
 * Extracts quality/resolution/renderingSpeed from data and delegates to the shared function.
 */
export function buildCreditModelIdentifier(provider: string, data: Record<string, unknown>): string {
  // flux-2-max bills per reference image — the UI cost preview pulls the
  // ref count from `data.referenceImageUrls` (panel-local mirror of the wired
  // refs) so the displayed credit number matches what the route will charge.
  const refs = data.referenceImageUrls as string[] | undefined
  const refCount = refs?.length ?? 0
  // Topaz bills on the upscale FACTOR. The legacy `targetResolution` still on
  // stored node data is mapped forward by resolveTopazUpscale — the same
  // authority the route, the estimator and the worker use — so the credit badge
  // shows the tier that will actually be reserved and rendered.
  const targetResolution = provider === "topaz-image-upscale"
    ? resolveTopazUpscale({
        upscaleFactor: data.upscaleFactor as string | undefined,
        targetResolution: data.targetResolution as string | undefined,
      }).creditTier
    : (data.targetResolution as string | undefined)
  return sharedBuildCreditModelIdentifier(
    provider,
    data.quality as string | undefined,
    data.resolution as string | undefined,
    data.renderingSpeed as string | undefined,
    targetResolution,
    refCount,
  )
}
