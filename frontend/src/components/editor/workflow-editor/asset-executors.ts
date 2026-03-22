import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { createClient } from "@/lib/supabase";
import { resolveTemplate, applyTemplate } from "@/lib/prompt-templates";
import {
  generateCharacter,
  generateCharacterAsset,
  saveCharacter,
  generateFace,
  saveFace,
  generateObject,
  generateObjectAsset,
  saveObject,
  generateLocation,
  generateLocationAsset,
  saveLocation,
  getJobStatus,
} from "@/lib/api";
import type {
  GeneratedResult,
  CharacterNodeData,
  FaceNodeData,
  ObjectNodeData,
  LocationNodeData,
} from "@/types/nodes";
import {
  WorkflowStaleError,
  MAX_CONSECUTIVE_POLL_FAILURES,
  checkStorageError,
  type ExecutionContext,
} from "./types";
import { pollJobToCompletion, guardedToast } from "./poll-job";

// --- Character/Face/Object/Location generation ---

export function runCharacterGeneration(
  nodeId: string,
  data: CharacterNodeData,
  ctx: ExecutionContext,
): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, { executionStatus: "running" });

  return new Promise<string>((resolve, reject) => {
    generateCharacter({
      name: data.characterName,
      description: data.description || undefined,
      gender: data.gender || undefined,
      style: data.style || undefined,
      baseOutfit: data.baseOutfit || undefined,
      sourceImageUrl: data.sourceImageUrl || undefined,
      provider: data.provider,
      userId: ctx.userId,
    })
      .then(({ jobId }) => {
        guardedToast.info("Character generation started", {
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
                const currentNode = useWorkflowStore
                  .getState()
                  .nodes.find((n) => n.id === nodeId);
                const currentData = currentNode?.data as
                  | CharacterNodeData
                  | undefined;
                const existingResults = currentData?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: imageUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  sourceImageUrl: imageUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                });
                guardedToast.success("Character portrait generated");

                const supabase = createClient();
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                saveCharacter({
                  id: currentData?.characterDbId || undefined,
                  userId: user?.id,
                  nodeId,
                  projectId: ctx.projectId || undefined,
                  name: data.characterName,
                  description: data.description || undefined,
                  gender: data.gender || undefined,
                  style: data.style || undefined,
                  baseOutfit: data.baseOutfit || undefined,
                  sourceImageUrl: imageUrl || undefined,
                  expressions: currentData?.expressions ?? [],
                  poses: currentData?.poses ?? [],
                  lightingVariations: currentData?.lightingVariations ?? [],
                })
                  .then(({ id: dbId }) => {
                    if (!currentData?.characterDbId) {
                      updateNodeData(nodeId, { characterDbId: dbId });
                    }
                  })
                  .catch(() => {});

                resolve((imageUrl as string) ?? "");
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                guardedToast.error("Character generation failed", {
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
                guardedToast.error("Failed to check job status");
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
          guardedToast.error("Failed to start character generation", {
            description: errMsg,
          });
        }
        reject(err);
      });
  });
}

export function runFaceGeneration(
  nodeId: string,
  data: FaceNodeData,
  ctx: ExecutionContext,
): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, { executionStatus: "running" });

  const faceUserTemplates = useWorkflowStore.getState().userPromptTemplates;
  const faceFlowTemplates = useWorkflowStore.getState().flowPromptTemplates;
  const faceTemplate = resolveTemplate(
    "face-generation",
    faceUserTemplates,
    faceFlowTemplates,
  );
  const faceDescParts = [data.faceName, data.description]
    .filter(Boolean)
    .join(", ");
  const facePrompt = applyTemplate(faceTemplate, {
    description: faceDescParts,
    style: data.style || "realistic",
  });

  return new Promise<string>((resolve, reject) => {
    generateFace({
      name: data.faceName,
      description: data.description || undefined,
      style: data.style || undefined,
      prompt: facePrompt,
      sourceImageUrl: data.sourceImageUrl || undefined,
      provider: data.provider,
      userId: ctx.userId,
    })
      .then(({ jobId }) => {
        guardedToast.info("Face headshot generation started", {
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
                const currentNode = useWorkflowStore
                  .getState()
                  .nodes.find((n) => n.id === nodeId);
                const currentData = currentNode?.data as
                  | FaceNodeData
                  | undefined;
                const existingResults = currentData?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: imageUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  sourceImageUrl: data.sourceImageUrl || imageUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                });
                guardedToast.success("Face headshot generated");

                const supabase = createClient();
                const {
                  data: { user: faceUser },
                } = await supabase.auth.getUser();
                saveFace({
                  id: currentData?.faceDbId || undefined,
                  userId: faceUser?.id,
                  nodeId,
                  projectId: ctx.projectId || undefined,
                  name: data.faceName,
                  description: data.description || undefined,
                  style: data.style || undefined,
                  sourceImageUrl: imageUrl || undefined,
                })
                  .then(({ id: dbId }) => {
                    if (!currentData?.faceDbId) {
                      updateNodeData(nodeId, { faceDbId: dbId });
                    }
                  })
                  .catch(() => {});

                resolve((imageUrl as string) ?? "");
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                guardedToast.error("Face headshot generation failed", {
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
                guardedToast.error("Failed to check job status");
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
          guardedToast.error("Failed to start face headshot generation", {
            description: errMsg,
          });
        }
        reject(err);
      });
  });
}

export function runObjectGeneration(
  nodeId: string,
  data: ObjectNodeData,
  ctx: ExecutionContext,
): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, { executionStatus: "running" });

  return new Promise<string>((resolve, reject) => {
    generateObject({
      name: data.objectName,
      description: data.description || undefined,
      category: data.category || undefined,
      style: data.style || undefined,
      sourceImageUrl: data.sourceImageUrl || undefined,
      provider: data.provider,
      userId: ctx.userId,
    })
      .then(({ jobId }) => {
        guardedToast.info("Object generation started", {
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
                const currentNode = useWorkflowStore
                  .getState()
                  .nodes.find((n) => n.id === nodeId);
                const currentData = currentNode?.data as
                  | ObjectNodeData
                  | undefined;
                const existingResults = currentData?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: imageUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  sourceImageUrl: imageUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                });
                guardedToast.success("Object image generated");

                const supabaseObj = createClient();
                const {
                  data: { user: objUser },
                } = await supabaseObj.auth.getUser();
                saveObject({
                  id: currentData?.objectDbId || undefined,
                  userId: objUser?.id,
                  nodeId,
                  projectId: ctx.projectId || undefined,
                  name: data.objectName,
                  description: data.description || undefined,
                  category: data.category || undefined,
                  style: data.style || undefined,
                  sourceImageUrl: imageUrl || undefined,
                  angles: currentData?.angles ?? [],
                  materials: currentData?.materials ?? [],
                  variations: currentData?.variations ?? [],
                })
                  .then(({ id: dbId }) => {
                    if (!currentData?.objectDbId) {
                      updateNodeData(nodeId, { objectDbId: dbId });
                    }
                  })
                  .catch(() => {});

                resolve((imageUrl as string) ?? "");
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                guardedToast.error("Object generation failed", {
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
                guardedToast.error("Failed to check job status");
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
          guardedToast.error("Failed to start object generation", {
            description: errMsg,
          });
        }
        reject(err);
      });
  });
}

export function runLocationGeneration(
  nodeId: string,
  data: LocationNodeData,
  ctx: ExecutionContext,
): Promise<string> {
  const { updateNodeData } = useWorkflowStore.getState();
  updateNodeData(nodeId, { executionStatus: "running" });

  return new Promise<string>((resolve, reject) => {
    generateLocation({
      name: data.locationName,
      description: data.description || undefined,
      category: data.category || undefined,
      style: data.style || undefined,
      sourceImageUrl: data.sourceImageUrl || undefined,
      provider: data.provider,
      userId: ctx.userId,
    })
      .then(({ jobId }) => {
        guardedToast.info("Location generation started", {
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
                const currentNode = useWorkflowStore
                  .getState()
                  .nodes.find((n) => n.id === nodeId);
                const currentData = currentNode?.data as
                  | LocationNodeData
                  | undefined;
                const existingResults = currentData?.generatedResults ?? [];
                const newResult: GeneratedResult = {
                  url: imageUrl ?? "",
                  timestamp: new Date().toISOString(),
                  jobId,
                };
                updateNodeData(nodeId, {
                  executionStatus: "completed",
                  sourceImageUrl: imageUrl,
                  generatedResults: [newResult, ...existingResults],
                  activeResultIndex: 0,
                  currentJobId: undefined,
                });
                guardedToast.success("Location image generated");

                const supabaseLoc = createClient();
                const {
                  data: { user: locUser },
                } = await supabaseLoc.auth.getUser();
                saveLocation({
                  id: currentData?.locationDbId || undefined,
                  userId: locUser?.id,
                  nodeId,
                  projectId: ctx.projectId || undefined,
                  name: data.locationName,
                  description: data.description || undefined,
                  category: data.category || undefined,
                  style: data.style || undefined,
                  sourceImageUrl: imageUrl || undefined,
                  timeOfDay: currentData?.timeOfDay ?? [],
                  weather: currentData?.weather ?? [],
                  angles: currentData?.angles ?? [],
                })
                  .then(({ id: dbId }) => {
                    if (!currentData?.locationDbId) {
                      updateNodeData(nodeId, { locationDbId: dbId });
                    }
                  })
                  .catch(() => {});

                resolve((imageUrl as string) ?? "");
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll);
                const errMsg = job.error_message ?? "Unknown error";
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: errMsg,
                  currentJobId: undefined,
                });
                guardedToast.error("Location generation failed", {
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
                guardedToast.error("Failed to check job status");
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
          guardedToast.error("Failed to start location generation", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
        }
        reject(err);
      });
  });
}

// --- Asset variant generation ---

const ASSET_VARIANTS: Record<string, { variants: string[]; names: string[] }> =
  {
    expressions: {
      variants: ["neutral", "smile", "angry", "surprised", "sad", "talking"],
      names: ["Neutral", "Smile", "Angry", "Surprised", "Sad", "Talking"],
    },
    poses: {
      variants: ["standing", "walking", "sitting", "running"],
      names: ["Standing", "Walking", "Sitting", "Running"],
    },
    lighting: {
      variants: ["daylight", "night", "dramatic"],
      names: ["Daylight", "Night", "Dramatic"],
    },
    angles: {
      variants: ["front", "side", "back"],
      names: ["Front View", "Side View", "Back View"],
    },
  };

const OBJECT_ASSET_VARIANTS: Record<
  string,
  { variants: string[]; names: string[] }
> = {
  angles: {
    variants: ["front", "side", "top", "back", "three-quarter"],
    names: ["Front", "Side", "Top", "Back", "Three-Quarter"],
  },
  materials: {
    variants: ["wood", "metal", "glass", "plastic", "fabric", "stone"],
    names: ["Wood", "Metal", "Glass", "Plastic", "Fabric", "Stone"],
  },
  variations: {
    variants: ["clean", "weathered", "damaged", "ornate", "minimal"],
    names: ["Clean", "Weathered", "Damaged", "Ornate", "Minimal"],
  },
};

const LOCATION_ASSET_VARIANTS: Record<
  string,
  { variants: string[]; names: string[] }
> = {
  timeOfDay: {
    variants: ["dawn", "morning", "noon", "afternoon", "dusk", "night"],
    names: ["Dawn", "Morning", "Noon", "Afternoon", "Dusk", "Night"],
  },
  weather: {
    variants: ["clear", "cloudy", "rain", "storm", "snow", "fog"],
    names: ["Clear", "Cloudy", "Rain", "Storm", "Snow", "Fog"],
  },
  angles: {
    variants: ["wide", "medium", "closeup", "aerial", "low-angle"],
    names: ["Wide", "Medium", "Close-up", "Aerial", "Low Angle"],
  },
};

export async function handleGenerateCharacterAsset(
  nodeId: string,
  assetType: "expressions" | "poses" | "lighting" | "angles",
  ctx: ExecutionContext,
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const data = node.data as CharacterNodeData;
  if (!data.characterName) {
    toast.error("Set a character name first");
    return;
  }
  const activeResult = (data.generatedResults ?? [])[
    data.activeResultIndex ?? 0
  ];
  const portraitUrl = activeResult?.url ?? data.sourceImageUrl;
  if (!portraitUrl) {
    toast.error("Generate or upload a main portrait first");
    return;
  }

  const statusKeyMap: Record<string, string> = {
    expressions: "expressionStatus",
    poses: "poseStatus",
    lighting: "lightingStatus",
    angles: "anglesStatus",
  };
  const itemsKeyMap: Record<string, string> = {
    expressions: "expressions",
    poses: "poses",
    lighting: "lightingVariations",
    angles: "angles",
  };
  const statusKey = statusKeyMap[assetType];
  const itemsKey = itemsKeyMap[assetType];

  const config = ASSET_VARIANTS[assetType];
  if (!config) return;

  updateNodeData(nodeId, { [statusKey]: "running" });

  const results: Array<{ name: string; url: string }> = [];

  try {
    for (let i = 0; i < config.variants.length; i++) {
      const variant = config.variants[i];
      const variantName = config.names[i];
      guardedToast.info(
        `Generating ${assetType}... ${i + 1}/${config.variants.length} (${variantName})`,
      );

      const { jobId } = await generateCharacterAsset({
        assetType,
        variant,
        name: data.characterName,
        description: data.description || undefined,
        gender: data.gender || undefined,
        style: data.style || undefined,
        baseOutfit: data.baseOutfit || undefined,
        sourceImageUrl: portraitUrl,
        provider: data.provider,
        userId: ctx.userId,
      });

      const imageUrl = await pollJobToCompletion(jobId, ctx);
      results.push({ name: variantName, url: imageUrl });

      updateNodeData(nodeId, { [itemsKey]: [...results] });
    }

    updateNodeData(nodeId, { [statusKey]: "completed" });
    guardedToast.success(`${assetType} generated: ${results.length} images`);

    const latestNode = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === nodeId);
    const latestData = latestNode?.data as CharacterNodeData | undefined;
    if (latestData?.characterDbId) {
      const supabaseSync = createClient();
      supabaseSync.auth
        .getUser()
        .then(
          ({
            data: { user: syncUser },
          }: {
            data: { user: { id: string } | null };
          }) => {
            saveCharacter({
              id: latestData.characterDbId,
              userId: syncUser?.id,
              nodeId,
              projectId: ctx.projectId || undefined,
              name: latestData.characterName,
              sourceImageUrl: latestData.sourceImageUrl || undefined,
              expressions: latestData.expressions ?? [],
              poses: latestData.poses ?? [],
              lightingVariations: latestData.lightingVariations ?? [],
            }).catch(() => {});
          },
        );
    }
  } catch (err) {
    if (err instanceof WorkflowStaleError) return;
    updateNodeData(nodeId, { [statusKey]: "failed" });
    guardedToast.error(
      `Failed to generate ${assetType} (${results.length}/${config.variants.length} completed)`,
      {
        description: err instanceof Error ? err.message : "Unknown error",
      },
    );
  }
}

export async function handleGenerateObjectAsset(
  nodeId: string,
  assetType: "angles" | "materials" | "variations",
  ctx: ExecutionContext,
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const data = node.data as ObjectNodeData;
  if (!data.objectName) {
    toast.error("Set an object name first");
    return;
  }
  const activeResult = (data.generatedResults ?? [])[
    data.activeResultIndex ?? 0
  ];
  const imageUrl = activeResult?.url ?? data.sourceImageUrl;
  if (!imageUrl) {
    toast.error("Generate or upload a main image first");
    return;
  }

  const statusKeyMap: Record<string, string> = {
    angles: "anglesStatus",
    materials: "materialsStatus",
    variations: "variationsStatus",
  };
  const itemsKeyMap: Record<string, string> = {
    angles: "angles",
    materials: "materials",
    variations: "variations",
  };
  const statusKey = statusKeyMap[assetType];
  const itemsKey = itemsKeyMap[assetType];

  const config = OBJECT_ASSET_VARIANTS[assetType];
  if (!config) return;

  updateNodeData(nodeId, { [statusKey]: "running" });

  const results: Array<{ name: string; url: string }> = [];

  try {
    for (let i = 0; i < config.variants.length; i++) {
      const variant = config.variants[i];
      const variantName = config.names[i];
      guardedToast.info(
        `Generating ${assetType}... ${i + 1}/${config.variants.length} (${variantName})`,
      );

      const { jobId } = await generateObjectAsset({
        assetType,
        variant,
        name: data.objectName,
        description: data.description || undefined,
        category: data.category || undefined,
        style: data.style || undefined,
        sourceImageUrl: imageUrl,
        provider: data.provider,
        userId: ctx.userId,
      });

      const resultUrl = await pollJobToCompletion(jobId, ctx);
      results.push({ name: variantName, url: resultUrl });

      updateNodeData(nodeId, { [itemsKey]: [...results] });
    }

    updateNodeData(nodeId, { [statusKey]: "completed" });
    guardedToast.success(`${assetType} generated: ${results.length} images`);

    const latestNode = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === nodeId);
    const latestData = latestNode?.data as ObjectNodeData | undefined;
    if (latestData?.objectDbId) {
      const supabaseObjSync = createClient();
      supabaseObjSync.auth
        .getUser()
        .then(
          ({
            data: { user: objSyncUser },
          }: {
            data: { user: { id: string } | null };
          }) => {
            saveObject({
              id: latestData.objectDbId,
              userId: objSyncUser?.id,
              nodeId,
              projectId: ctx.projectId || undefined,
              name: latestData.objectName,
              sourceImageUrl: latestData.sourceImageUrl || undefined,
              angles: latestData.angles ?? [],
              materials: latestData.materials ?? [],
              variations: latestData.variations ?? [],
            }).catch(() => {});
          },
        );
    }
  } catch (err) {
    if (err instanceof WorkflowStaleError) return;
    updateNodeData(nodeId, { [statusKey]: "failed" });
    guardedToast.error(
      `Failed to generate ${assetType} (${results.length}/${config.variants.length} completed)`,
      {
        description: err instanceof Error ? err.message : "Unknown error",
      },
    );
  }
}

export async function handleGenerateLocationAsset(
  nodeId: string,
  assetType: "timeOfDay" | "weather" | "angles",
  ctx: ExecutionContext,
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const data = node.data as LocationNodeData;
  if (!data.locationName) {
    toast.error("Set a location name first");
    return;
  }
  const activeResult = (data.generatedResults ?? [])[
    data.activeResultIndex ?? 0
  ];
  const imageUrl = activeResult?.url ?? data.sourceImageUrl;
  if (!imageUrl) {
    toast.error("Generate or upload a main image first");
    return;
  }

  const statusKeyMap: Record<string, string> = {
    timeOfDay: "timeOfDayStatus",
    weather: "weatherStatus",
    angles: "anglesStatus",
  };
  const itemsKeyMap: Record<string, string> = {
    timeOfDay: "timeOfDay",
    weather: "weather",
    angles: "angles",
  };
  const statusKey = statusKeyMap[assetType];
  const itemsKey = itemsKeyMap[assetType];

  const config = LOCATION_ASSET_VARIANTS[assetType];
  if (!config) return;

  updateNodeData(nodeId, { [statusKey]: "running" });

  const results: Array<{ name: string; url: string }> = [];

  try {
    for (let i = 0; i < config.variants.length; i++) {
      const variant = config.variants[i];
      const variantName = config.names[i];
      guardedToast.info(
        `Generating ${assetType}... ${i + 1}/${config.variants.length} (${variantName})`,
      );

      const { jobId } = await generateLocationAsset({
        assetType,
        variant,
        name: data.locationName,
        description: data.description || undefined,
        category: data.category || undefined,
        style: data.style || undefined,
        sourceImageUrl: imageUrl,
        provider: data.provider,
        userId: ctx.userId,
      });

      const resultUrl = await pollJobToCompletion(jobId, ctx);
      results.push({ name: variantName, url: resultUrl });

      updateNodeData(nodeId, { [itemsKey]: [...results] });
    }

    updateNodeData(nodeId, { [statusKey]: "completed" });
    guardedToast.success(`${assetType} generated: ${results.length} images`);

    const latestNode = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === nodeId);
    const latestData = latestNode?.data as LocationNodeData | undefined;
    if (latestData?.locationDbId) {
      const supabaseLocSync = createClient();
      supabaseLocSync.auth
        .getUser()
        .then(
          ({
            data: { user: locSyncUser },
          }: {
            data: { user: { id: string } | null };
          }) => {
            saveLocation({
              id: latestData.locationDbId,
              userId: locSyncUser?.id,
              nodeId,
              projectId: ctx.projectId || undefined,
              name: latestData.locationName,
              sourceImageUrl: latestData.sourceImageUrl || undefined,
              timeOfDay: latestData.timeOfDay ?? [],
              weather: latestData.weather ?? [],
              angles: latestData.angles ?? [],
            }).catch(() => {});
          },
        );
    }
  } catch (err) {
    if (err instanceof WorkflowStaleError) return;
    updateNodeData(nodeId, { [statusKey]: "failed" });
    guardedToast.error(
      `Failed to generate ${assetType} (${results.length}/${config.variants.length} completed)`,
      {
        description: err instanceof Error ? err.message : "Unknown error",
      },
    );
  }
}
