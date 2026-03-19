import type { WorkflowNode, WorkflowEdge } from "@/types/nodes";
import { StorageExceededError } from "@/lib/api";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { buildMotionCreditModelIdentifier } from "@nodaro-shared/credit-identifiers";

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
  "edit-image": 2,
  "image-to-image": 2,
  "image-to-video": 25,
  "video-to-video": 25,
  "text-to-video": 25,
  "text-to-speech": 4,
  "generate-music": 7,
  "text-to-audio": 4,
  "suno-generate": 7,
  "suno-v5": 13,
  "suno-cover": 7,
  "suno-extend": 7,
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
  "sora-storyboard": 47,
  "sora-character": 5,
  "motion-transfer": 38,
  "video-upscale": 19,
  "extend-video": 40,
  "transcribe": 4,
  "ai-writer": 5,
  "combine-videos": 0,
  "merge-video-audio": 0,
  "trim-audio": 0,
  "trim-video": 0,
  "speed-ramp": 0,
  "loop-video": 0,
  "fade-video": 0,
  "resize-video": 0,
  "adjust-volume": 0,
  "add-captions": 0,
  "mix-audio": 0,
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
  "audio-isolation": 1,
  "image-to-text": 5,
  "text-to-dialogue": 4,
  "transcode-video": 0,
  "sub-workflow": 0,
  "social-media-format": 0,
  "instagram-post": 1,
  "tiktok-post": 1,
  "youtube-upload": 1,
  "linkedin-post": 1,
  "x-post": 1,
  "facebook-post": 1,
  "telegram-post": 1,
  "save-to-storage": 0,
  "qa-check": 5,
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
  if (nodeType === "motion-transfer" && node.data) {
    const provider = (node.data.provider as string) ?? "kling"
    const resolution = (node.data.resolution as string) ?? "720p"
    const videoDuration = node.data.videoDuration as number | undefined
    const modelId = buildMotionCreditModelIdentifier(provider, resolution, videoDuration)
    return MOTION_CREDIT_COSTS[modelId] ?? NODE_CREDIT_COSTS["motion-transfer"] ?? 0
  }
  return NODE_CREDIT_COSTS[nodeType] ?? 0
}

export const EXECUTABLE_TYPES = new Set([
  "generate-script",
  "generate-image",
  "edit-image",
  "image-to-image",
  "image-to-video",
  "video-to-video",
  "text-to-video",
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
  "sora-storyboard",
  "sora-character",
  "motion-transfer",
  "video-upscale",
  "extend-video",
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
  "trim-video",
  "transcode-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "resize-video",
  "adjust-volume",
  "add-captions",
  "mix-audio",
  "scene",
  "character",
  "face",
  "object",
  "location",
  "ai-writer",
  "combine-text",
  "split-text",
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
]);

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

const FAN_OUT_EACH_TYPES = new Set(["list", "loop", "split-text"]);

/**
 * Estimate the fan-out multiplier for a node based on upstream list/loop nodes.
 * Returns 1 if no fan-out, or the number of list items if fan-out is detected.
 */
export function getFanOutMultiplier(
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

    // Direct fan-out from list node
    if (sourceNode.type === "list") {
      const items = ((sourceNode.data as Record<string, unknown>).items as string || "")
        .split("\n").map((s) => s.trim()).filter(Boolean);
      if (items.length > 1) return items.length;
    }

    // Direct fan-out from loop node
    if (sourceNode.type === "loop") {
      const rows = (sourceNode.data as Record<string, unknown>).rows as
        | string[][]
        | undefined;
      if (rows && rows.length > 1) return rows.length;
    }

    // Transitive: text-prompt upstream of list/loop
    if (sourceNode.type === "text-prompt") {
      const srcEdges = edges.filter((e) => e.target === sourceNode.id);
      for (const srcEdge of srcEdges) {
        const listNode = allNodes.find((n) => n.id === srcEdge.source);
        if (!listNode || !FAN_OUT_EACH_TYPES.has(listNode.type ?? "")) continue;
        const gpMode = (srcEdge.data as Record<string, unknown> | undefined)
          ?.outputMode as string | undefined;
        if ((gpMode ?? "each") !== "each") continue;

        if (listNode.type === "list") {
          const items = ((listNode.data as Record<string, unknown>).items as string || "")
            .split("\n").map((s) => s.trim()).filter(Boolean);
          if (items.length > 1) return items.length;
        }
        if (listNode.type === "loop") {
          const rows = (listNode.data as Record<string, unknown>).rows as
            | string[][]
            | undefined;
          if (rows && rows.length > 1) return rows.length;
        }
      }
    }
  }

  return 1;
}

export interface ExecutionContext {
  userId: string | undefined;
  projectId: string | undefined;
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
}

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
