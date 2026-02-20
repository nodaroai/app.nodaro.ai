import type { WorkflowNode, WorkflowEdge } from "@/types/nodes";
import { StorageExceededError } from "@/lib/api";

/** Sentinel error thrown when a polling callback detects that the active
 *  workflow has changed. Callers should catch this silently (no error toast). */
export class WorkflowStaleError extends Error {
  constructor() {
    super("Workflow changed during execution");
  }
}

export const NODE_CREDIT_COSTS: Record<string, number> = {
  "generate-script": 2,
  "generate-image": 5,
  "edit-image": 3,
  "image-to-image": 5,
  "image-to-video": 20,
  "video-to-video": 25,
  "text-to-video": 25,
  "text-to-speech": 3,
  "generate-music": 5,
  "text-to-audio": 3,
  "suno-generate": 3,
  "suno-cover": 3,
  "suno-extend": 3,
  "suno-lyrics": 1,
  "suno-separate": 2,
  "suno-music-video": 1,
  "lip-sync": 40,
  "motion-transfer": 30,
  "video-upscale": 20,
  transcribe: 2,
  "ai-writer": 2,
  "combine-videos": 2,
  "merge-video-audio": 1,
  "extract-audio": 1,
  "trim-video": 0,
  "speed-ramp": 0,
  "loop-video": 0,
  "fade-video": 0,
  "resize-video": 1,
  "adjust-volume": 0,
  "add-captions": 2,
  "mix-audio": 1,
  "video-composer": 2,
  "after-effects": 2,
  "lottie-overlay": 2,
  "3d-title": 3,
  "motion-graphics": 2,
  "composite": 0,
  "render-video": 3,
  character: 5,
  object: 5,
  location: 5,
};

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
  "transcribe",
  "lip-sync",
  "motion-transfer",
  "video-upscale",
  "video-composer",
  "after-effects",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "composite",
  "render-video",
  "combine-videos",
  "merge-video-audio",
  "extract-audio",
  "trim-video",
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
]);

export const MAX_CONSECUTIVE_POLL_FAILURES = 5;

export function isExecutableNode(node: WorkflowNode): boolean {
  return EXECUTABLE_TYPES.has(node.type ?? "");
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
