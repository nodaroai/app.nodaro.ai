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
  GeneratedResult,
  GeneratedScript,
  GeneratedScriptResult,
  GenerateImageData,
  EditImageData,
  ImageToImageData,
  ImageToVideoData,
  VideoToVideoData,
  TextToVideoData,
  TextToSpeechData,
  GenerateScriptData,
  CombineVideosData,
} from "@/types/nodes";
import {
  WorkflowStaleError,
  MAX_CONSECUTIVE_POLL_FAILURES,
  checkStorageError,
  type ExecutionContext,
} from "./types";

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
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    executionStatus: "running",
    generatedImageUrl: undefined,
  });

  return new Promise((resolve, reject) => {
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
    )
      .then(({ jobId }) => {
        toast.info("Image generation started", {
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
                const imageUrl = job.output_data?.imageUrl;
                const existingResults =
                  (
                    useWorkflowStore
                      .getState()
                      .nodes.find((n) => n.id === nodeId)?.data as
                      | GenerateImageData
                      | undefined
                  )?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: imageUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  generatedImageUrl: imageUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                });
                toast.success("Image generated");
                resolve();
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                toast.error("Image generation failed", {
                  description: errMsg,
                });
                reject(new Error(errMsg));
              }
            } catch (err) {
              pollFailures++;
              if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                ctx.untrackInterval(poll);
                const errMsg =
                  err instanceof Error
                    ? err.message
                    : "Failed to check job status";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                toast.error("Failed to check job status");
                reject(err);
              }
            }
          }, 2000),
        );
      })
      .catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        updateNodeData(nodeId, {
          executionStatus: "failed",
          errorMessage: errMsg,
          currentJobId: undefined,
        });
        if (!checkStorageError(err, ctx)) {
          toast.error("Failed to start image generation", {
            description: errMsg,
          });
        }
        reject(err);
      });
  });
}

// --- Edit image ---

export function runEditImage(
  nodeId: string,
  imageUrl: string,
  ctx: ExecutionContext,
  prompt?: string,
  provider?: EditImageData["provider"],
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    executionStatus: "running",
    generatedImageUrl: undefined,
  });

  return new Promise((resolve, reject) => {
    editImage(imageUrl, prompt, provider, ctx.userId)
      .then(({ jobId }) => {
        toast.info("Image editing started", {
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
                const outputUrl = job.output_data?.imageUrl;
                const existingResults =
                  (
                    useWorkflowStore
                      .getState()
                      .nodes.find((n) => n.id === nodeId)?.data as
                      | EditImageData
                      | undefined
                  )?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: outputUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  generatedImageUrl: outputUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                });
                toast.success("Image edited");
                resolve();
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                toast.error("Image editing failed", { description: errMsg });
                reject(new Error(errMsg));
              }
            } catch (err) {
              pollFailures++;
              if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                ctx.untrackInterval(poll);
                const errMsg =
                  err instanceof Error
                    ? err.message
                    : "Failed to check job status";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                toast.error("Failed to check job status");
                reject(err);
              }
            }
          }, 2000),
        );
      })
      .catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        updateNodeData(nodeId, {
          executionStatus: "failed",
          errorMessage: errMsg,
          currentJobId: undefined,
        });
        if (!checkStorageError(err, ctx)) {
          toast.error("Failed to start image editing", {
            description: errMsg,
          });
        }
        reject(err);
      });
  });
}

// --- Image to image ---

export function runImageToImage(
  nodeId: string,
  imageUrl: string,
  prompt: string,
  ctx: ExecutionContext,
  provider?: ImageToImageData["provider"],
  referenceImageUrls?: string[],
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    executionStatus: "running",
    generatedImageUrl: undefined,
  });

  return new Promise((resolve, reject) => {
    imageToImage(imageUrl, prompt, provider, ctx.userId, referenceImageUrls)
      .then(({ jobId }) => {
        toast.info("Image transformation started", {
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
                const outputUrl = job.output_data?.imageUrl;
                const existingResults =
                  (
                    useWorkflowStore
                      .getState()
                      .nodes.find((n) => n.id === nodeId)?.data as
                      | ImageToImageData
                      | undefined
                  )?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: outputUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  generatedImageUrl: outputUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                });
                toast.success("Image transformed");
                resolve();
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                toast.error("Image transformation failed", {
                  description: errMsg,
                });
                reject(new Error(errMsg));
              }
            } catch (err) {
              pollFailures++;
              if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                ctx.untrackInterval(poll);
                const errMsg =
                  err instanceof Error
                    ? err.message
                    : "Failed to check job status";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                toast.error("Failed to check job status");
                reject(err);
              }
            }
          }, 2000),
        );
      })
      .catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        updateNodeData(nodeId, {
          executionStatus: "failed",
          errorMessage: errMsg,
          currentJobId: undefined,
        });
        if (!checkStorageError(err, ctx)) {
          toast.error("Failed to start image transformation", {
            description: errMsg,
          });
        }
        reject(err);
      });
  });
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
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    executionStatus: "running",
    generatedVideoUrl: undefined,
    currentJobId: undefined,
    currentJobProgress: undefined,
  });

  return new Promise((resolve, reject) => {
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
      userId: ctx.userId,
    })
      .then(({ jobId }) => {
        toast.info("Video generation started", {
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
              if (job.progress != null && job.progress > 0) {
                updateNodeData(nodeId, { currentJobProgress: job.progress });
              }
              if (job.status === "completed") {
                ctx.untrackInterval(poll);
                const videoUrl = job.output_data?.videoUrl;
                const existingResults =
                  (
                    useWorkflowStore
                      .getState()
                      .nodes.find((n) => n.id === nodeId)?.data as
                      | ImageToVideoData
                      | undefined
                  )?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: videoUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  generatedVideoUrl: videoUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                toast.success("Video generated");
                resolve();
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                toast.error("Video generation failed", {
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
                  currentJobProgress: undefined,
                });
                toast.error("Failed to check video job status");
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
          currentJobProgress: undefined,
        });
        if (!checkStorageError(err, ctx)) {
          toast.error("Failed to start video generation", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        reject(err);
      });
  });
}

// --- Video to video ---

export function runVideoToVideoGeneration(
  nodeId: string,
  sourceVideoUrl: string,
  ctx: ExecutionContext,
  prompt?: string,
  provider?: string,
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    executionStatus: "running",
    generatedVideoUrl: undefined,
    currentJobId: undefined,
    currentJobProgress: undefined,
  });

  return new Promise((resolve, reject) => {
    videoToVideo(sourceVideoUrl, prompt, provider, ctx.userId)
      .then(({ jobId }) => {
        toast.info("Video-to-video generation started", {
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
              if (job.progress != null && job.progress > 0) {
                updateNodeData(nodeId, { currentJobProgress: job.progress });
              }
              if (job.status === "completed") {
                ctx.untrackInterval(poll);
                const videoUrl = job.output_data?.videoUrl;
                const existingResults =
                  (
                    useWorkflowStore
                      .getState()
                      .nodes.find((n) => n.id === nodeId)?.data as
                      | VideoToVideoData
                      | undefined
                  )?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: videoUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  generatedVideoUrl: videoUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                toast.success("Video-to-video generated");
                resolve();
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                toast.error("Video-to-video generation failed", {
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
                  currentJobProgress: undefined,
                });
                toast.error("Failed to check video-to-video job status");
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
          currentJobProgress: undefined,
        });
        if (!checkStorageError(err, ctx)) {
          toast.error("Failed to start video-to-video generation", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        reject(err);
      });
  });
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
  },
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    executionStatus: "running",
    generatedVideoUrl: undefined,
    currentJobId: undefined,
    currentJobProgress: undefined,
  });

  return new Promise((resolve, reject) => {
    textToVideo(prompt, provider, ctx.userId, kling3Options)
      .then(({ jobId }) => {
        toast.info("Text-to-video generation started", {
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
              if (job.progress != null && job.progress > 0) {
                updateNodeData(nodeId, { currentJobProgress: job.progress });
              }
              if (job.status === "completed") {
                ctx.untrackInterval(poll);
                const videoUrl = job.output_data?.videoUrl;
                const existingResults =
                  (
                    useWorkflowStore
                      .getState()
                      .nodes.find((n) => n.id === nodeId)?.data as
                      | TextToVideoData
                      | undefined
                  )?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: videoUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  generatedVideoUrl: videoUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                toast.success("Text-to-video generated");
                resolve();
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                toast.error("Text-to-video generation failed", {
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
                  currentJobProgress: undefined,
                });
                toast.error("Failed to check text-to-video job status");
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
          currentJobProgress: undefined,
        });
        if (!checkStorageError(err, ctx)) {
          toast.error("Failed to start text-to-video generation", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        reject(err);
      });
  });
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
  },
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, { executionStatus: "running" });

  return new Promise((resolve, reject) => {
    textToSpeech(text, voice, provider, ctx.userId, options)
      .then(({ jobId }) => {
        toast.info("Text-to-speech generation started", {
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
                const audioUrl = job.output_data?.audioUrl;
                const existingResults =
                  (
                    useWorkflowStore
                      .getState()
                      .nodes.find((n) => n.id === nodeId)?.data as
                      | TextToSpeechData
                      | undefined
                  )?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: audioUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  generatedAudioUrl: audioUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                });
                toast.success("Audio generated");
                resolve();
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                toast.error("Text-to-speech generation failed", {
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
                toast.error("Failed to check text-to-speech job status");
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
          toast.error("Failed to start text-to-speech generation", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        reject(err);
      });
  });
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
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, { executionStatus: "running" });

  return new Promise((resolve, reject) => {
    generateScriptApi(prompt, sceneCount, tone, targetDuration, provider, ctx.userId)
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
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, {
    executionStatus: "running",
    generatedVideoUrl: undefined,
  });

  return new Promise((resolve, reject) => {
    combineVideos(videoUrls, transition, transitionDuration, audioMode, ctx.userId)
      .then(({ jobId }) => {
        toast.info("Combine videos started", {
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
                const videoUrl = job.output_data?.videoUrl;
                const existingResults =
                  (
                    useWorkflowStore
                      .getState()
                      .nodes.find((n) => n.id === nodeId)?.data as
                      | CombineVideosData
                      | undefined
                  )?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: videoUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  generatedVideoUrl: videoUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                });
                toast.success("Videos combined");
                resolve();
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                toast.error("Combine videos failed", { description: errMsg });
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
                toast.error("Failed to check combine videos status");
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
          toast.error("Failed to start combine videos", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        reject(err);
      });
  });
}
