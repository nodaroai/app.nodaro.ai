import type { WorkflowNode, WorkflowEdge, GenerateVideoProNodeData, EditVideoProNodeData } from "@/types/nodes";
import { StorageExceededError, SubscriptionRequiredError } from "@/lib/api";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { buildMotionCreditModelIdentifier, isDefaultSelectorConfig, selectListItems, type SelectorFields, getEffectiveRepeatCount, buildScraperCreditId, isScraperActor, SCRAPER_CREDIT_COSTS, buildVideoAnalysisCreditId, resolveVideoAnalysisModel, bucketSecondsFromCreditId, VIDEO_ANALYSIS_BUCKET_CREDITS, buildVideoAuditCreditId, VIDEO_AUDIT_BUCKET_CREDITS, FAN_OUT_EACH_TYPES, buildVideoCreditModelIdentifier, SEEDANCE_2_CONTINUATION_REF_SEC, isSeedance2Provider, isMinimaxH3Provider, maxSegmentSecFor, normalizeMinimaxH3Resolution } from "@nodaro/shared"
// getCachedCredits reads the live React-Query model-cost cache (an `ee/`
// concern — credits are enterprise-only). Allowlisted in
// tools/check-ee-imports.mjs (same coupling as ./run-handlers.ts).
import { getCachedCredits } from "@/ee/hooks/use-model-credits"

/** Sentinel error thrown when a polling callback detects that the active
 *  workflow has changed. Callers should catch this silently (no error toast). */
export class WorkflowStaleError extends Error {
  constructor() {
    super("Workflow changed during execution");
  }
}

export const NODE_CREDIT_COSTS: Record<string, number> = {
  "generate-script": 20,
  "generate-image": 20,
  "modify-image": 20,
  "upscale-image": 10,
  "remove-background": 10,
  "image-to-video": 500,
  "video-to-video": 250,
  "text-to-video": 500,
  "text-to-speech": 30,
  "generate-music": 180,
  "text-to-audio": 30,
  "suno-generate": 30,
  "suno-v5": 30,
  "suno-cover": 30,
  "suno-extend": 30,
  "suno-lyrics": 10,
  "suno-separate": 40,
  "audio-separation": 30,
  "suno-music-video": 10,
  "suno-mashup": 30,
  "suno-replace-section": 20,
  "suno-style-boost": 10,
  "suno-add-instrumental": 30,
  "suno-add-vocals": 30,
  "suno-convert-wav": 10,
  "suno-upload-extend": 30,
  "lip-sync": 130,
  "speech-to-video": 30,
  "motion-transfer": 150,
  "video-upscale": 150,
  "extend-video": 400,
  "face-swap": 160,
  "transcribe": 10,
  "combine-videos": 30,
  "assemble-narrated-video": 40,
  "image-collage": 20,
  "merge-video-audio": 20,
  "trim-audio": 10,
  "split-media": 20,
  "extract-audio": 10,
  "remove-audio": 20,
  "trim-video": 10,
  "extract-frame": 10,
  "speed-ramp": 20,
  "loop-video": 10,
  "gif-to-video": 0,
  "fade-video": 10,
  "resize-video": 20,
  "adjust-volume": 10,
  "audio-fx": 20,
  "add-captions": 30,
  "mix-audio": 20,
  "combine-audio": 10,
  "video-composer": 30,
  "after-effects": 20,
  "lottie-overlay": 5,
  "3d-title": 20,
  "motion-graphics": 10, // lottie engine standard tier (the default); live cost comes from useModelCredits
  "composite": 0,
  "render-video": 50,
  "character": 20,
  "object": 20,
  "location": 20,
  "voice-changer": 40,
  "voice-changer-pro": 40,
  "dubbing": 80,
  "voice-remix": 40,
  "voice-design": 50,
  "forced-alignment": 30,
  "audio-isolation": 80,
  "image-to-text": 3,
  "describe-to-picker": 10,
  "text-to-dialogue": 40,
  "transcode-video": 10,
  "sub-workflow": 0,
  "filter-list": 0,
  "deduplicate": 0,
  "merge-lists": 0,
  "sort-list": 0,
  "selector": 0,
  "social-media-format": 20,
  "instagram-post": 10,
  "tiktok-post": 10,
  "youtube-upload": 10,
  "linkedin-post": 10,
  "x-post": 10,
  "facebook-post": 10,
  "telegram-post": 10,
  "publish-social": 10,
  "telegram-channel-feed": 10,
  "save-to-storage": 0,
  "qa-check": 10,
  "image-critic": 5,
  "web-scrape": 20,
  // Flash floor — the real per-run cost is duration/model-bucketed (see
  // estimateNodeCredits below + the node's live useModelCredits estimate).
  // Kept equal to VIDEO_ANALYSIS_BUCKET_CREDITS' table-wide ceiling
  // (smart:600s) so this rare-path fallback never under-quotes; re-sync by
  // hand whenever that table reprices (last: 2026-08-03, task A3).
  "video-analysis": 2076,
  // Like video-analysis above, the real per-run cost is bucketed — here by
  // FAMILY × duration (see estimateNodeCredits + the node's live badge). This
  // key is the bare `video-audit` model id, so it carries that id's catalog
  // price: the re-audit family's 600s ceiling (credit-estimate-tables.test.ts
  // pins the two together). It is NOT the table-wide max — the auto family is
  // a SEPARATE catalog id (`video-audit:auto`, 1921) — so treat this purely as
  // a last-resort floor: every real quoting path (node badge, canvas total,
  // run-confirm, precheck) resolves a bucketed composite first.
  "video-audit": 1073,
};

/** Motion-transfer composite credit costs (mirrors STATIC_CREDIT_COSTS in backend) */
const MOTION_CREDIT_COSTS: Record<string, number> = {
  "kling-3.0-motion:5s": 150,
  "kling-3.0-motion:10s": 300,
  "kling-3.0-motion:15s": 450,
  "kling-3.0-motion:30s": 900,
  "kling-3.0-motion:1080p:5s": 250,
  "kling-3.0-motion:1080p:10s": 500,
  "kling-3.0-motion:1080p:15s": 750,
  "kling-3.0-motion:1080p:30s": 1500,
  "motion-transfer:5s": 80,
  "motion-transfer:10s": 150,
  "motion-transfer:15s": 230,
  "motion-transfer:30s": 450,
  "motion-transfer:1080p:5s": 120,
  "motion-transfer:1080p:10s": 230,
  "motion-transfer:1080p:15s": 340,
  "motion-transfer:1080p:30s": 680,
}

// ---------------------------------------------------------------------------
// generate-video-pro — DISPLAY-ONLY credit estimate.
//
// UI-side twin of the money-authoritative closed-form in
// `backend/src/ee/billing/generate-video-pro-credits.ts`
// (`computeGenerateVideoProPricing`). `gvpSplit` transcribes the SAME
// segment-split algorithm as that file's module-local `computeSplit` (itself
// a verbatim copy of the plan's Task 2 `computeSplit`) — keep all three in
// sync if the split algorithm ever changes. This function is NEVER
// authoritative for billing; only the backend helper is.
// ---------------------------------------------------------------------------

const GVP_SPLIT = { minSeg: 4, maxSeg: 15, lossSec: 0.3, capSec: 120 } as const

/** Segment-count ceiling — mirrors EXPLICIT_MAX_SEGMENTS in the backend's
 *  `ee/billing/generate-video-pro-credits.ts` and the plugin plan schema's
 *  own 24. On a short-segment provider this binds BEFORE the duration cap
 *  (veo3 at 8s/segment delivers ~185s of a 300s request), and the run is
 *  shortened to fit — so the estimate must bound its count the same way. */
const GVP_MAX_SEGMENTS = 24

interface GvpSplitResult {
  mode: "single" | "multi"
  clampedD: number
  n: number
  s: number
  durations: number[]
}

function gvpSplit(requestedSec: number): GvpSplitResult {
  const d = Math.min(Math.max(Math.round(requestedSec), GVP_SPLIT.minSeg), GVP_SPLIT.capSec)
  if (d <= GVP_SPLIT.maxSeg) return { mode: "single", clampedD: d, n: 1, s: d, durations: [d] }
  let n = 2
  while (n * GVP_SPLIT.maxSeg < d + GVP_SPLIT.lossSec * (n - 1)) n++
  const s = Math.ceil(d + GVP_SPLIT.lossSec * (n - 1))
  const base = Math.floor(s / n)
  const durations = new Array<number>(n).fill(base)
  durations[0] += s - base * n
  for (let i = 0; i < n - 1; i++) {
    if (durations[i] > GVP_SPLIT.maxSeg) {
      durations[i + 1] += durations[i] - GVP_SPLIT.maxSeg
      durations[i] = GVP_SPLIT.maxSeg
    }
  }
  return { mode: "multi", clampedD: d, n, s, durations }
}

/** Static fallbacks — the seeded seedance-2 @ 720p 8s composites (STATIC_CREDIT_COSTS
 *  in backend/src/ee/billing/credits.ts), used only while the live cache is cold.
 *  Post-redenomination values (2026-08-03 fix — these sat at the stale pre-x10
 *  82/50/10 while the backend charged 820/500/100). */
const GVP_NOREF_FALLBACK = 820
const GVP_REF_FALLBACK = 500
const GVP_FEE_FALLBACK = 100

/** Static fallbacks for the minimax-h3 8s composites (STATIC_CREDIT_COSTS
 *  `minimax-h3:8s` = 730, `minimax-h3:8s:768p` = 450) — the r2v rate equals
 *  the base rate of the selected tier, so ONE composite per tier backs both
 *  rates. */
const GVP_MINIMAX_H3_FALLBACK = 730
const GVP_MINIMAX_H3_768P_FALLBACK = 450

/** Per-second BASE rate for a (provider, resolution, ref) combination, read from the
 *  live cached composite when available (mirrors the backend's perSecRate identifier
 *  scheme exactly: `${provider}:8s:${resolution}[-ref]`, minimax-h3 → the bare
 *  `minimax-h3:8s` for 2K/anything-else and `minimax-h3:8s:768p` for a
 *  verified 768P selection), else a static fallback. */
function gvpPerSecRate(provider: string, resolution: string, ref: boolean): number {
  if (isMinimaxH3Provider(provider)) {
    const is768p = normalizeMinimaxH3Resolution(resolution) === "768P"
    const composite = is768p
      ? (getCachedCredits(`${provider}:8s:768p`) ?? GVP_MINIMAX_H3_768P_FALLBACK)
      : (getCachedCredits(`${provider}:8s`) ?? GVP_MINIMAX_H3_FALLBACK)
    return composite / 8
  }
  const identifier = `${provider}:8s:${resolution}${ref ? "-ref" : ""}`
  const cached = getCachedCredits(identifier)
  if (cached !== undefined) return cached / 8
  // COLD-CACHE fallback — Seedance-2 family ONLY. GVP_NOREF/REF_FALLBACK are
  // literally the seedance-2 @720p 8s composites, so applying them to any
  // other provider quotes one model's price for another (2026-08-05: the pro
  // node stopped being Seedance-only, which made that a live mis-quote rather
  // than a theoretical one). Everything else prices per-segment — see
  // `gvpSegmentCost`.
  if (!isSeedance2Provider(provider)) return 0
  return (ref ? GVP_REF_FALLBACK : GVP_NOREF_FALLBACK) / 8
}

/** True when this provider prices on the LINEAR per-second axis (the
 *  Seedance-2 family + minimax-h3). UI twin of the backend's `hasPerSecRate`. */
function gvpIsPerSecPriced(provider: string): boolean {
  return isSeedance2Provider(provider) || isMinimaxH3Provider(provider)
}

/** Display-side cost of ONE keyframes segment on a flat-priced provider —
 *  exactly one plain image-to-video generation, through the same canonical
 *  identifier the backend's `segmentCost` builds. 0 while the cache is cold
 *  (the badge fills in once `useModelCredits` resolves) rather than a
 *  borrowed number from another model. */
function gvpSegmentCost(provider: string, resolution: string, durationSec: number): number {
  const identifier = buildVideoCreditModelIdentifier(
    provider, durationSec, false, "image-to-video", undefined, resolution, false,
  )
  return getCachedCredits(identifier) ?? getCachedCredits(provider) ?? 0
}

/** UI twin of the backend's `computePreferredSplit` (preferred-point lever,
 *  ee/billing/generate-video-pro-credits.ts) — keep in lock-step. Before
 *  2026-08-03 the estimate ignored `preferredSegmentSec` entirely and
 *  misquoted every levered run. */
function gvpPreferredSplit(requestedSec: number, preferredSec: number): GvpSplitResult {
  const d = Math.min(Math.max(Math.round(requestedSec), GVP_SPLIT.minSeg), GVP_SPLIT.capSec)
  const pref = Math.min(Math.max(Math.round(preferredSec), GVP_SPLIT.minSeg), GVP_SPLIT.maxSeg)
  let n = Math.max(1, Math.round(d / pref))
  const sOf = (k: number): number => Math.ceil(d + GVP_SPLIT.lossSec * (k - 1))
  while (n > 1 && Math.floor(sOf(n) / n) < GVP_SPLIT.minSeg) n--
  while (Math.ceil(sOf(n) / n) > GVP_SPLIT.maxSeg) n++
  if (n === 1) return { mode: "single", clampedD: d, n: 1, s: d, durations: [d] }
  const s = sOf(n)
  const base = Math.floor(s / n)
  const r = s - base * n
  const durations = new Array<number>(n).fill(base)
  for (let i = 0; i < r; i++) durations[i] += 1
  return { mode: "multi", clampedD: d, n, s, durations }
}

/** Explicit-durations adoption (scene-aligned runs, 2026-08-03) — display-side
 *  mirror of the backend's `explicitSplit`, minus the throw: a malformed array
 *  returns null → classic split for the badge (the server rejects the run
 *  loudly at reserve; the estimate must merely not lie about a valid one). */
function gvpExplicitSplit(requestedSec: number, segmentDurations: number[]): GvpSplitResult | null {
  const d = Math.min(Math.max(Math.round(requestedSec), GVP_SPLIT.minSeg), GVP_SPLIT.capSec)
  const n = segmentDurations.length
  if (
    n < 1 || n > 24 ||
    segmentDurations.some((x) => !Number.isInteger(x) || x < GVP_SPLIT.minSeg || x > GVP_SPLIT.maxSeg)
  ) {
    return null
  }
  const s = segmentDurations.reduce((a, b) => a + b, 0)
  if (n === 1) return { mode: "single", clampedD: d, n: 1, s: d, durations: [d] }
  return { mode: "multi", clampedD: d, n, s, durations: [...segmentDurations] }
}

/** Display-only credit estimate for a generate-video-pro node's popup/badge.
 *  Exported so the node's Run strip shows the SAME closed-form number the
 *  popup does (single-segment composite for ≤15s, fee + per-second segment
 *  math beyond) instead of a fixed single-segment approximation. Honors the
 *  same split-selection precedence as the backend: explicit `segmentDurations`
 *  > `preferredSegmentSec` > classic pack-to-cap. */
export function estimateGenerateVideoProCredits(data: GenerateVideoProNodeData): number {
  const provider = data.provider || "seedance-2"
  const resolution = data.resolution || "720p"
  const duration = data.duration ?? 8
  const explicit =
    Array.isArray(data.segmentDurations) && data.segmentDurations.length > 0
      ? gvpExplicitSplit(duration, data.segmentDurations)
      : null
  const usePreferred =
    explicit === null && typeof data.preferredSegmentSec === "number" && Number.isFinite(data.preferredSegmentSec)
  const split =
    explicit ?? (usePreferred ? gvpPreferredSplit(duration, data.preferredSegmentSec as number) : gvpSplit(duration))

  if (split.mode === "single") {
    // Single-segment run behaves like a normal t2v run — same identifier the
    // backend's single-mode path uses, so the cached composite (when warm)
    // tracks the real reservation exactly for the common ≤15s case.
    const identifier = buildVideoCreditModelIdentifier(
      provider, split.clampedD, false, "text-to-video", undefined, resolution, false,
    )
    const cached = getCachedCredits(identifier)
    if (cached !== undefined) return cached
    return Math.ceil(gvpPerSecRate(provider, resolution, false) * split.clampedD)
  }

  const fee = getCachedCredits("generate-video-pro") ?? GVP_FEE_FALLBACK

  // FLAT-PRICED providers (veo3 family, gemini-omni-video, grok-i2v,
  // happyhorse-ref2v) have no per-second axis, and they render keyframes-only:
  // every segment is an independent image-to-video generation, so the estimate
  // is the fee plus each segment's own composite. Mirrors the backend's
  // `segmentCosts` reserve; the per-second formula below would multiply a
  // meaningless 0 rate.
  //
  // Segment COUNT comes from the provider's own longest segment, not the
  // Seedance-shaped 15s in GVP_SPLIT — veo3 caps at 8s, so a 30s request is 4
  // segments there and 2 here if the constant were used. The backend's packer
  // picks the exact lengths; this display estimate only needs the count and a
  // representative length (flat-priced models charge the same for any length,
  // and the duration-tiered one is close enough for a badge).
  if (!gvpIsPerSecPriced(provider)) {
    const maxSeg = maxSegmentSecFor(provider) || GVP_SPLIT.maxSeg
    // Bounded by the same 24-segment ceiling the backend packer honours: on a
    // short-segment provider the ceiling binds before the duration cap (veo3
    // at 8s/segment delivers ~185s), and the run is SHORTENED to fit. An
    // unbounded count here would quote segments the run will never generate —
    // reachable via an imported workflow carrying a duration above the
    // slider's own limit.
    const n = Math.min(GVP_MAX_SEGMENTS, Math.max(1, Math.ceil(split.clampedD / maxSeg)))
    const per = Math.max(1, Math.round(split.clampedD / n))
    return fee + n * gvpSegmentCost(provider, resolution, per)
  }

  const noRefPerSec = gvpPerSecRate(provider, resolution, false)
  const refPerSec = gvpPerSecRate(provider, resolution, true)
  // Context-tail override — same [2,15] clamp as the backend helper so the
  // strip estimate tracks the real reservation when the user raises the tail.
  const tailSec = Math.min(15, Math.max(SEEDANCE_2_CONTINUATION_REF_SEC,
    typeof data.contextTailSec === "number" && Number.isFinite(data.contextTailSec) ? data.contextTailSec : SEEDANCE_2_CONTINUATION_REF_SEC))
  // First-segment bill mirrors the backend's `firstSegBillSec`: the classic
  // path pads at maxSeg (worst case); levered/explicit paths bill durations[0]
  // (the constant would over-pad and can go negative in the ref term).
  const firstSegBillSec = explicit !== null || usePreferred ? split.durations[0]! : GVP_SPLIT.maxSeg
  return (
    fee +
    Math.ceil(noRefPerSec * firstSegBillSec) +
    Math.ceil(refPerSec * ((split.n - 1) * tailSec + (split.s - firstSegBillSec)))
  )
}

// ---------------------------------------------------------------------------
// edit-video-pro — DISPLAY-ONLY credit estimate. Span-replace sibling of
// generate-video-pro above: reuses the SAME gvpSplit/gvpPerSecRate helpers
// (single source of truth for the split algorithm + per-second rate lookup).
// UI-side twin of `computeEditVideoProPricing` in
// `backend/src/ee/billing/edit-video-pro-credits.ts` — keep both in sync if
// the reserve formula ever changes. NEVER authoritative for billing.
// ---------------------------------------------------------------------------

/** Static fallback for the edit-video-pro flat fee (STATIC_CREDIT_COSTS in
 *  backend/src/ee/billing/credits.ts), used only while the live cache is cold.
 *  Post-redenomination value (2026-08-03 fix — was the stale pre-x10 10). */
const EVP_FEE_FALLBACK = 100

/** Display-only estimate for an edit-video-pro node. The client can't know
 *  the source's resolution tier (server probes at reserve) — display at 720p. */
function estimateEditVideoProCredits(data: EditVideoProNodeData): number {
  const provider = data.provider || "seedance-2"
  const spanStart = Math.max(0, data.spanStart ?? 0)
  const spanEnd = data.spanEnd ?? spanStart + 8
  const span = Math.min(Math.max(spanEnd - spanStart, 4), 120)
  const D = data.sourceDurationSec
  const headExists = spanStart > 0
  const tailExists = D === undefined ? true : D - spanEnd > 0.05
  const loss = 0.3 * ((headExists ? 1 : 0) + (tailExists ? 1 : 0))
  const split = gvpSplit(span + loss)
  const refOut = spanStart >= SEEDANCE_2_CONTINUATION_REF_SEC ? 1 : 0
  const refIn = D === undefined ? 1 : (tailExists && D - spanEnd >= SEEDANCE_2_CONTINUATION_REF_SEC ? 1 : 0)
  const fee = getCachedCredits("edit-video-pro") ?? EVP_FEE_FALLBACK
  const refPerSec = gvpPerSecRate(provider, "720p", true)
  return fee + Math.ceil(refPerSec * (split.s + (refOut + (split.n - 1) + refIn) * SEEDANCE_2_CONTINUATION_REF_SEC))
}

/**
 * WHICH VIDEO-AUDIT CREDIT FAMILY — the node badge's rule verbatim
 * (video-audit-node.tsx): an edge into the `analysis` target prices under the
 * cheaper `video-audit` family (re-audit only); nothing wired prices under
 * `video-audit:auto`, because the node runs its own fast analysis first.
 *
 * It is a GRAPH fact, not a node-data field, so it needs the edges. Callers
 * WITHOUT graph context (no edges / no node id) get `false` → the pricier auto
 * family: an estimate may over-quote, it must never under-quote. The ONE rule
 * lives here so `getModelIdentifier` (the live-cost path) and
 * `estimateNodeCredits` (the cold-cache fallback) can't disagree with the badge.
 */
export function videoAuditAnalysisWired(
  nodeId: string | undefined,
  edges?: ReadonlyArray<{ target: string; targetHandle?: string | null }>,
): boolean {
  if (!nodeId || !edges) return false
  return edges.some((e) => e.target === nodeId && e.targetHandle === "analysis")
}

/**
 * Estimate credit cost for a single node, reading node data for variable-cost nodes.
 *
 * `edges` is optional graph context — only edge-priced node types read it
 * (today: video-audit, whose credit FAMILY depends on whether an analysis is
 * wired). Omitting it never throws; it just falls back to that type's
 * never-under-quoting default.
 */
export function estimateNodeCredits(
  node: { id?: string; type?: string; data?: Record<string, unknown> },
  edges?: ReadonlyArray<{ target: string; targetHandle?: string | null }>,
): number {
  const nodeType = node.type ?? ""
  // Component nodes: use the published estimatedCredits stored on the node data
  if (nodeType === "component" && node.data) {
    return (node.data.estimatedCredits as number) ?? 0
  }
  if (nodeType === "generate-video-pro" && node.data) {
    return estimateGenerateVideoProCredits(node.data as GenerateVideoProNodeData)
  }
  if (nodeType === "edit-video-pro" && node.data) {
    return estimateEditVideoProCredits(node.data as EditVideoProNodeData)
  }
  if (nodeType === "motion-transfer" && node.data) {
    const provider = (node.data.provider as string) ?? "kling"
    const resolution = (node.data.resolution as string) ?? "720p"
    const videoDuration = node.data.videoDuration as number | undefined
    const modelId = buildMotionCreditModelIdentifier(provider, resolution, videoDuration)
    return MOTION_CREDIT_COSTS[modelId] ?? NODE_CREDIT_COSTS["motion-transfer"] ?? 0
  }
  if (nodeType === "web-scrape" && node.data) {
    const rawActor = node.data.actor
    const actor = isScraperActor(rawActor) ? rawActor : "google-search"
    const mode = node.data.mode === "site" ? "site" : "page"
    const modelId = buildScraperCreditId({ actor, mode })
    return SCRAPER_CREDIT_COSTS[modelId] ?? NODE_CREDIT_COSTS["web-scrape"] ?? 0
  }
  if (nodeType === "video-analysis" && node.data) {
    // data.llmModel stores the TIER string ("fast"/"pro"/"mixed"/"mixed-fast") —
    // resolve it to the engine id first (audit fix: the raw tier built
    // non-existent ids like "video-analysis:fast:180s", silently falling back
    // to the flat 1-credit placeholder for every fast/pro node).
    const model = resolveVideoAnalysisModel(node.data.llmModel as string | undefined)
    // A probed YouTube duration is trusted only while it still matches the node's
    // current youtubeUrl (a URL edit invalidates it). For a WIRED video the
    // upstream-probe hook caches the metadata-read duration on the node as
    // `probedVideo` (url-bound; rewritten when the upstream changes) — read it
    // as the fallback so this estimate agrees with the node's own live badge
    // instead of quoting the :600s ceiling (reported 2026-08-02: the confirm
    // dialog said ~1868 for a 72s clip the run then billed at 470). No graph
    // context here to re-verify the url, and none needed: this is display-only
    // (the reserve is computed server-side from the real length), and a stale
    // window only exists for the moment between rewire and the hook's re-probe.
    const probed = node.data.probedYoutube as { url: string; durationSec: number } | undefined
    const probedWired = node.data.probedVideo as { url: string; durationSec: number } | undefined
    const durationSec =
      (probed && probed.url === node.data.youtubeUrl ? probed.durationSec : undefined) ??
      probedWired?.durationSec
    const bucketSec = bucketSecondsFromCreditId(buildVideoAnalysisCreditId(model, durationSec))
    // The $-derived formula moved to the private @nodaroai/cloud-plugins formula (output published as VIDEO_ANALYSIS_BUCKET_CREDITS)
    // (S5) — look up the precomputed credit table instead of computing it here.
    return bucketSec !== null
      ? VIDEO_ANALYSIS_BUCKET_CREDITS[buildVideoAnalysisCreditId(model, bucketSec)] ?? NODE_CREDIT_COSTS["video-analysis"] ?? 0
      : NODE_CREDIT_COSTS["video-analysis"] ?? 0
  }
  if (nodeType === "video-audit" && node.data) {
    // Family from the edges (see videoAuditAnalysisWired), duration from the
    // node's url-bound `probedVideo` cache — the SAME two inputs the node badge
    // feeds buildVideoAuditCreditId, so the canvas total and the per-node pill
    // can only ever quote the same row. No YouTube alternative on this node, so
    // there is no probedYoutube fallback to consider. Unknown duration →
    // buildVideoAuditCreditId's own 600s ceiling composite (never a bare id).
    const probedWired = node.data.probedVideo as { url: string; durationSec: number } | undefined
    const creditId = buildVideoAuditCreditId({
      analysisProvided: videoAuditAnalysisWired(node.id, edges),
      durationSec: probedWired?.durationSec,
    })
    return VIDEO_AUDIT_BUCKET_CREDITS[creditId] ?? NODE_CREDIT_COSTS["video-audit"] ?? 0
  }
  return NODE_CREDIT_COSTS[nodeType] ?? 0
}

// Group/Collect are non-executable aggregators (resolved at field-resolution time, no jobs created).
// DO NOT add "group" or "collect" to EXECUTABLE_TYPES — they fall through to no-op cases in execute-node.ts.
export const EXECUTABLE_TYPES = new Set([
  "generate-script",
  "generate-image",
  "edit-image",
  "image-to-image",
  "modify-image",
  "upscale-image",
  "remove-background",
  "image-to-video",
  "video-to-video",
  "switchx",
  "text-to-video",
  // Unified video node — backend registers in NODE_REGISTRY + payload-builder
  // (Tasks 3.1/3.4). Listed here ahead of the dedicated frontend wire-up
  // (Task 5.1) so the backend's NODE_REGISTRY × EXECUTABLE_TYPES parity check
  // (node-registry-sync.test.ts) stays green.
  "generate-video",
  // Seedance-2-family multi-segment stitch variant of generate-video (Task 13).
  "generate-video-pro",
  // Span-replace sibling of generate-video-pro (Task 14) — Seedance-2-family
  // reference-bridge edit of an existing video's [spanStart, spanEnd) window.
  "edit-video-pro",
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-lyrics",
  "suno-separate",
  "audio-separation",
  "suno-music-video",
  "suno-mashup",
  "suno-replace-section",
  "suno-style-boost",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-convert-wav",
  "suno-upload-extend",
  "transcribe",
  "lip-sync",
  "speech-to-video",
  "ai-avatar",
  "cinematic-avatar",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  "video-retake",
  "face-swap",
  "video-sfx",
  "generate-mask",
  "video-composer",
  "after-effects",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "composite",
  "render-video",
  "combine-videos",
  "assemble-narrated-video",
  "image-collage",
  "merge-video-audio",
  "still-to-video",
  "slideshow",
  "trim-audio",
  "split-media",
  "extract-audio",
  "remove-audio",
  "trim-video",
  "extract-frame",
  "transcode-video",
  "speed-ramp",
  "loop-video",
  "gif-to-video",
  "fade-video",
  "resize-video",
  "adjust-volume",
  "audio-fx",
  "add-captions",
  "mix-audio",
  "combine-audio",
  "scene",
  "character",
  "face",
  "object",
  "creature",
  "location",
  "llm-chat",
  "combine-text",
  "split-text",
  "extract-field",
  "json-process",
  "filter-list",
  "deduplicate",
  "merge-lists",
  "sort-list",
  "selector",
  "audio-isolation",
  "text-to-dialogue",
  "image-to-text",
  "describe-to-picker",
  "voice-changer",
  "voice-changer-pro",
  "dubbing",
  "voice-remix",
  "voice-design",
  "forced-alignment",
  "sub-workflow",
  "webhook-output",
  "social-media-format",
  "instagram-post",
  "tiktok-post",
  "youtube-upload",
  "linkedin-post",
  "x-post",
  "facebook-post",
  "telegram-post",
  "publish-social",
  "telegram-channel-feed",
  "save-to-storage",
  "qa-check",
  "image-critic",
  "web-scrape",
  "video-analysis",
  // AI Audit — re-watches a clip against an analysis and emits the CORRECTED
  // analysis (same payload shape as video-analysis, so it chains anywhere an
  // analysis does). Priced per family × duration bucket (estimateNodeCredits).
  "video-audit",
  "router",
  "teleport-send",
  "teleport-receive",
  "component",
  "generative-pipeline",
  "reduce",
  "reference-sheet",
  "reference-board",
]);

/** Frontend mirror of backend's FAN_IN_NODE_TYPES.
 * Used to skip fan-out for nodes that consume listResults whole. */
export const FAN_IN_NODE_TYPES = new Set(["reduce"])

export const MAX_CONSECUTIVE_POLL_FAILURES = 20;

/** Update currentJobProgress only if value changed, avoiding no-op store updates. */
export function updateProgressIfChanged(
  nodeId: string,
  newProgress: number,
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): void {
  const prev = (useWorkflowStore.getState().nodes.find(n => n.id === nodeId)?.data as Record<string, unknown>)?.currentJobProgress;
  if (newProgress !== prev) {
    updateNodeData(nodeId, { currentJobProgress: newProgress });
  }
}

/** Mirror of updateProgressIfChanged for the self-heal "Recovering" flag —
 *  only writes on transitions so the 2s poll doesn't churn node data. */
export function updateRecoveringIfChanged(
  nodeId: string,
  recovering: boolean,
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): void {
  const prev = (useWorkflowStore.getState().nodes.find(n => n.id === nodeId)?.data as Record<string, unknown>)?.jobRecovering;
  if (recovering !== Boolean(prev)) {
    updateNodeData(nodeId, { jobRecovering: recovering });
  }
}

export function isExecutableNode(node: WorkflowNode): boolean {
  return EXECUTABLE_TYPES.has(node.type ?? "");
}

// Re-exported from @nodaro/shared (single source of truth) so this set and the
// backend's DEFAULT_EACH_TYPES can never drift apart.
export { FAN_OUT_EACH_TYPES };

/**
 * Estimate the fan-out multiplier for a node based on upstream list/loop nodes.
 * Returns 1 if no fan-out, or the number of list items if fan-out is detected.
 * Multiplies by repeatCount so credit estimates reflect repeated execution.
 */
export function getFanOutMultiplier(
  node: WorkflowNode,
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
): number {
  const baseFanOut = getBaseFanOut(node, allNodes, edges);
  const repeat = getEffectiveRepeatCount(node.data as Record<string, unknown>);
  return baseFanOut * repeat;
}

function getBaseFanOut(
  node: WorkflowNode,
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
): number {
  const incomingEdges = edges.filter((e) => e.target === node.id);

  for (const edge of incomingEdges) {
    const sourceNode = allNodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;

    const edgeMode = (edge.data as Record<string, unknown> | undefined)
      ?.outputMode as string | undefined;
    const mode =
      edgeMode ??
      (FAN_OUT_EACH_TYPES.has(sourceNode.type ?? "") ? "each" : "last");
    if (mode !== "each") continue;

    const edgeData = edge.data as Record<string, unknown> | undefined;
    const selector = edgeData as SelectorFields | undefined;

    if (sourceNode.type === "list") {
      const items = ((sourceNode.data as Record<string, unknown>).items as string || "")
        .split("\n").map((s) => s.trim()).filter(Boolean);
      const n = fanOutCount(items, selector);
      if (n > 0) return n;
    }

    if (sourceNode.type === "list") {
      const rows = (sourceNode.data as Record<string, unknown>).rows as
        | string[][]
        | undefined;
      if (rows && rows.length > 1) {
        const rowStrs = rows.map((_, i) => String(i + 1));
        const n = fanOutCount(rowStrs, selector);
        if (n > 0) return n;
      }
    }

    // Transitive: text-prompt upstream of list
    if (sourceNode.type === "text-prompt") {
      const srcEdges = edges.filter((e) => e.target === sourceNode.id);
      for (const srcEdge of srcEdges) {
        const listNode = allNodes.find((n) => n.id === srcEdge.source);
        if (!listNode || !FAN_OUT_EACH_TYPES.has(listNode.type ?? "")) continue;
        const gpMode = (srcEdge.data as Record<string, unknown> | undefined)
          ?.outputMode as string | undefined;
        if ((gpMode ?? "each") !== "each") continue;

        const gpSelector = srcEdge.data as SelectorFields | undefined;

        if (listNode.type === "list") {
          const items = ((listNode.data as Record<string, unknown>).items as string || "")
            .split("\n").map((s) => s.trim()).filter(Boolean);
          const n = fanOutCount(items, gpSelector);
          if (n > 0) return n;
        }
        if (listNode.type === "list") {
          const rows = (listNode.data as Record<string, unknown>).rows as
            | string[][]
            | undefined;
          if (rows && rows.length > 1) {
            const rowStrs = rows.map((_, i) => String(i + 1));
            const n = fanOutCount(rowStrs, gpSelector);
            if (n > 0) return n;
          }
        }
      }
    }
  }

  return 1;
}

/** Fan-out count for a list with an optional selector: returns 0 when ≤1 item after filtering. */
function fanOutCount(items: string[], selector: SelectorFields | undefined): number {
  const count = isDefaultSelectorConfig(selector) ? items.length : selectListItems(items, selector).length;
  return count > 1 ? count : 0;
}

/** Payload for the run-confirmation dialog (Execute-All always; any run >100cr). */
export interface RunConfirmInfo {
  readonly trigger: "all" | "selected" | "from-here" | "single";
  readonly nodeCount: number;
  /** Estimated credits, or null in non-credit editions (cost line hidden). */
  readonly estimatedCredits: number | null;
  /** True for Execute-All (confirm regardless of cost). */
  readonly alwaysConfirm: boolean;
}

export interface ExecutionContext {
  userId: string | undefined;
  projectId: string | undefined;
  /**
   * Per-run cancellation signal. Set by `handleRunSingleNode` from a per-node
   * `AbortController` (see `lib/node-run-abort.ts`) and threaded into the
   * execution so the node's Stop button can abort an in-flight stream/request
   * immediately. Undefined for runs that don't support per-node cancellation.
   */
  signal?: AbortSignal;
  trackInterval: (
    interval: ReturnType<typeof setInterval>,
  ) => ReturnType<typeof setInterval>;
  untrackInterval: (interval: ReturnType<typeof setInterval>) => void;
  save: (projectId: string) => Promise<void>;
  setIsRunning: (v: boolean) => void;
  isWorkflowStale: () => boolean;
  isStorageError: (err: unknown) => boolean;
  setShowStorageExceeded: (v: boolean) => void;
  setStorageExceededData: (
    data: { usedBytes: number; quotaBytes: number; tier: string } | null,
  ) => void;
  setShowInsufficientCredits: (v: boolean) => void;
  setInsufficientCreditsData: (
    data: { required: number; available: number; tier: string } | null,
  ) => void;
  /** Spend-surface block (payg account in the studio). Optional so existing
   *  ctx mocks and non-editor callers keep working; absent → the error falls
   *  through to generic per-node handling. */
  setShowSubscriptionRequired?: (v: boolean) => void;
  /**
   * Idempotency key for this user-click intent. Set by the click handler
   * (handleRunSingleNode, handleRun, etc.) — one UUID per click. Run*
   * wrappers in node-executors.ts read this and pass it to api.ts so the
   * backend can dedupe React StrictMode / network retries of THIS click
   * WITHOUT collapsing intentional re-runs (the next click generates a
   * fresh UUID → fresh ctx → fresh keys → new jobs).
   *
   * For fan-out (list iteration), each iteration must produce a distinct
   * job, so the run* wrappers append `:iter:N` per iteration via
   * `iterationIdempotencyKey()` — same intent, distinct rows.
   *
   * Undefined when the execution is not user-triggered (auto-execute
   * cascades, programmatic re-runs); in that case, no dedup is applied
   * and every call creates a fresh row.
   */
  idempotencyKey?: string;
  /**
   * Run-confirmation gate. Resolves true to proceed, false to abort. Provided by
   * the editor (backed by a single-flight AlertDialog). Optional so non-editor
   * callers (and tests) can omit it — handlers treat an absent gate as "proceed".
   */
  confirmRun?: (info: RunConfirmInfo) => Promise<boolean>;
}

// `iterationIdempotencyKey` lives in `frontend/src/lib/idempotency-key.ts`
// (not here in types.ts) — many tests in this directory mock `../types`
// and re-exporting the helper through types would force every such mock
// to also stub it. Keeping it in the lib file means execute-node.ts can
// import it directly from `@/lib/idempotency-key` and tests don't need
// per-file updates.

/** Check if an error is a blocking-modal error (storage exceeded, or the payg
 *  spend-surface block) and show the matching modal. Returns true if handled —
 *  callers skip their generic per-node error handling. Kept under the original
 *  name so all 18 call sites (and their test mocks) pick this up unchanged. */
export function checkStorageError(
  err: unknown,
  ctx: ExecutionContext,
): boolean {
  if (err instanceof StorageExceededError) {
    ctx.setStorageExceededData({
      usedBytes: err.usedBytes,
      quotaBytes: err.quotaBytes,
      tier: err.tier,
    });
    ctx.setShowStorageExceeded(true);
    return true;
  }
  if (err instanceof SubscriptionRequiredError && ctx.setShowSubscriptionRequired) {
    ctx.setShowSubscriptionRequired(true);
    return true;
  }
  return false;
}
