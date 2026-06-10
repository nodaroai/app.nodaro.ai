import { useWorkflowStore } from "@/hooks/use-workflow-store";
import {
  generateImage,
  editImage,
  imageToImage,
  modifyImage,
  upscaleImage,
  removeBackground,
  generateVideo,
  videoToVideo,
  textToVideo,
  textToSpeech,
  generateScriptApi,
  generateMotionGraphics,
  combineVideos,
  getJobStatusLean,
  cancelJob,
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
import { pollJobWithNodeUpdate, guardedToast } from "./poll-job";
import { shouldAbandonNode } from "./abandon-guard";

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
  identity?: {
    /** Forward injectCharacterContext + attachToCharacterId to the
     *  /v1/generate-image route — backend appends the character's
     *  canonical_description to the prompt. */
    injectCharacterContext?: boolean
    attachToCharacterId?: string
  },
  /**
   * Internal-only LoRA hint for single-node Run of a generate-image node
   * whose single wired character has a successful LoRA. The api.ts
   * `generateImage` wrapper attaches this as `_internalLora` on the body
   * AND forces `provider = "flux-lora-character"`. Backend resolves the
   * `characterId` server-side (preventing a stolen JWT from spoofing
   * another user's LoRA version).
   */
  internalLora?: { readonly characterId: string },
  /** Per-call idempotency key. The click handler sets ctx.idempotencyKey;
   *  executeNode derives a per-iteration suffix for fan-out and passes
   *  the final key here. The backend dedupes POSTs sharing this key. */
  idempotencyKey?: string,
  /** Inpaint / i2i levers (base image + mask + strength + guidance scale).
   *  Forwarded verbatim to the api.ts `generateImage` body builder, which
   *  drops each onto the request only when present. */
  inpaint?: {
    baseImageUrl?: string
    maskUrl?: string
    strength?: number
    guidanceScale?: number
  },
): Promise<string> {
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
        identity,
        internalLora,
        idempotencyKey,
        inpaint,
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
    maskUrl?: string
  },
): Promise<string> {
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
    /** Forward injectCharacterContext + attachToCharacterId to the
     *  /v1/image-to-image route — backend (non-studio path) appends the
     *  character's canonical_description to the prompt. */
    injectCharacterContext?: boolean
    attachToCharacterId?: string
  },
): Promise<string> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => imageToImage(imageUrl, prompt, provider, ctx.userId, referenceImageUrls, options),
    "generatedImageUrl",
    "Image transformation",
    ctx,
  );
}

// --- Modify image (delegates to edit-image or image-to-image) ---

export function runModifyImage(
  nodeId: string,
  imageUrl: string,
  prompt: string,
  ctx: ExecutionContext,
  provider?: string,
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
    style?: string
  },
): Promise<string> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => modifyImage(imageUrl, prompt, provider, ctx.userId, referenceImageUrls, options),
    "generatedImageUrl",
    "Image modification",
    ctx,
  );
}

// --- Upscale image ---

export function runUpscaleImage(
  nodeId: string,
  imageUrl: string,
  ctx: ExecutionContext,
  provider?: string,
  options?: { upscaleFactor?: string; targetResolution?: string },
): Promise<string> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => upscaleImage(imageUrl, provider, options),
    "generatedImageUrl",
    "Image upscale",
    ctx,
  );
}

// --- Remove background ---

export function runRemoveBackground(
  nodeId: string,
  imageUrl: string,
  ctx: ExecutionContext,
): Promise<string> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => removeBackground(imageUrl),
    "generatedImageUrl",
    "Background removal",
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
  referenceImageUrls?: string[],
  generationType?: string,
  extras?: {
    referenceVideoUrls?: string[];
    referenceAudioUrls?: string[];
    webSearch?: boolean;
    nsfwChecker?: boolean;
    /** VEO 3.x: opt out of KIE's auto-translate-to-English. */
    enableTranslation?: boolean;
    /** Smart-loop-cut post-process (replaces legacy autoLoopTrim). */
    loopTrim?: {
      enabled: boolean;
      framesToTest?: number;
      quality?: "lossless" | "precise";
    };
    seedance2InputMode?: "frames" | "references";
    /** Forward injectCharacterContext + attachToCharacterId to the
     *  /v1/generate-video route — backend appends the character's
     *  canonical_description to the prompt. */
    injectCharacterContext?: boolean;
    attachToCharacterId?: string;
    /** "Save result to character" — a non-empty variant label tells the
     *  backend to append the completed clip to the character's
     *  reference_videos_by_variant on job completion. Independent of
     *  injectCharacterContext. */
    attachReferenceVideoVariant?: string;
    videoTrimStart?: number;
    videoTrimEnd?: number;
  },
  /** Per-call idempotency key — see runImageGeneration for rationale. */
  idempotencyKey?: string,
): Promise<string> {
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
        referenceImageUrls,
        referenceVideoUrls: extras?.referenceVideoUrls,
        referenceAudioUrls: extras?.referenceAudioUrls,
        webSearch: extras?.webSearch,
        nsfwChecker: extras?.nsfwChecker,
        generationType,
        seedance2InputMode: extras?.seedance2InputMode,
        enableTranslation: extras?.enableTranslation,
        loopTrim: extras?.loopTrim,
        videoTrimStart: extras?.videoTrimStart,
        videoTrimEnd: extras?.videoTrimEnd,
        injectCharacterContext: extras?.injectCharacterContext,
        attachToCharacterId: extras?.attachToCharacterId,
        attachReferenceVideoVariant: extras?.attachReferenceVideoVariant,
        userId: ctx.userId,
        idempotencyKey,
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
  options?: {
    duration?: string;
    resolution?: string;
    audio?: boolean;
    multiShots?: boolean;
    aspectRatio?: string;
    seed?: number;
    referenceImageUrl?: string;
    // Wan video edit (wan-videoedit) params
    negativePrompt?: string;
    videoEditDuration?: string;
    audioSetting?: string;
    promptExtend?: boolean;
  },
): Promise<string> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => videoToVideo(sourceVideoUrl, prompt, provider, ctx.userId, options),
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
    seed?: number;
    resolution?: string;
    generateAudio?: boolean;
    referenceImageUrls?: string[];
    referenceVideoUrls?: string[];
    referenceAudioUrls?: string[];
    webSearch?: boolean;
    nsfwChecker?: boolean;
    /** VEO 3.x: opt out of KIE's auto-translate-to-English. */
    enableTranslation?: boolean;
  },
  /** Per-call idempotency key — see runImageGeneration for rationale. */
  idempotencyKey?: string,
): Promise<string> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => textToVideo(prompt, provider, ctx.userId, { ...kling3Options, idempotencyKey }),
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
): Promise<string> {
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
): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, { executionStatus: "running" });

  return new Promise<string>((resolve, reject) => {
    generateScriptApi({ prompt, sceneCount, tone, targetDuration, provider, llmModel, userId: ctx.userId })
      .then(({ jobId }) => {
        if (ctx.signal?.aborted) {
          // Run discarded/aborted while the create-job request was in flight.
          // Don't re-attach currentJobId or start polling — that would defeat
          // the discard and paint the result over the existing one. Cancel
          // phase-aware (pre-call cancels+refunds; in-flight finishes → My
          // Library), then bail. `new Promise` → unwind by resolving "",
          // mirroring the shouldAbandonNode abandon-branch below.
          cancelJob(jobId).catch(() => {});
          resolve("");
          return;
        }
        guardedToast.info("Script generation started", {
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
              const job = await getJobStatusLean(jobId);
              pollFailures = 0;
              if (job.status === "completed" || job.status === "failed") {
                if (shouldAbandonNode(nodeId, jobId)) {
                  // Run discarded/replaced — the job still lands in My Library,
                  // but we must not write its result/error onto the canvas.
                  ctx.untrackInterval(poll);
                  resolve("");
                  return;
                }
              }
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
                guardedToast.success("Script generated", {
                  description: script?.title,
                });
                resolve(script?.title || "");
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                guardedToast.error("Script generation failed", {
                  description: errMsg,
                });
                reject(new Error(errMsg));
              }
            } catch (err) {
              pollFailures++;
              if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                ctx.untrackInterval(poll);
                if (shouldAbandonNode(nodeId, jobId)) {
                  // Run discarded/replaced — don't write a failure to the canvas.
                  resolve("");
                  return;
                }
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  currentJobId: undefined,
                });
                guardedToast.error("Failed to check script generation status");
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
          guardedToast.error("Failed to start script generation", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        reject(err);
      });
  });
}

// --- Motion Graphics (Lottie engine — async LLM authoring job) ---

export function runLottiePlanGeneration(
  nodeId: string,
  params: {
    prompt: string;
    fps: number;
    aspectRatio?: string;
    width?: number;
    height?: number;
    durationSeconds: number;
    backgroundColor?: string;
    llmModel?: string;
    previousSids?: string[];
  },
  ctx: ExecutionContext,
): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    executionStatus: "running",
    motionPlan: undefined,
    errorMessage: undefined,
  });

  return new Promise<string>((resolve, reject) => {
    generateMotionGraphics({ ...params, engine: "lottie", userId: ctx.userId! })
      .then(({ jobId }) => {
        if (ctx.signal?.aborted) {
          // Run discarded/aborted while the create-job request was in flight.
          // Don't re-attach currentJobId or start polling — that would defeat
          // the discard and paint the result over the existing one. Cancel
          // phase-aware (pre-call cancels+refunds; in-flight finishes → My
          // Library), then bail. `new Promise` → unwind by resolving "",
          // mirroring the shouldAbandonNode abandon-branch below.
          cancelJob(jobId).catch(() => {});
          resolve("");
          return;
        }
        guardedToast.info("Lottie generation started", {
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
              const job = await getJobStatusLean(jobId);
              pollFailures = 0;
              if (job.status === "completed" || job.status === "failed") {
                if (shouldAbandonNode(nodeId, jobId)) {
                  // Run discarded/replaced — the job still lands in My Library,
                  // but we must not write its result/error onto the canvas.
                  ctx.untrackInterval(poll);
                  resolve("");
                  return;
                }
              }
              if (job.status === "completed") {
                ctx.untrackInterval(poll);
                const motionPlan = job.output_data?.motionPlan as
                  | Record<string, unknown>
                  | undefined;
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  motionPlan,
                  currentJobId: undefined,
                });
                guardedToast.success("Lottie animation generated");
                resolve("plan-ready");
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                guardedToast.error("Lottie generation failed", {
                  description: errMsg,
                });
                reject(new Error(errMsg));
              }
            } catch (err) {
              pollFailures++;
              if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                ctx.untrackInterval(poll);
                if (shouldAbandonNode(nodeId, jobId)) {
                  // Run discarded/replaced — don't write a failure to the canvas.
                  resolve("");
                  return;
                }
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  currentJobId: undefined,
                });
                guardedToast.error("Failed to check Lottie generation status");
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
          guardedToast.error("Failed to start Lottie generation", {
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
  transition: string,
  transitionDuration: number,
  audioMode: "keep" | "crossfade" | "remove",
  ctx: ExecutionContext,
  trimStartFrames?: number,
  trimEndFrames?: number,
  upstreamDurations?: ReadonlyArray<number | undefined>,
  audioCrossfadeCurve?: string,
): Promise<string> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => combineVideos(videoUrls, transition, transitionDuration, audioMode, ctx.userId, trimStartFrames, trimEndFrames, upstreamDurations, audioCrossfadeCurve),
    "generatedVideoUrl",
    "Combine videos",
    ctx,
  );
}
