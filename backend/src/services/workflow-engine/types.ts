/**
 * Shared types for the backend workflow execution engine.
 */

import type { MediaItem } from "../social/platforms/index.js"
import type { BillingContext } from "../../lib/billing-context.js"
import type { Caption } from "@remotion/captions"
import type { ErrorHint } from "../../lib/safety-block.js"
import type { NodeExecutionStatus, NodeExecutionStateWire, NodeSkipReason, VideoOverlayWarning, RenderQuality, RunResultRowStamp } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Node execution state (stored in workflow_executions.node_states JSONB)
// ---------------------------------------------------------------------------

export interface NodeOutput {
  imageUrl?: string
  /** generate-mask second output — the generated mask PNG. Routed to the "mask"
   *  source handle by getPrimaryOutput (the "image" handle returns imageUrl). */
  maskUrl?: string
  /** image-overlay's extra platform renders — one per "export also for"
   *  platform, routed to the `variant:<platformId>` source handles. */
  variants?: ReadonlyArray<{ id: string; label?: string; url: string; width?: number; height?: number }>
  videoUrl?: string
  audioUrl?: string
  /** Multi-variant URLs from a single job. Primary at index 0. Singular
   *  `imageUrl`/`audioUrl` stays populated for downstream chaining. */
  imageUrls?: readonly string[]
  audioUrls?: readonly string[]
  text?: string
  /** Single aggregated output value (used by fan-in nodes like reduce). */
  result?: string
  /** Reduce strategy metadata beside `result` — the AI judge's
   *  `selectedIndex` / `reasoning` / `summary` (concat etc. carry `summary`
   *  only). The canvas node shows the reasoning and highlights the winner from
   *  it, exactly as the single-node Run does from the route response. */
  reduceMeta?: Record<string, unknown>
  /** JSON output for web-scrape and future JSON-emitting nodes. */
  json?: unknown
  /** An Edit Plan state whose `json` is NOT the plan as planned — a seed (from
   *  saved data, or from an earlier execution) with the person's review
   *  applied — carries the plan as planned here, so a later continuation
   *  judges a newer review against the plan it was made on. Absent: `json` IS
   *  the plan as planned (the plan ran, or no review applied). See
   *  `run-continuation.ts`. */
  plannedJson?: unknown
  /** Extract Field node output — newline-joined list of extracted values. */
  extractedText?: string
  /** Generate Text (llm-chat) second output — the result split on `===NEXT===`
   *  (via `splitGeneratedItems`) so downstream nodes can fan out per item. */
  items?: string[]
  /** JSON Process node output — filtered/transformed JSON value. */
  processedResult?: unknown
  plan?: Record<string, unknown>
  /** motion-graphics (lottie engine) second output — the authored Lottie JSON's
   *  R2 URL. Routed to the "lottie" source handle by getPrimaryOutput (the
   *  default "composition" handle returns the plan marker). */
  lottieUrl?: string
  thumbnailUrl?: string
  sunoTrackId?: string
  sunoTaskId?: string
  /** Every Suno track's id + media, in variant order (#819) — `sunoTrackId` alone is always track #1. */
  sunoTracks?: Array<{ id?: string; title?: string; duration?: number; imageUrl?: string; audioUrl?: string }>
  generatedVoiceId?: string
  alignment?: unknown
  script?: unknown
  vocalUrl?: string
  instrumentalUrl?: string
  /** audio-separation (Demucs) full-stems outputs. */
  drumsUrl?: string
  bassUrl?: string
  otherUrl?: string
  guitarUrl?: string
  pianoUrl?: string
  splitResults?: string[]
  combinedText?: string
  kieTaskId?: string
  paramOutputs?: Record<string, string>
  /** Accumulated results from fan-out (list/loop/split-text) execution */
  listResults?: string[]
  /** content-ideas: the own brand whose lessons the run leaned on, and how
   *  many — the node's "leaned on" line, kept on a server run too. */
  brandLessons?: { brand: string; lessons: number }
  /** social-search: EVERY post the search found (the editor's picker grid);
   *  `json` holds only the posts the node passes on. Lets a server-side run
   *  repaint the node card the way the editor's own run does. */
  searchResults?: unknown[]
  /**
   * The same list ROW-ALIGNED with the array it was cut from: one entry per
   * element, "" where the element has no value (Extract Field, List output).
   * Read ONLY by the fan-out, so two lists cut from one array pair by row.
   * `listResults` stays the public list — the values that exist — which is what
   * item / item:N / range / Bundle and every list node index.
   */
  alignedListResults?: string[]
  /**
   * Video Overlay list fan-out: each row's own freshness key
   * (`videoOverlayCompositionKey` of the composition that produced that row),
   * ROW-ALIGNED with `listResults` — "" where the row has none. Absent when no
   * iteration carried a key. The canvas stamps each result row with it.
   */
  listResultCompositionKeys?: string[]
  /**
   * Each row's identity — its job, thumbnail and, for a render, `quality`,
   * `clipKey`, `planBasis` and `renderBasis` — ROW-ALIGNED with `listResults` (`{}` where the row has none).
   * The editor stamps each result row with it; pairing rows with `jobIds` by
   * position mis-paired once a row failed or finished out of order.
   */
  listResultStamps?: RunResultRowStamp[]
  /** apply-edl: the quality the render was made at ("proxy" is a Preview). */
  quality?: RenderQuality
  /** apply-edl: the plan clip the render cut (`edlSpanKey`), as its payload gave it. */
  clipKey?: string
  /** apply-edl: the plan value the render cut (`renderReadBasis`), when it read the plan's own value. */
  planBasis?: string
  /** apply-edl: the render's own settings and effective sources (`effectiveRenderBasis`). */
  renderBasis?: string
  /** Selector node `picked` output channel (selected items). */
  pickedResults?: string[]
  /** Selector node `rest` output channel (items NOT picked). */
  restResults?: string[]
  /** Sub-workflow output port values for handle-based routing in getPrimaryOutput */
  _outputResults?: Record<string, string>
  /** Sub-workflow visible output port ID (from routeSnapshot.visibleOutputPortId) */
  _visibleOutputPortId?: string
  /** Sub-workflow-input injected port values for handle-based routing */
  _injectedPortValues?: Record<string, string>
  /** Preview node collected upstream items */
  previewItems?: Array<{
    type: "image" | "video" | "audio" | "data" | "text"
    value: string
    sourceNodeId: string
    sourceNodeLabel: string
  }>
  /** Adjust-volume: tracks whether last input was audio or video for correct output routing */
  _lastInputType?: "audio" | "video"
  /** QA-check: whether content passed the quality check */
  approved?: boolean
  /** QA-check: explanation text */
  reason?: string
  /** QA-check: quality score 0.0-1.0 */
  score?: number
  /** Image-critic: 1-3 imperative sentences. */
  feedback?: string
  /** Image-critic: per-mode breakdown + issues array. */
  details?: {
    perMode?: Record<string, { score: number; feedback: string }>
    issues?: Array<{ category: string; severity: "blocking" | "warning" | "info"; description: string }>
  }
  /** Router: list of active route IDs */
  activeRoutes?: string[]
  /** Router: route ID -> output value (undefined for inactive routes) */
  routeOutputs?: Record<string, string | undefined>
  /** Webhook-output: whether the POST returned a 2xx status */
  webhookSuccess?: boolean
  /** Webhook-output: HTTP status code from the destination */
  webhookStatusCode?: number
  /** Webhook-output: first 2000 chars of the response body */
  webhookResponseBody?: string
  /** Word-timed captions output (transcribe node when wordTimestamps enabled). */
  captions?: Caption[]
  /** Suno-voice source node — custom voice persona identifier. Consumed by
   *  `getPrimaryOutput` and routed to `personaId` on music nodes by the input
   *  resolver. */
  voiceId?: string
  /** Reference Sheet — clean panel URLs emitted on the `panels` output handle.
   *  `imageUrl` carries the composited sheet (the `sheet` handle); `panelUrls`
   *  is the multi-image reference set spread into a downstream node's
   *  `referenceImageUrls`. */
  panelUrls?: readonly string[]
  /** 3D Render Pro: one still per shot of the exported composition, in shot order. */
  shotStills?: ReadonlyArray<{ shotIndex: number; frame: number; assetId: string; url: string }>
  /** Video Overlay: the worker's warnings (clipped / skipped / …) — the node's "Last run" line. */
  warnings?: ReadonlyArray<VideoOverlayWarning>
  /** Video Overlay: the output canvas and length. */
  width?: number
  height?: number
  durationSec?: number
  /** Video Overlay: the freshness key the DAG payload stamped (`videoOverlayCompositionKey`). */
  resultCompositionKey?: string
}

/**
 * Re-exported from `@nodaro/shared` so the orchestrator, the SDK and the editor
 * partition node status against ONE union. Local members used to be free to
 * drift; the rule that a `failed` node may carry `output` (and a `pending` one
 * may not) lives beside it there, as `OUTPUT_BEARING_NODE_STATUSES`.
 */
export type { NodeExecutionStatus }

export interface NodeExecutionState {
  status: NodeExecutionStatus
  nodeType?: string
  jobId?: string
  /** All job IDs from fan-out iterations (when node runs multiple times via list/loop). */
  jobIds?: string[]
  usageLogId?: string
  creditsUsed?: number
  output?: NodeOutput
  /** Resolved inputs fed to this node (stored for debugging). */
  inputs?: Record<string, unknown>
  error?: string
  /** Stable code for a refusal the UI may branch on, never on text. Two
   *  producers today: a mapped billing refusal (reserve-errors.ts — P16's
   *  budget UI) and the pre-dispatch reference-video duration gate
   *  (`video_too_long`). PRESENCE alone does not mean "billing" — read the
   *  specific code, the way `isInputWarningCode` does on the frontend. */
  errorCode?: string
  /** PR9 (2026-09-03): the worker's structured content-policy verdict
   *  (`jobs.error_hint`, migration 376), carried through unchanged from
   *  `pollJobToCompletion`'s thrown Error the same way `errorCode` rides a
   *  mapped billing refusal — never re-derived from `error`'s free text. */
  errorHint?: ErrorHint
  startedAt?: string
  completedAt?: string
  /** Total fan-out iterations (when node runs via list/loop) */
  iterationTotal?: number
  /** Completed fan-out iterations so far */
  iterationCompleted?: number
  /** Current job progress (0-100) — surfaced by pollJobToCompletion so the
   *  UI can render a progress bar during backend runs. */
  progress?: number
  /** True while this node's job sits in `jobs.status = 'pending_review'`:
   *  generated, but the output is withheld pending a human decision.
   *
   *  Deliberately a SIDECAR and NOT a new `NodeExecutionStatus` member
   *  (spec 2026-09-03-job-policy-hook-design D15): `status` stays `"running"`
   *  so every hand-rolled partition of that union keeps counting the node as
   *  active — most importantly `lib/reconcile/workflow-executions-cron.ts`'s
   *  `anyActive`, where a fourth status member would go false and
   *  `anyFailed && !anyActive` would flip the whole execution to `failed`
   *  while a child is legitimately under review. Cleared when the job leaves
   *  review. */
  awaitingReview?: boolean
  /** The run built this state from the node's saved data (or its own config)
   *  instead of running it: a source or parameter node, a node frozen with
   *  Skip, a node outside a partial run's subset. Only then may a reader fall
   *  back to the node's saved results — see `saved-data.ts`. */
  fromSavedData?: true
  /** A continued run (`WorkflowExecutionJob.continueFromExecutionId`) built
   *  this state from that EARLIER execution's state of the node, not by
   *  running it: the id of that execution. Saved data only where that
   *  execution's own state was (`fromSavedData`: a frozen node, or one outside
   *  its subset — a source, parameter or Edit Plan only in a continuation of
   *  an app run whose own overrides do not name it); otherwise no reader
   *  falls back to the node's saved results — see `run-continuation.ts`. */
  seededFromExecution?: string
  /** Why the RUN skipped this node (`empty-input-skips.ts`); a router-gated node carries none. */
  skipReason?: NodeSkipReason
}

/**
 * The orchestrator's state must stay a SUPERSET of the published wire contract
 * — a compile error here means the two have drifted (a renamed field, a
 * narrowed status, an `output` that stopped being an object) and every client
 * reading `nodeStates` is already wrong.
 */
const _nodeExecutionStateIsWireCompatible: NodeExecutionStateWire<NodeOutput> =
  undefined as unknown as NodeExecutionState
void _nodeExecutionStateIsWireCompatible

// ---------------------------------------------------------------------------
// Orchestrator job data (enqueued to BullMQ)
// ---------------------------------------------------------------------------

export interface WorkflowExecutionJob {
  executionId: string
  workflowId: string
  userId: string
  triggerType: "manual" | "webhook" | "schedule" | "api" | "telegram" | "telegram_account" | "app_run"
  triggerData?: Record<string, unknown>
  /** Optional subset of node IDs to execute (for "run from here" / "run selected"). */
  nodeIds?: string[]
  /**
   * Continue from an earlier execution of this workflow (Render final after a
   * run that stopped at a preview): the run executes `nodeIds` only, and every
   * other node hands on what THAT execution produced (its `node_states`, an
   * Edit Plan with the person's review applied), never the workflow's saved
   * results. The execution must be the caller's own, of this workflow and
   * this version of its graph (`appVersionId`, or the live workflow on both
   * sides), and ended `completed`; the worker refuses otherwise, with the
   * stable codes in `@nodaro/shared` run-continuation. The run re-applies
   * the input overrides that execution applied — pinned on it when it started
   * (`lib/execution-input-overrides.ts`); an execution from before the pin
   * falls back to an app run's `app_runs.input_values` — and `inputOverrides`
   * here win over them, field by field. See
   * `services/workflow-engine/run-continuation.ts`.
   */
  continueFromExecutionId?: string
  /**
   * For a triggered run: the trigger node that fired (the trigger row's
   * `config.nodeId`). The worker runs the branch behind it — see
   * `triggerRunScope` — or the whole workflow when the node is wired to nothing.
   */
  triggerNodeId?: string
  /** Presentation mode: override source node data before execution.
   *  Keys are node IDs, values are partial data to merge into node.data. */
  inputOverrides?: Record<string, Record<string, unknown>>
  /** When running a published app version, load snapshot from published_apps instead of workflows. */
  appVersionId?: string
  /**
   * The workflow's OWNER started this run themselves and no external input
   * can reach the graph: true only for the editor's own run (a browser
   * session) and the owner's own schedule. Decided at ENQUEUE, where the token
   * kind and the trigger source are known — never re-derived from uuid
   * equality, because an OAuth / API token and a public webhook trigger both
   * run AS the owner. Gates a PLAIN stored credential (plan D3).
   */
  ownerInitiated?: boolean
  /** Spend-surface flag captured at run creation (see OrchestratorContext.webFreeMode). */
  webFreeMode?: boolean
  /**
   * Who pays for this execution, resolved ONCE at enqueue (P14) — a new
   * producer is compile-forced to answer it, which is why the field is
   * REQUIRED here. On the wire it may still be absent (a payload enqueued by
   * pre-P14 code, or a rollback window): the worker coalesces an absent
   * field to `{ payer: "user", userId }`, unconditionally and permanently —
   * see `payloadBillingContext` in lib/billing-context.ts. Workers never
   * re-resolve; they read this.
   */
  billingContext: BillingContext
  /**
   * A person who can review a Preview render is at this run: true only for
   * the editor's own run (a browser session on /run). Every other lane — a
   * trigger, an API / SDK / MCP call, a present link, an app run — has nobody
   * to press Render final, so a run of a Preview render there is refused
   * before any node runs unless it overrides the render to Final (decided
   * 2026-10-04). Decided at ENQUEUE, like `ownerInitiated` and
   * `billingContext`, and REQUIRED so a new producer is compile-forced to
   * answer it. Absent on the wire (a job queued before the deploy) means the
   * stop rule does not apply to that run at all: no gate, no refusal, the
   * whole graph runs (decided 2026-10-05).
   */
  reviewerPresent: boolean
  /**
   * A component's inner run is a NEW job, so it would otherwise always carry
   * `reviewerPresent` and fall under the stop rule even when its parent does
   * not (a parent queued before the deploy). The parent's answer
   * (`OrchestratorContext.previewStopRule`) rides the internal
   * `/v1/component/execute` hop and lands here; `false` exempts this run from
   * the rule exactly as its parent is exempt (decided 2026-10-05). Absent =
   * the rule's own answer (flag on + `reviewerPresent` present). Honored only
   * on the internal lane, so no API caller can set it.
   */
  previewStopRule?: boolean
  /** Marks a component's inner execution (`executeAppRun({isComponentExecution})`):
   *  a nested graph with no Render final path. */
  isComponentExecution?: boolean
  /** Current component nesting depth (limit 5, like sub-workflows) */
  componentDepth?: number
  /** Slugs of ancestor components in the execution chain — used for cycle detection */
  executingComponentIds?: string[]
}

// ---------------------------------------------------------------------------
// Lightweight node/edge types (no React Flow dependency)
// ---------------------------------------------------------------------------

export interface WorkflowNodeData {
  label?: string
  skipped?: boolean
  [key: string]: unknown
}

export interface SimpleNode {
  id: string
  type: string
  data: WorkflowNodeData
  parentId?: string
}

export interface SimpleEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  data?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Resolved inputs (output of input-resolver)
// ---------------------------------------------------------------------------

export interface ResolvedInputs {
  /** Slideshow: transition pick from a wired transition PARAMETER node
   *  (value routing, not a prompt hint — the suno-voice personaId precedent).
   *  Resolved to the combine/xfade vocabulary in the payload builder. */
  transition?: string
  prompt?: string
  /** Highest-precedence prompt for list fan-out — set per-item by
   *  overrideInputWithListItem; consumed as computeNodePrompt's `override` so a
   *  typed data.prompt cannot swallow the per-item value after the typed-primary
   *  flip. Set ONLY for text items, never URL items. */
  overridePrompt?: string
  /** Negative prompt wired through the `negative` typed handle on
   *  generate-video. Distinct from `prompt` so the orchestrator can override
   *  the config-panel `data.negativePrompt` without clobbering positive
   *  prompt routing. */
  negativePrompt?: string
  imageUrl?: string
  /** face-swap: the face photo wired into its `face` handle (an image
   *  producer's file or an entity's portrait). Its own lane, like the editor's
   *  `faceImageUrl`, so the face never lands in `imageUrl` or
   *  `referenceImageUrls` where the face-swap payload does not look. */
  faceImageUrl?: string
  videoUrl?: string
  /** Upstream video duration (seconds) — used for accurate credit estimation
   *  on trim-video / loop-video. Set when the upstream node exposes a
   *  generatedResults[*].duration or data.duration. */
  videoDuration?: number
  videoUrls?: string[]
  /** Video URLs with source node IDs for ordering (combine-videos).
   *  `duration` is the upstream node's video duration in seconds (when known) —
   *  used to build aligned upstreamDurations on the combine-videos payload. */
  videoUrlsWithSourceIds?: Array<{ nodeId: string; url: string; duration?: number }>
  /** Image URLs accumulated from every upstream image producer, in wire order
   *  (image-collage). Mirrors videoUrls for combine-videos. */
  imageUrls?: string[]
  /** Image URLs with source node IDs (image-collage) — lets the payload
   *  builder align the node's per-source size hints (imageSizeBySource) into
   *  the wire's index-aligned imageSizes array. Mirrors
   *  videoUrlsWithSourceIds; pushed in lockstep with imageUrls. */
  imageUrlsWithSourceIds?: Array<{ nodeId: string; url: string }>
  /** Image Overlay and Video Overlay: layer image URLs keyed by HANDLE index —
   *  overlay → [0], overlay2 → [1], … overlay12 → [11]. Sparse when a middle
   *  handle is unwired; the payload builder skips the holes and aligns
   *  data.layers[i] by index. */
  overlayImageUrls?: (string | undefined)[]
  /** Video Overlay's reserved JSON layer-plan input (VIDEO_OVERLAY_LAYER_PLAN_HANDLE).
   *  Routed, never read in v1 — no pip renders for it yet. */
  layerPlan?: string
  /** Text wired into an image-overlay node's "qrText" handle (fills its fromInput QR layers). */
  overlayQrText?: string

  audioUrl?: string
  audioUrl2?: string
  audioUrls?: string[]
  /** Audio URLs with source node IDs for ordering (mix-audio) */
  audioUrlsWithSourceIds?: Array<{ nodeId: string; url: string }>
  audioSources?: Array<{
    url: string
    sourceNodeId: string
    sourceType?: "audio" | "video"
  }>
  referenceImageUrls?: string[]
  /** Singular reference image for nodes that take exactly one (image-critic).
   *  Distinct from referenceImageUrls (array) — wired by the "reference"
   *  target handle in input-resolver. */
  referenceImageUrl?: string
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  /** Media items for multi-media social posts (Instagram carousel, etc.).
   *  Accumulated by routeOutput when the target node's action expects N items. */
  mediaItems?: MediaItem[]
  /** Verbatim TTS script for the ai-avatar node, wired via the "script"
   *  target handle. Distinct from `prompt` — must never be folded with
   *  cinematography or identity hints. */
  script?: string
  scriptData?: unknown
  dialogueLines?: Array<{ speaker: string; text: string; emotion?: string }>
  scriptCharacters?: Array<{ name: string; description: string; mood?: string; action?: string; position?: string }>
  scriptLocations?: Array<{ name: string; description: string; timeOfDay: string; weather?: string; lighting?: string }>
  sunoTrackId?: string
  sunoTaskId?: string
  /** Custom Suno voice persona id wired from an upstream suno-voice node. */
  personaId?: string
  /** Persona kind, defaults to "voice_persona" when personaId is set. */
  personaModel?: string
  uploadUrl?: string
  uploadUrlList?: string[]
  startFrameUrl?: string
  endFrameUrl?: string
  /** Cinematic-avatar reference inputs — one upstream producer per handle.
   *  Wired via the `ref-video` / `ref-audio` / `ref-image` target handles.
   *  payload-builder assembles these (plus any data.references) into the
   *  cinematic-avatar `references` array. Distinct from videoUrl/audioUrl/
   *  imageUrl so a cinematic node's reference wires never collide with a
   *  generic media input slot. */
  refVideoUrl?: string
  refAudioUrl?: string
  refImageUrl?: string
  maskUrl?: string
  /** Inpaint base image (the canvas being edited) wired for generate-image
   *  inpainting. Distinct from imageUrl/referenceImageUrls so an inpaint base
   *  never collides with a generic image input or reference. Mirrors maskUrl. */
  baseImageUrl?: string
  kieTaskId?: string
  caption?: string
  systemPrompt?: string
  componentInputMap?: Record<string, string>
  /** Lottie asset URLs from upstream nodes connected to the "lottie" handle */
  lottieAssets?: Array<{ id?: string; url: string; name?: string }>
  /** Word-timed captions wired from upstream transcribe.words for kinetic captions. */
  captions?: Caption[]
  /** Fan-in input list — populated by the resolver for reduce-style targets.
   *  Carries the full upstream list (or `[singleOutput]` when upstream wasn't
   *  fanned out) so the reduce strategy can fold it into a single value. */
  inputs?: string[]
  /** Reference Sheet — the connected upstream entity's kind + DB id. Mirror of
   *  the frontend FrontendResolvedInputs.entityKind / entityDbId. The orchestrator
   *  resolves these directly from the graph in payload-builder (the sheet job
   *  composes from the entity's stored panels, not a wired image URL), so these
   *  are kept for parity / future routing rather than consumed by routeOutput. */
  entityKind?: "character" | "object" | "location"
  entityDbId?: string
  /** The upstream analysis wired into video-audit's `analysis` target — the
   *  canonical VideoAnalysisResult OBJECT (not the stringified form every other
   *  consumer gets), because the audit forwards it verbatim to the plugin's
   *  schema. Mirror of the frontend FrontendResolvedInputs.analysis.
   *  Left `undefined` when nothing resolved: presence is what picks the credit
   *  family (resolved → `video-audit`, absent → the pricier `video-audit:auto`,
   *  where the node runs its own fast analysis first), so it must never be
   *  coerced to null/{}. */
  analysis?: unknown
  /** TTS voice auto-wired from an upstream Character node's stored voice
   *  (input-resolver). `voice` is the ElevenLabs voice id/name the TTS route's
   *  Zod reads as `voice`; `voiceType` mirrors the character's resolution mode;
   *  `provider` is the recommended TTS provider. Consumed by payload-builder's
   *  text-to-speech case (data fields still win when explicitly set on the node). */
  voice?: string
  voiceType?: "premade" | "library" | "custom"
  provider?: string
  /** apply-edl: the EDL wired into the required `edl` (json) handle — the
   *  stringified Edl from getPrimaryOutput's json branch. The payload builder
   *  parses + normalizes it into the effective EDL. */
  edl?: string
  /** apply-edl: an optional upstream Transcript (json) wired into the
   *  `transcript` handle, remapped through the cut for the `json` output. */
  transcript?: string
  /** apply-edl: optional media-URL overrides for `EdlSource[i].url`, positional
   *  in wire order (the `sources` handle). */
  sources?: string[]
  /** edit-plan: an optional upstream silence-ranges object (json) wired into the
   *  `silence` handle — the stringified `{version, ranges}` from a silence-detect
   *  node's json output. Parsed in the payload builder. */
  silence?: string
  /** edit-plan: the wired media sources (the `sources` handle), each carrying its
   *  source NODE id (minted once as the EdlSource id, never re-derived), its URL,
   *  a kind derived from the producer type, and (when the producer exposes it) the
   *  source's duration in seconds — the payload builder picks the master source's
   *  duration for the reserve bucket so an orchestrated run is not forced to the
   *  ceiling. The builder also annotates each row with the node's per-source config
   *  (role/speakers/offsetMs/kind override) into the plugin's `sources[]`. Richer
   *  than apply-edl's positional `sources`. */
  editPlanSources?: Array<{ nodeId: string; url: string; kind: "video" | "audio"; duration?: number; label?: string }>
  /** edit-plan: audio-sync's result (stringified json) from the `offsets`
   *  handle — the payload builder writes it onto the sources' `offsetMs`
   *  (`applyAudioSyncOffsets`, B4). */
  editPlanOffsets?: unknown
  /** edit-plan: the node the transcript was made from, when the canvas shows
   *  it (`editPlanTranscriptOrigin`) — checked against the master's clock. */
  editPlanTranscriptOrigin?: string
  /** audio-sync: the recordings wired into the `sources` handle, in wire order,
   *  each carrying its source NODE id — which becomes the result's `sourceId`
   *  (the same id an edit plan mints as that recording's EdlSource id). The
   *  payload builder orders them by the node's `sourceOrder`. */
  audioSyncSources?: Array<{ nodeId: string; url: string }>
  /** content-recipe: the post's own link, from a wire into the node's `link`
   *  handle — a Video URL node's PAGE link (never its downloaded file) or a
   *  text node's text. Cited on the recipe, never fetched. */
  sourceLink?: string
  /** video-analysis: a post's link from a TEXT output wired into the node's
   *  `video` handle (the Telegram Account Trigger's Video link, a Text node).
   *  Read like the node's own link field, and before it; a wired video file
   *  still wins over both. Only an http(s) link is kept. */
  videoPageUrl?: string
  /** video-analysis: `videoUrl` is a Social Search post's own video file. Its
   *  length is read from the file before the reserve (video-analysis-post-probe),
   *  never taken from the post. */
  videoFromSocialPost?: boolean
  /** video-analysis: the wired Social Search post's video link has expired, so
   *  there is nothing to analyze until the search runs again. */
  socialPostVideoExpired?: boolean
  /** video-analysis: `videoPageUrl` is a Social Search post's page (a post
   *  that came without its own file). A page that gives no length is refused,
   *  never priced at the ceiling. */
  videoPageFromSocialPost?: boolean
  /** video-analysis: the wired Social Search post is an image or a text
   *  post — there is no video to analyze. */
  socialPostNoVideo?: boolean
}

// ---------------------------------------------------------------------------
// Execution context passed to orchestrator internals
// ---------------------------------------------------------------------------

/** Where an ADOPTED job's poll clocks start (podcast Track 0.11 follow-up).
 *  A live budgeted render re-attached on an orchestrator resume is timed from
 *  its row, not from the adoption: the poll-absolute clock from the original
 *  dispatch (`jobs.created_at`), the processing clock from the worker's pickup
 *  (`jobs.started_at`). A resume therefore never grants a fresh budget — a
 *  render adopted after its budget is spent times out on the first tick, as
 *  it would have without the re-pick. Absent fields fall back to today's
 *  "now" / first-seen-processing. */
export interface AdoptedJobClocks {
  readonly dispatchedAtMs?: number
  readonly processingStartedAtMs?: number
  /** The row's `slot_wait_ms` when adopted: its earlier ffmpeg-slot wait,
   *  credited from the first tick (Track 0.13). */
  readonly slotWaitMs?: number
}

export interface OrchestratorContext {
  executionId: string
  workflowId: string
  userId: string
  triggerType: "manual" | "webhook" | "schedule" | "api" | "telegram" | "telegram_account" | "app_run"
  triggerData?: Record<string, unknown>
  /** Abort signal — set when execution is cancelled */
  cancelled: boolean
  /** Epoch ms of last cancel-check DB query (shared across parallel nodes to avoid duplicate queries) */
  lastCancelCheckMs?: number
  /** Workflow settings (character definitions, prompt templates) */
  workflowSettings?: Record<string, unknown>
  /** Called when a worker-queued node creates its job — allows the orchestrator
   *  to surface the jobId on nodeStates before execution completes. */
  onJobCreated?: (nodeId: string, jobId: string) => void
  /** Called as a worker-queued job's progress changes (0-100). Used to drive
   *  per-node progress bars in the UI during backend orchestrator runs.
   *
   *  `awaitingReview` (spec 2026-09-03-job-policy-hook-design §17.10) is the
   *  job-policy sidecar: true while the row sits in `pending_review`, so the
   *  canvas can paint "awaiting review" chrome instead of a bar that will
   *  never move again. It is passed on EVERY tick, including the false one
   *  that clears it when the review resolves. */
  onJobProgress?: (jobId: string, progress: number, awaitingReview?: boolean) => void
  /** The largest `pending_review` dwell time (ms) any child job of this
   *  execution has accumulated so far, written by `pollJobToCompletion`.
   *
   *  The orchestrator subtracts it from the 120-minute WORKFLOW_TIMEOUT_MS
   *  (spec §6.3): a review queue's clock is not a worker's, and without this
   *  a run whose only laggard is a human review gets failed at the execution
   *  level even though every node-level clock was correctly frozen. MAX, not
   *  sum: sibling holds overlap in wall-clock time, so summing would
   *  over-credit a fan-out. */
  maxChildHeldMs?: number
  /** Σ over this execution's budgeted dispatches of how far each declared
   *  budget reaches past `NODE_TIMEOUT_MS` (podcast Track 0.11 —
   *  `lib/job-budget.ts`). The orchestrator's cap is `WORKFLOW_TIMEOUT_MS`
   *  plus this (`workflowCapMs`). Grown by `addBudgetExcess`: at dispatch of a
   *  node whose job declares a budget (apply-edl), on adopting such a job, and
   *  when a component node's inner execution finishes (its own summed excess).
   *  Inline sub-workflows share this context, so their long nodes count too.
   *  Undefined (= 0) for a run with nothing budgeted — today's 120 minutes. */
  budgetExcessMs?: number
  /** Node IDs that have upload-* ancestors — their jobs should be force_private */
  uploadDescendantIds?: Set<string>
  /** In-flight child jobs from a prior (crashed) orchestrator attempt that the
   *  node executor ADOPTS (polls the existing job) instead of creating a new
   *  one: a provider job whose call already went out (audit A2 — no second
   *  provider charge), or a budgeted render whose worker is still heartbeating
   *  (Track 0.11 follow-up — the render never restarts; `clocks` carry its
   *  original start). Keyed by owning node id; populated on re-pick by
   *  cancelInFlightChildJobs. */
  adoptableJobs?: Map<string, {
    jobId: string
    usageLogId?: string
    creditsReserved?: number
    budgetMs?: number
    clocks?: AdoptedJobClocks
  }>
  /** Whether this execution is running a published app (affects free-tier app credit allowance) */
  isAppRun?: boolean
  /** Pool-aware spend-surface mode (D1 v2): true when the run was triggered
   *  from a first-party consumer surface while the flag is on. Payg-ness
   *  resolves downstream (credits layer / RPC self-gate); free users and
   *  subscribers are unaffected, so the flag threads unconditionally. */
  webFreeMode?: boolean
  /**
   * The execution's resolved payer (P14), coalesced from the payload by the
   * worker — never absent past that point. Sub-workflows and every node
   * dispatch read THIS; nothing below the worker re-resolves (one payer per
   * execution, even across a mid-run membership change).
   */
  billingContext: BillingContext
  /** Current component nesting depth (limit 5, like sub-workflows) */
  componentDepth?: number
  /** Slugs of ancestor components in the execution chain — used for cycle detection */
  executingComponentIds?: string[]
  /** Owner of the top-level workflow being executed (workflows.user_id or
   *  published_apps.creator_id). Distinct from `userId`, which is the runner:
   *  a shared workflow or an app run executes under the runner's identity but
   *  must only resolve sub-workflow references belonging to the owner. */
  workflowOwnerId?: string
  /** Copied from the job at pickup — see WorkflowExecutionJob.ownerInitiated. */
  ownerInitiated?: boolean
  /** Does the preview stop rule apply to this run? Set once at pickup: the
   *  rollout flag (`PREVIEW_STOP_RULE_ENABLED`) is on AND the job carries
   *  `reviewerPresent` (one queued before the deploy does not, and runs as it
   *  would have then) AND the job does not carry `previewStopRule: false`.
   *  Absent = it does not apply. Inline sub-workflows share this context, so
   *  their backstop follows the same answer; a component's inner run is a new
   *  job, so the component dispatch sends this answer across the HTTP hop
   *  (`WorkflowExecutionJob.previewStopRule`). */
  previewStopRule?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max time for a single node to process after the worker picks it up (ms).
 *  Sized to cover the longest legitimate KIE poll budget (`kie-lip-sync` is
 *  ~60min at MAX_POLL_ATTEMPTS_LIP_SYNC_LONG=360 × 10s cap) plus 30-min
 *  headroom. Without this, lip-sync nodes time out the orchestrator before
 *  the upstream completes, and the workflow_execution row stays `failed`
 *  even when reconcile later recovers the underlying job.
 *
 *  The DEFAULT: a node whose job declares a budget (apply-edl — a final render
 *  of a long episode is hours of ffmpeg) is held to that budget instead, and
 *  the execution's cap grows by the same excess (`lib/job-budget.ts ::
 *  nodeCeilings` / `workflowCapMs`, podcast Track 0.11). */
export const NODE_TIMEOUT_MS = 90 * 60 * 1000 // 90 minutes

/** Max time for an entire workflow execution (ms). Sized to cover a
 *  generate-video-pro multi-segment stitch (each segment a full KIE
 *  generation, up to NODE_TIMEOUT_MS=90min for the node itself) landing
 *  inside a workflow alongside other nodes, with headroom beyond the
 *  per-node ceiling. This is the EXECUTION ceiling only —
 *  it no longer mirrors the BullMQ `lockDuration`, which is short and
 *  auto-renewed (ORCHESTRATOR_LOCK_MS in orchestrator-worker.ts). Shrinking
 *  the lock does NOT shrink how long an execution may run.
 *
 *  The cap for a run with nothing budgeted. A run that dispatched long renders
 *  gets this plus the sum of their excesses (`OrchestratorContext.
 *  budgetExcessMs`, `lib/job-budget.ts :: workflowCapMs`). */
export const WORKFLOW_TIMEOUT_MS = 120 * 60 * 1000 // 120 minutes

/** Polling interval for checking job completion (ms) */
export const JOB_POLL_INTERVAL_MS = 3_000 // 3 seconds

/** Absolute max time a single poll loop can run, including queue wait (ms).
 *  Safety net — even if the job stays "pending" forever (worker down), we bail out.
 *  Grows by a budgeted node's excess exactly like `NODE_TIMEOUT_MS`
 *  (`lib/job-budget.ts :: nodeCeilings`). */
export const POLL_ABSOLUTE_TIMEOUT_MS = 90 * 60 * 1000 // 90 minutes

/** Max depth for sub-workflow nesting */
export const MAX_SUB_WORKFLOW_DEPTH = 5
