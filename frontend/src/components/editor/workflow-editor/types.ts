import type { WorkflowNode, WorkflowEdge } from "@/types/nodes";
import { StorageExceededError } from "@/lib/api";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { buildMotionCreditModelIdentifier } from "@nodaro/shared";
import { isDefaultSelectorConfig, selectListItems, type SelectorFields } from "@nodaro/shared";
import { getEffectiveRepeatCount } from "@nodaro/shared";
import { buildScraperCreditId, isScraperActor, SCRAPER_CREDIT_COSTS } from "@nodaro/shared";

/** Sentinel error thrown when a polling callback detects that the active
 *  workflow has changed. Callers should catch this silently (no error toast). */
export class WorkflowStaleError extends Error {
  constructor() {
    super("Workflow changed during execution");
  }
}

export const NODE_CREDIT_COSTS: Record<string, number> = {
  "generate-script": 10,
  "generate-image": 2,
  "modify-image": 2,
  "upscale-image": 1,
  "remove-background": 1,
  "image-to-video": 25,
  "video-to-video": 25,
  "text-to-video": 25,
  "text-to-speech": 4,
  "generate-music": 4,
  "text-to-audio": 4,
  "suno-generate": 4,
  "suno-v5": 4,
  "suno-cover": 4,
  "suno-extend": 4,
  "suno-lyrics": 2,
  "suno-separate": 5,
  "suno-music-video": 5,
  "suno-mashup": 4,
  "suno-replace-section": 2,
  "suno-style-boost": 1,
  "suno-add-instrumental": 4,
  "suno-add-vocals": 4,
  "suno-convert-wav": 1,
  "suno-upload-extend": 4,
  "lip-sync": 13,
  "speech-to-video": 4,
  "motion-transfer": 19,
  "video-upscale": 19,
  "extend-video": 40,
  "face-swap": 16,
  "transcribe": 4,
  "combine-videos": 3,
  "merge-video-audio": 2,
  "trim-audio": 1,
  "split-media": 2,
  "extract-audio": 1,
  "remove-audio": 2,
  "trim-video": 1,
  "extract-frame": 1,
  "speed-ramp": 2,
  "loop-video": 1,
  "fade-video": 1,
  "resize-video": 2,
  "adjust-volume": 1,
  "add-captions": 3,
  "mix-audio": 2,
  "combine-audio": 1,
  "video-composer": 10,
  "after-effects": 10,
  "lottie-overlay": 10,
  "3d-title": 15,
  "motion-graphics": 10,
  "composite": 0,
  "render-video": 15,
  "character": 2,
  "object": 2,
  "location": 2,
  "voice-changer": 4,
  "dubbing": 8,
  "voice-remix": 4,
  "voice-design": 5,
  "forced-alignment": 3,
  "audio-isolation": 8,
  "image-to-text": 5,
  "text-to-dialogue": 4,
  "transcode-video": 1,
  "sub-workflow": 0,
  "filter-list": 0,
  "deduplicate": 0,
  "merge-lists": 0,
  "sort-list": 0,
  "selector": 0,
  "social-media-format": 2,
  "instagram-post": 1,
  "tiktok-post": 1,
  "youtube-upload": 1,
  "linkedin-post": 1,
  "x-post": 1,
  "facebook-post": 1,
  "telegram-post": 1,
  "save-to-storage": 0,
  "qa-check": 5,
  "image-critic": 5,
  "web-scrape": 5,
};

/** Motion-transfer composite credit costs (mirrors STATIC_CREDIT_COSTS in backend) */
const MOTION_CREDIT_COSTS: Record<string, number> = {
  "kling-3.0-motion:5s": 19,
  "kling-3.0-motion:10s": 38,
  "kling-3.0-motion:15s": 57,
  "kling-3.0-motion:30s": 113,
  "kling-3.0-motion:1080p:5s": 32,
  "kling-3.0-motion:1080p:10s": 63,
  "kling-3.0-motion:1080p:15s": 94,
  "kling-3.0-motion:1080p:30s": 188,
  "motion-transfer:5s": 10,
  "motion-transfer:10s": 19,
  "motion-transfer:15s": 29,
  "motion-transfer:30s": 57,
  "motion-transfer:1080p:5s": 15,
  "motion-transfer:1080p:10s": 29,
  "motion-transfer:1080p:15s": 43,
  "motion-transfer:1080p:30s": 85,
}

/**
 * Estimate credit cost for a single node, reading node data for variable-cost nodes.
 */
export function estimateNodeCredits(node: { type?: string; data?: Record<string, unknown> }): number {
  const nodeType = node.type ?? ""
  // Component nodes: use the published estimatedCredits stored on the node data
  if (nodeType === "component" && node.data) {
    return (node.data.estimatedCredits as number) ?? 0
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
  "text-to-video",
  // Unified video node — backend registers in NODE_REGISTRY + payload-builder
  // (Tasks 3.1/3.4). Listed here ahead of the dedicated frontend wire-up
  // (Task 5.1) so the backend's NODE_REGISTRY × EXECUTABLE_TYPES parity check
  // (node-registry-sync.test.ts) stays green.
  "generate-video",
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-lyrics",
  "suno-separate",
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
  "merge-video-audio",
  "trim-audio",
  "split-media",
  "extract-audio",
  "remove-audio",
  "trim-video",
  "extract-frame",
  "transcode-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "resize-video",
  "adjust-volume",
  "add-captions",
  "mix-audio",
  "combine-audio",
  "scene",
  "character",
  "face",
  "object",
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
  "voice-changer",
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
  "save-to-storage",
  "qa-check",
  "image-critic",
  "web-scrape",
  "router",
  "teleport-send",
  "teleport-receive",
  "component",
  "generative-pipeline",
  "reduce",
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

export function isExecutableNode(node: WorkflowNode): boolean {
  return EXECUTABLE_TYPES.has(node.type ?? "");
}

export const FAN_OUT_EACH_TYPES = new Set(["list", "split-text", "filter-list", "deduplicate", "merge-lists", "sort-list", "selector"]);

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
}

// `iterationIdempotencyKey` lives in `frontend/src/lib/idempotency-key.ts`
// (not here in types.ts) — many tests in this directory mock `../types`
// and re-exporting the helper through types would force every such mock
// to also stub it. Keeping it in the lib file means execute-node.ts can
// import it directly from `@/lib/idempotency-key` and tests don't need
// per-file updates.

/** Check if an error is a StorageExceededError and show the modal. Returns true if handled. */
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
  return false;
}
