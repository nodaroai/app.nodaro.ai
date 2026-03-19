import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import {
  generateImage,
  editImage,
  imageToImage,
  generateVideo,
  videoToVideo,
  textToVideo,
  textToSpeech,
  generateScriptApi,
  combineVideos,
  getJobStatus,
} from "@/lib/api";
import type {
  GeneratedScript,
  GeneratedScriptResult,
  EditImageData,
  ImageToImageData,
  GenerateScriptData,
} from "@/types/nodes";
import {
  WorkflowStaleError,
  MAX_CONSECUTIVE_POLL_FAILURES,
  checkStorageError,
  type ExecutionContext,
} from "./types";
import { pollJobWithNodeUpdate } from "./poll-job";

/** Extract kieTaskId from output data for downstream video chaining. */
const extractKieTaskId = (od: Record<string, unknown>) => {
  const kieTaskId = od.kieTaskId as string | undefined;
  return kieTaskId ? { kieTaskId } : {};
};

// --- Image generation ---

export function runImageGeneration(
  nodeId: string,
  prompt: string,
  ctx: ExecutionContext,
  referenceImageUrls?: string[],
  provider?: string,
  aspectRatio?: string,
  resolution?: string,
  quality?: string,
  negativePrompt?: string,
  seed?: number,
  renderingSpeed?: string,
  styleType?: string,
  expandPrompt?: boolean,
): Promise<void> {
  return pollJobWithNodeUpdate(
    nodeId,
    () =>
      generateImage(
        prompt,
        referenceImageUrls,
        provider,
        undefined,
        aspectRatio,
        ctx.userId,
        resolution,
        quality,
        negativePrompt,
        seed,
        renderingSpeed,
        styleType,
        expandPrompt,
      ),
    "generatedImageUrl",
    "Image generation",
    ctx,
  );
}

// --- Edit image ---

export function runEditImage(
  nodeId: string,
  imageUrl: string,
  ctx: ExecutionContext,
  prompt?: string,
  provider?: EditImageData["provider"],
  options?: {
    upscaleFactor?: string
    targetResolution?: string
    aspectRatio?: string
    negativePrompt?: string
    style?: string
    seed?: number
    referenceImageUrls?: string[]
  },
): Promise<void> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => editImage(imageUrl, prompt, provider, ctx.userId, options),
    "generatedImageUrl",
    "Image editing",
    ctx,
  );
}

// --- Image to image ---

export function runImageToImage(
  nodeId: string,
  imageUrl: string,
  prompt: string,
  ctx: ExecutionContext,
  provider?: ImageToImageData["provider"],
  referenceImageUrls?: string[],
  options?: {
    strength?: number
    aspectRatio?: string
    resolution?: string
    quality?: string
    negativePrompt?: string
    seed?: number
    renderingSpeed?: string
    guidanceScale?: number
    maskUrl?: string
  },
): Promise<void> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => imageToImage(imageUrl, prompt, provider, ctx.userId, referenceImageUrls, options),
    "generatedImageUrl",
    "Image transformation",
    ctx,
  );
}

// --- Video generation ---

export function runVideoGeneration(
  nodeId: string,
  startFrameUrl: string,
  ctx: ExecutionContext,
  endFrameUrl?: string,
  audioUrl?: string,
  provider?: string,
  generateAudio?: boolean,
  duration?: number,
  prompt?: string,
  mode?: string,
  sound?: boolean,
  aspectRatio?: string,
  multiShot?: boolean,
  shots?: Array<{ prompt: string; duration: number }>,
  elements?: Array<{
    name: string;
    description: string;
    type: "image" | "video";
    urls: string[];
  }>,
  negativePrompt?: string,
  cfgScale?: number,
  resolution?: string,
  grokMode?: string,
  videoSize?: string,
  seed?: number,
  cameraFixed?: boolean,
  removeWatermark?: boolean,
  characterIdList?: string[],
): Promise<void> {
  return pollJobWithNodeUpdate(
    nodeId,
    () =>
      generateVideo({
        startFrameUrl,
        endFrameUrl,
        audioUrl,
        prompt,
        provider,
        generateAudio,
        duration,
        mode,
        sound,
        negativePrompt,
        cfgScale,
        aspectRatio,
        multiShot,
        shots,
        elements,
        resolution,
        grokMode,
        videoSize,
        seed,
        cameraFixed,
        removeWatermark,
        characterIdList,
        userId: ctx.userId,
      }),
    "generatedVideoUrl",
    "Video generation",
    ctx,
    extractKieTaskId,
  );
}

// --- Video to video ---

export function runVideoToVideoGeneration(
  nodeId: string,
  sourceVideoUrl: string,
  ctx: ExecutionContext,
  prompt?: string,
  provider?: string,
): Promise<void> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => videoToVideo(sourceVideoUrl, prompt, provider, ctx.userId),
    "generatedVideoUrl",
    "Video-to-video generation",
    ctx,
  );
}

// --- Text to video ---

export function runTextToVideoGeneration(
  nodeId: string,
  prompt: string,
  ctx: ExecutionContext,
  provider?: string,
  kling3Options?: {
    duration?: number;
    mode?: string;
    sound?: boolean;
    negativePrompt?: string;
    cfgScale?: number;
    aspectRatio?: string;
    multiShot?: boolean;
    shots?: Array<{ prompt: string; duration: number }>;
    elements?: Array<{
      name: string;
      description: string;
      type: "image" | "video";
      urls: string[];
    }>;
    removeWatermark?: boolean;
    seed?: number;
  },
  characterIdList?: string[],
): Promise<void> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => textToVideo(prompt, provider, ctx.userId, { ...kling3Options, characterIdList }),
    "generatedVideoUrl",
    "Text-to-video generation",
    ctx,
    extractKieTaskId,
  );
}

// --- Text to speech ---

export function runTextToSpeechGeneration(
  nodeId: string,
  text: string,
  ctx: ExecutionContext,
  voice?: string,
  provider?: string,
  options?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speed?: number;
    languageCode?: string;
    voiceType?: "premade" | "custom" | "library";
  },
): Promise<void> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => textToSpeech(text, voice, provider, ctx.userId, options),
    "generatedAudioUrl",
    "Text-to-speech generation",
    ctx,
  );
}

// --- Script generation ---

export function runScriptGeneration(
  nodeId: string,
  prompt: string,
  ctx: ExecutionContext,
  sceneCount?: number,
  tone?: string,
  targetDuration?: number,
  provider?: string,
  llmModel?: string,
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, { executionStatus: "running" });

  return new Promise((resolve, reject) => {
    generateScriptApi({ prompt, sceneCount, tone, targetDuration, provider, llmModel, userId: ctx.userId })
      .then(({ jobId }) => {
        toast.info("Script generation started", {
          description: `Job ID: ${jobId}`,
        });
        updateNodeData(nodeId, { currentJobId: jobId });

        let pollFailures = 0;
        const poll = ctx.trackInterval(
          setInterval(async () => {
            if (ctx.isWorkflowStale()) {
              ctx.untrackInterval(poll);
              reject(new WorkflowStaleError());
              return;
            }
            try {
              const job = await getJobStatus(jobId);
              pollFailures = 0;
              if (job.status === "completed") {
                ctx.untrackInterval(poll);
                const script = job.output_data?.script as
                  | GeneratedScript
                  | undefined;
                const existingResults =
                  (
                    useWorkflowStore
                      .getState()
                      .nodes.find((n) => n.id === nodeId)?.data as
                      | GenerateScriptData
                      | undefined
                  )?.generatedResults ?? [];
                const newResult: GeneratedScriptResult = {
                  script: script ?? {
                    title: "",
                    totalDuration: 0,
                    scenes: [],
                  },
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  generatedScript: script,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                });
                toast.success("Script generated", {
                  description: script?.title,
                });
                resolve();
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                toast.error("Script generation failed", {
                  description: errMsg,
                });
                reject(new Error(errMsg));
              }
            } catch (err) {
              pollFailures++;
              if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                ctx.untrackInterval(poll);
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  currentJobId: undefined,
                });
                toast.error("Failed to check script generation status");
                reject(err);
              }
            }
          }, 2000),
        );
      })
      .catch((err) => {
        updateNodeData(nodeId, {
          executionStatus: "failed",
          currentJobId: undefined,
        });
        if (!checkStorageError(err, ctx)) {
          toast.error("Failed to start script generation", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        reject(err);
      });
  });
}

// --- Combine videos ---

export function runCombineVideos(
  nodeId: string,
  videoUrls: string[],
  transition: "cut" | "fade" | "dissolve" | "dip-to-black" | "dip-to-white",
  transitionDuration: number,
  audioMode: "keep" | "crossfade" | "remove",
  ctx: ExecutionContext,
): Promise<void> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => combineVideos(videoUrls, transition, transitionDuration, audioMode, ctx.userId),
    "generatedVideoUrl",
    "Combine videos",
    ctx,
  );
}
