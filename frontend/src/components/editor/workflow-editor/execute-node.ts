import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import {
  generateMusicApi,
  textToAudioApi,
  audioIsolationApi,
  textToDialogueApi,
  sunoGenerateApi,
  sunoCoverApi,
  sunoExtendApi,
  sunoLyricsApi,
  sunoSeparateApi,
  sunoMusicVideoApi,
  transcribeApi,
  imageToTextApi,
  voiceChangerApi,
  dubbingApi,
  voiceRemixApi,
  voiceDesignApi,
  forcedAlignmentApi,
  downloadYouTubeAudio,
  lipSyncApi,
  motionTransferApi,
  videoUpscaleApi,
  extendVideo,
  generateSceneGraph,
  renderVideoWithSceneGraph,
  renderVideoWithPlan,
  generateAfterEffects,
  generateLottieOverlay,
  generate3DTitle,
  generateMotionGraphics,
  mergeVideoAudioApi,
  extractAudioApi,
  trimVideoApi,
  transcodeVideoApi,
  speedRampApi,
  loopVideoApi,
  fadeVideoApi,
  resizeVideoApi,
  socialMediaFormatApi,
  adjustVolumeApi,
  addCaptionsApi,
  mixAudioApi,
  generateImage,
  getJobStatus,
  generateAIWriterStream,
} from "@/lib/api";
import { resolveTemplate, applyTemplate } from "@/lib/prompt-templates";
import { getAIWriterTemplate } from "@/lib/ai-writer-templates";
import { buildScenePrompt } from "@/lib/prompt-builder";
import type {
  WorkflowNode,
  GenerateScriptData,
  GenerateImageData,
  EditImageData,
  ImageToImageData,
  ImageToVideoData,
  VideoToVideoData,
  TextToVideoData,
  TextToSpeechData,
  GenerateMusicData,
  TextToAudioData,
  AudioIsolationData,
  TextToDialogueData,
  SunoGenerateData,
  SunoCoverData,
  SunoExtendData,
  SunoLyricsData,
  SunoSeparateData,
  SunoMusicVideoData,
  TranscribeData,
  ImageToTextData,
  AIWriterNodeData,
  LipSyncData,
  MotionTransferData,
  VideoUpscaleData,
  ExtendVideoData,
  VideoComposerData,
  AfterEffectsData,
  LottieOverlayData,
  ThreeDTitleData,
  MotionGraphicsData,
  CompositeData,
  RenderVideoData,
  CombineVideosData,
  MergeVideoAudioData,
  ExtractAudioData,
  TrimVideoData,
  TranscodeVideoData,
  ManualEditData,
  SpeedRampData,
  LoopVideoData,
  FadeVideoData,
  ResizeVideoData,
  AdjustVolumeData,
  AddCaptionsData,
  MixAudioData,
  CharacterNodeData,
  FaceNodeData,
  ObjectNodeData,
  LocationNodeData,
  SceneNodeDataType,
  CombineTextNodeData,
  SplitTextData,
  VoiceChangerData,
  DubbingData,
  VoiceRemixData,
  VoiceDesignData,
  ForcedAlignmentData,
  SubWorkflowData,
  SocialMediaFormatData,
  SocialPostData,
} from "@/types/nodes";
import {
  WorkflowStaleError,
  MAX_CONSECUTIVE_POLL_FAILURES,
  checkStorageError,
  type ExecutionContext,
} from "./types";
import { PLATFORM_SPECS } from "@/lib/social-media-specs";
import { extractNodeOutput, collectMediaAssets, buildAutoComposition, collectAncestorRefs } from "./execution-graph";
import { resolveNodeInputs } from "./node-input-resolver";
import { buildNodeRefMap, resolveTextRefs } from "@/lib/node-refs";
import { pollJobWithNodeUpdate } from "./poll-job";
import {
  runImageGeneration,
  runEditImage,
  runImageToImage,
  runVideoGeneration,
  runVideoToVideoGeneration,
  runTextToVideoGeneration,
  runTextToSpeechGeneration,
  runScriptGeneration,
  runCombineVideos,
} from "./node-executors";
import {
  runCharacterGeneration,
  runFaceGeneration,
  runObjectGeneration,
  runLocationGeneration,
} from "./asset-executors";
import { buildImagePrompt } from "@nodaro-shared/prompt-builder";
import type { CharacterDef } from "@nodaro-shared/types";
import { applyMediaOrder } from "../config-panels/connected-media-list";

// ---------------------------------------------------------------------------
// Manual-edit pending promise bridge
// ---------------------------------------------------------------------------
const pendingManualEdits = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();

export function resolveManualEdit(nodeId: string): void {
  const pending = pendingManualEdits.get(nodeId);
  if (pending) { pending.resolve(); pendingManualEdits.delete(nodeId); }
}

export function rejectManualEdit(nodeId: string, error: Error): void {
  const pending = pendingManualEdits.get(nodeId);
  if (pending) { pending.reject(error); pendingManualEdits.delete(nodeId); }
}

export function rejectAllManualEdits(): void {
  for (const [, pending] of pendingManualEdits) {
    pending.reject(new Error("Workflow restarted"));
  }
  pendingManualEdits.clear();
}

/**
 * Resolve kieTaskId from node data or by walking upstream edges.
 * Used by extend-video and video-upscale (VEO) nodes.
 */
function resolveUpstreamKieTaskId(nodeId: string, nodeData: Record<string, unknown>): string | undefined {
  if (nodeData.kieTaskId) return nodeData.kieTaskId as string;
  const { nodes: allNodes, edges: allEdges } = useWorkflowStore.getState();
  const incomingEdges = allEdges.filter((e) => e.target === nodeId);
  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source);
    if (srcNode) {
      const srcData = srcNode.data as Record<string, unknown>;
      if (srcData.kieTaskId) return srcData.kieTaskId as string;
    }
  }
  return undefined;
}

/**
 * Alias for pollJobWithNodeUpdate to match original codebase naming.
 * Used for node types that follow the standard poll-to-completion pattern.
 */
function runProcessingNode(
  nodeId: string,
  apiCall: () => Promise<{ jobId: string }>,
  outputKey: "generatedVideoUrl" | "generatedAudioUrl",
  label: string,
  ctx: ExecutionContext,
  extraOutputFields?: (
    outputData: Record<string, unknown>,
  ) => Record<string, unknown>,
): Promise<void> {
  return pollJobWithNodeUpdate(nodeId, apiCall, outputKey, label, ctx, extraOutputFields);
}

/**
 * Main node execution dispatch. Routes each node type to its executor.
 * Accepts optional overrides for list execution chaining.
 */
export function executeNode(
  node: WorkflowNode,
  ctx: ExecutionContext,
  overridePrompt?: string,
  overrideMediaUrl?: string,
): Promise<void> {
  const { nodes, edges } = useWorkflowStore.getState();
  const inputs = resolveNodeInputs(node, nodes, edges);

  // Build label→output map for resolving {Node Label} references in text fields
  const refMap = buildNodeRefMap(node.id, nodes, edges);
  // Resolve refs in upstream-provided prompt so downstream code sees clean text
  if (inputs.prompt && refMap.size > 0) {
    inputs.prompt = resolveTextRefs(inputs.prompt, refMap) ?? inputs.prompt;
  }

  if (node.type === "generate-script") {
    const prompt = overridePrompt ?? inputs.prompt ?? "";
    if (!prompt) {
      toast.error(
        `Node "${(node.data as GenerateScriptData).label}": no prompt found`,
      );
      return Promise.reject(new Error("No prompt"));
    }
    const scriptData = node.data as GenerateScriptData;
    return runScriptGeneration(
      node.id,
      prompt,
      ctx,
      scriptData.sceneCount,
      scriptData.tone || undefined,
      scriptData.targetLength || undefined,
      scriptData.provider || undefined,
    );
  }

  if (node.type === "generate-image") {
    const imgData = node.data as GenerateImageData;
    const providerKey = imgData.provider || "nano-banana";

    // Build a map of all available reference images by ID
    const refUrlMap = new Map<string, string>();

    // Manual uploads (new multi-image format)
    for (const img of imgData.referenceImageUrls ?? []) {
      refUrlMap.set(img.id, img.url);
    }
    // Legacy single referenceImageUrl
    if (imgData.referenceImageUrl && refUrlMap.size === 0) {
      refUrlMap.set("__legacy__", imgData.referenceImageUrl);
    }
    // Wired upstream images
    const chainRefs =
      inputs.referenceImageUrls ??
      (inputs.imageUrl ? [inputs.imageUrl] : undefined);
    if (chainRefs) {
      const incomingEdges = edges.filter((e) => e.target === node.id);
      const imageSourceTypes = new Set(["upload-image", "generate-image", "edit-image", "image-to-image"]);
      const wiredSourceIds = incomingEdges
        .map((e) => nodes.find((n) => n.id === e.source))
        .filter((n) => n && imageSourceTypes.has(n.type!))
        .map((n) => n!.id);
      for (let i = 0; i < chainRefs.length; i++) {
        const key = wiredSourceIds[i] ?? `wired_${i}`;
        refUrlMap.set(key, chainRefs[i]);
      }
    }
    const extractedRefs = (node.data as Record<string, unknown>)
      .extractedReferenceUrls as string[] | undefined;
    if (extractedRefs) {
      for (let i = 0; i < extractedRefs.length; i++) {
        refUrlMap.set(`extracted_${i}`, extractedRefs[i]);
      }
    }
    // Character reference images
    const charIds = imgData.characterDefinitionIds ?? [];
    const allCharDefs = useWorkflowStore.getState().characterDefinitions;
    const charDefs = allCharDefs.filter((c) => charIds.includes(c.id));
    for (const c of charDefs) {
      if (c.type === "reference" && c.referenceImageUrl) {
        refUrlMap.set(`char_${c.id}`, c.referenceImageUrl);
      }
    }

    // Apply ordering: use referenceImageOrder if set, otherwise default map order
    const orderIds = imgData.referenceImageOrder ?? [];
    const orderedUrls: string[] = [];
    const seen = new Set<string>();
    for (const id of orderIds) {
      const url = refUrlMap.get(id);
      if (url) {
        orderedUrls.push(url);
        seen.add(id);
      }
    }
    for (const [id, url] of refUrlMap) {
      if (!seen.has(id)) orderedUrls.push(url);
    }

    const ancestorRefs = orderedUrls.length === 0
      ? collectAncestorRefs(node.id, nodes, edges)
      : [];

    const prompt = overridePrompt || inputs.prompt || resolveTextRefs(imgData.prompt?.trim(), refMap);
    if (!prompt) {
      toast.error(`Node "${imgData.label}": no prompt found`);
      return Promise.reject(new Error("No prompt"));
    }

    const result = buildImagePrompt({
      prompt,
      provider: providerKey,
      style: imgData.style,
      negativePrompt: imgData.negativePrompt,
      characterDefs: charDefs as CharacterDef[],
      userTemplates: useWorkflowStore.getState().userPromptTemplates,
      flowTemplates: useWorkflowStore.getState().flowPromptTemplates,
      referenceImageUrls: orderedUrls,
      ancestorRefs,
    });

    return runImageGeneration(
      node.id,
      result.prompt,
      ctx,
      result.referenceImageUrls,
      imgData.provider || undefined,
      imgData.aspectRatio || undefined,
      imgData.resolution || undefined,
      imgData.quality || undefined,
      result.nativeNegativePrompt,
      imgData.seed,
      imgData.renderingSpeed || undefined,
    );
  }

  if (node.type === "edit-image") {
    const editData = node.data as EditImageData;

    // Apply connectedMediaOrder to determine main image vs references
    let orderedImageUrls: string[] = inputs.referenceImageUrls ?? [];
    if (editData.connectedMediaOrder?.length && orderedImageUrls.length > 1) {
      const imageSourceNodes = edges
        .filter((e) => e.target === node.id)
        .map((e) => nodes.find((n) => n.id === e.source))
        .filter(Boolean) as WorkflowNode[];
      const idToUrl = new Map<string, string>();
      for (const src of imageSourceNodes) {
        const url = extractNodeOutput(src);
        if (url) idToUrl.set(src.id, url);
      }
      const reordered = applyMediaOrder(
        imageSourceNodes.map((n) => ({ id: n.id })),
        editData.connectedMediaOrder,
      );
      orderedImageUrls = reordered
        .map((e) => idToUrl.get(e.id))
        .filter((u): u is string => !!u);
    }

    const imageUrl =
      overrideMediaUrl ?? orderedImageUrls[0] ?? inputs.imageUrl;
    if (!imageUrl) {
      toast.error(
        `Node "${(node.data as EditImageData).label}": no input image found`,
      );
      return Promise.reject(new Error("No input image"));
    }
    const provider = editData.provider || "recraft-upscale";

    // For nano-banana-edit: enrich prompt with character/asset descriptions
    let prompt = editData.prompt || undefined;
    if (provider === "nano-banana-edit" && prompt) {
      const charIds = editData.characterDefinitionIds ?? [];
      const allCharDefs = useWorkflowStore.getState().characterDefinitions;
      const charDefs = allCharDefs.filter((c) => charIds.includes(c.id));
      if (charDefs.length > 0) {
        const descriptions = charDefs
          .map((c) => c.description ? `${c.name}: ${c.description}` : c.name)
          .join("; ");
        prompt = `${prompt}\n\nContext: ${descriptions}`;
      }
    }

    // Collect reference images for nano-banana-edit
    const editRefUrls = orderedImageUrls.filter((url) => url !== imageUrl);

    return runEditImage(node.id, imageUrl, ctx, prompt, provider, {
      upscaleFactor: editData.upscaleFactor,
      aspectRatio: editData.aspectRatio,
      negativePrompt: editData.negativePrompt,
      style: editData.style,
      seed: editData.seed,
      referenceImageUrls: editRefUrls.length > 0 ? editRefUrls : undefined,
    });
  }

  if (node.type === "image-to-image") {
    const i2iData = node.data as ImageToImageData;

    // Apply connectedMediaOrder to determine main image vs references
    let orderedImageUrls: string[] = inputs.referenceImageUrls ?? [];
    if (i2iData.connectedMediaOrder?.length && orderedImageUrls.length > 1) {
      // Build node-id-to-url mapping from connected image sources
      const imageSourceNodes = edges
        .filter((e) => e.target === node.id)
        .map((e) => nodes.find((n) => n.id === e.source))
        .filter(Boolean) as WorkflowNode[];
      const idToUrl = new Map<string, string>();
      for (const src of imageSourceNodes) {
        const url = extractNodeOutput(src);
        if (url) idToUrl.set(src.id, url);
      }
      const reordered = applyMediaOrder(
        imageSourceNodes.map((n) => ({ id: n.id })),
        i2iData.connectedMediaOrder,
      );
      orderedImageUrls = reordered
        .map((e) => idToUrl.get(e.id))
        .filter((u): u is string => !!u);
    }

    const imageUrl =
      overrideMediaUrl ?? orderedImageUrls[0] ?? inputs.imageUrl;
    if (!imageUrl) {
      toast.error(
        `Node "${(node.data as ImageToImageData).label}": no input image found`,
      );
      return Promise.reject(new Error("No input image"));
    }
    const rawPrompt = i2iData.prompt;
    if (!rawPrompt) {
      toast.error(
        `Node "${i2iData.label}": transformation prompt is required`,
      );
      return Promise.reject(new Error("Transformation prompt is required"));
    }
    const provider = i2iData.provider || "nano-banana";

    // Collect reference images from connected nodes + character assets
    const chainRefs = orderedImageUrls.filter((url) => url !== imageUrl);
    const charIds = i2iData.characterDefinitionIds ?? [];
    const allCharDefs = useWorkflowStore.getState().characterDefinitions;
    const charDefs = allCharDefs.filter((c) => charIds.includes(c.id));
    const charRefUrls = charDefs
      .filter((c) => c.type === "reference" && c.referenceImageUrl)
      .map((c) => c.referenceImageUrl as string);
    const nodeRefUrl = i2iData.referenceImageUrl;
    const directRefs = [
      ...(nodeRefUrl ? [nodeRefUrl] : []),
      ...chainRefs,
      ...charRefUrls,
    ];

    // Build prompt with style + character descriptions (same as generate-image)
    const result = buildImagePrompt({
      prompt: rawPrompt,
      provider,
      style: i2iData.style,
      negativePrompt: i2iData.negativePrompt,
      characterDefs: charDefs as CharacterDef[],
      userTemplates: useWorkflowStore.getState().userPromptTemplates,
      flowTemplates: useWorkflowStore.getState().flowPromptTemplates,
      referenceImageUrls: directRefs,
      ancestorRefs: [],
    });

    return runImageToImage(
      node.id,
      imageUrl,
      result.prompt,
      ctx,
      provider,
      result.referenceImageUrls?.length ? result.referenceImageUrls : undefined,
      {
        strength: i2iData.strength,
        aspectRatio: i2iData.aspectRatio,
        resolution: i2iData.resolution,
        quality: i2iData.quality,
        negativePrompt: result.nativeNegativePrompt,
        seed: i2iData.seed,
        renderingSpeed: i2iData.renderingSpeed,
        guidanceScale: i2iData.guidanceScale,
      },
    );
  }

  if (node.type === "image-to-video") {
    const i2vData = node.data as ImageToVideoData;
    const nodeProvider = i2vData.provider;

    let startFrameUrl: string | undefined = overrideMediaUrl;
    if (!startFrameUrl) {
      const startEdge = edges.find(
        (e) => e.target === node.id && e.targetHandle === "startFrame",
      );
      if (startEdge) {
        const startNode = nodes.find((n) => n.id === startEdge.source);
        if (startNode) startFrameUrl = extractNodeOutput(startNode);
      }
    }
    if (!startFrameUrl && i2vData.selectedStartFrameNodeId) {
      const startNode = nodes.find(
        (n) => n.id === i2vData.selectedStartFrameNodeId,
      );
      if (startNode) startFrameUrl = extractNodeOutput(startNode);
    }
    if (!startFrameUrl) startFrameUrl = inputs.imageUrl;

    if (!startFrameUrl) {
      toast.error(`Node "${i2vData.label}": no start frame image found`);
      return Promise.reject(new Error("No start frame image"));
    }

    let endFrameUrl: string | undefined;
    const endEdge = edges.find(
      (e) => e.target === node.id && e.targetHandle === "endFrame",
    );
    if (endEdge) {
      const endNode = nodes.find((n) => n.id === endEdge.source);
      if (endNode) endFrameUrl = extractNodeOutput(endNode);
    }
    if (!endFrameUrl && i2vData.selectedEndFrameNodeId) {
      const endNode = nodes.find(
        (n) => n.id === i2vData.selectedEndFrameNodeId,
      );
      if (endNode) endFrameUrl = extractNodeOutput(endNode);
    }

    let audioUrl: string | undefined;
    const audioEdge = edges.find(
      (e) => e.target === node.id && e.targetHandle === "audio",
    );
    if (audioEdge) {
      const audioNode = nodes.find((n) => n.id === audioEdge.source);
      if (audioNode) audioUrl = extractNodeOutput(audioNode);
    }
    if (!audioUrl && i2vData.selectedAudioNodeId) {
      const audioNode = nodes.find(
        (n) => n.id === i2vData.selectedAudioNodeId,
      );
      if (audioNode) audioUrl = extractNodeOutput(audioNode);
    }

    if (audioUrl && !audioUrl.startsWith("http")) audioUrl = undefined;

    const prompt = (inputs.prompt ?? resolveTextRefs(i2vData.motionPrompt as string | undefined, refMap)) as string | undefined;
    const kling3Mode = (i2vData as Record<string, unknown>).kling3Mode as
      | string
      | undefined;
    const kling3Sound = (i2vData as Record<string, unknown>).kling3Sound as
      | boolean
      | undefined;
    const i2vNegativePrompt = (i2vData as Record<string, unknown>)
      .negativePrompt as string | undefined;
    const i2vCfgScale = (i2vData as Record<string, unknown>).cfgScale as
      | number
      | undefined;
    return runVideoGeneration(
      node.id,
      startFrameUrl,
      ctx,
      endFrameUrl,
      audioUrl,
      nodeProvider || undefined,
      i2vData.generateAudio,
      i2vData.duration,
      prompt,
      kling3Mode,
      kling3Sound,
      i2vData.aspectRatio,
      i2vData.multiShot,
      i2vData.shots,
      i2vData.elements,
      i2vNegativePrompt,
      i2vCfgScale,
      i2vData.resolution,
      i2vData.grokMode,
      i2vData.videoSize,
      i2vData.seed,
      i2vData.cameraFixed,
    );
  }

  if (node.type === "video-to-video") {
    const sourceVideoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!sourceVideoUrl) {
      toast.error(
        `Node "${(node.data as VideoToVideoData).label}": no source video found`,
      );
      return Promise.reject(new Error("No source video"));
    }
    const v2vData = node.data as VideoToVideoData;
    const inputPrompt =
      typeof inputs.prompt === "string" ? inputs.prompt : undefined;
    const dataPrompt =
      typeof v2vData.prompt === "string" ? v2vData.prompt.trim() : undefined;
    const prompt = inputPrompt ?? dataPrompt;
    const provider =
      typeof v2vData.provider === "string" ? v2vData.provider : undefined;
    return runVideoToVideoGeneration(
      node.id,
      sourceVideoUrl,
      ctx,
      prompt,
      provider,
    );
  }

  if (node.type === "text-to-video") {
    const t2vData = node.data as TextToVideoData;
    const prompt =
      overridePrompt ??
      (typeof inputs.prompt === "string" ? inputs.prompt : undefined) ??
      resolveTextRefs(t2vData.prompt?.trim(), refMap);
    if (!prompt) {
      toast.error(`Node "${t2vData.label}": no prompt found`);
      return Promise.reject(new Error("No prompt"));
    }
    const t2vProvider = t2vData.provider || undefined;
    const t2vRaw = t2vData as Record<string, unknown>;
    const isKlingVariant =
      t2vProvider === "kling" ||
      t2vProvider === "kling-turbo" ||
      t2vProvider === "kling-3.0";
    const t2vOptions = isKlingVariant
      ? {
          duration: t2vData.duration,
          mode: t2vRaw.kling3Mode as string | undefined,
          sound: t2vRaw.kling3Sound as boolean | undefined,
          negativePrompt: t2vData.negativePrompt || undefined,
          cfgScale: t2vRaw.cfgScale as number | undefined,
          aspectRatio: t2vData.aspectRatio as string | undefined,
          multiShot: t2vRaw.multiShot as boolean | undefined,
          shots: t2vRaw.shots as
            | Array<{ prompt: string; duration: number }>
            | undefined,
          elements: t2vRaw.elements as
            | Array<{
                name: string;
                description: string;
                type: "image" | "video";
                urls: string[];
              }>
            | undefined,
        }
      : t2vData.negativePrompt
        ? { negativePrompt: t2vData.negativePrompt }
        : undefined;
    return runTextToVideoGeneration(node.id, prompt, ctx, t2vProvider, t2vOptions);
  }

  if (node.type === "text-to-speech") {
    const ttsData = node.data as TextToSpeechData;
    const text =
      overridePrompt ??
      (ttsData.textSource === "direct" && ttsData.directText?.trim()
        ? resolveTextRefs(ttsData.directText.trim(), refMap) ?? ttsData.directText.trim()
        : typeof inputs.prompt === "string"
          ? inputs.prompt
          : "");
    if (!text) {
      toast.error(`Node "${ttsData.label}": no text found`);
      return Promise.reject(new Error("No text"));
    }
    const voice = ttsData.voiceId;
    const ttsOptions = {
      ...(ttsData.stability != null && { stability: ttsData.stability }),
      ...(ttsData.similarityBoost != null && {
        similarityBoost: ttsData.similarityBoost,
      }),
      ...(ttsData.style != null && { style: ttsData.style }),
      ...(ttsData.speed != null && { speed: ttsData.speed }),
      ...(ttsData.languageCode && { languageCode: ttsData.languageCode }),
      voiceType: (ttsData.voiceType as "premade" | "custom" | "library" | undefined) || "premade",
    };
    return runTextToSpeechGeneration(
      node.id,
      text,
      ctx,
      voice || undefined,
      ttsData.provider || undefined,
      Object.keys(ttsOptions).length > 0 ? ttsOptions : undefined,
    );
  }

  if (node.type === "generate-music") {
    const prompt =
      overridePrompt ??
      inputs.prompt ??
      resolveTextRefs((node.data as GenerateMusicData).prompt?.trim(), refMap);
    if (!prompt) {
      toast.error(
        `Node "${(node.data as GenerateMusicData).label}": no prompt found`,
      );
      return Promise.reject(new Error("No prompt"));
    }
    const d = node.data as GenerateMusicData;
    const refUrl = inputs.audioUrl || d.referenceAudioUrl || undefined;
    return runProcessingNode(
      node.id,
      () =>
        generateMusicApi(
          prompt,
          d.provider || undefined,
          d.duration || undefined,
          d.genre || undefined,
          d.mood || undefined,
          d.instrumental,
          d.lyrics || undefined,
          refUrl,
          ctx.userId,
        ),
      "generatedAudioUrl",
      "Generate Music",
      ctx,
    );
  }

  if (node.type === "text-to-audio") {
    const prompt =
      overridePrompt ??
      inputs.prompt ??
      resolveTextRefs((node.data as TextToAudioData).prompt?.trim(), refMap);
    if (!prompt) {
      toast.error(
        `Node "${(node.data as TextToAudioData).label}": no prompt found`,
      );
      return Promise.reject(new Error("No prompt"));
    }
    const d = node.data as TextToAudioData;
    const sfxOptions =
      d.provider === "elevenlabs-sfx"
        ? { loop: d.loop, promptInfluence: d.promptInfluence }
        : undefined;
    return runProcessingNode(
      node.id,
      () =>
        textToAudioApi(
          prompt,
          d.provider || undefined,
          d.duration || undefined,
          ctx.userId,
          sfxOptions,
        ),
      "generatedAudioUrl",
      "Text to Audio",
      ctx,
    );
  }

  if (node.type === "audio-isolation") {
    const audioUrl = inputs.audioUrl;
    if (!audioUrl) {
      toast.error(
        `Node "${(node.data as AudioIsolationData).label}": no audio input found`,
      );
      return Promise.reject(new Error("No audio input"));
    }
    return runProcessingNode(
      node.id,
      () => audioIsolationApi(audioUrl, ctx.userId),
      "generatedAudioUrl",
      "Voice Extractor",
      ctx,
    );
  }

  if (node.type === "text-to-dialogue") {
    const d = node.data as TextToDialogueData;
    const dialogue = d.dialogue?.filter((l) => l.text.trim());
    if (!dialogue || dialogue.length === 0) {
      toast.error(`Node "${d.label}": no dialogue lines`);
      return Promise.reject(new Error("No dialogue lines"));
    }
    return runProcessingNode(
      node.id,
      () =>
        textToDialogueApi(
          dialogue.map((l) => ({ text: l.text, voice: l.voice })),
          ctx.userId,
          d.stability,
          d.languageCode || undefined,
        ),
      "generatedAudioUrl",
      "Text to Dialogue",
      ctx,
    );
  }

  if (node.type === "voice-changer") {
    const d = node.data as VoiceChangerData;
    const audioUrl = inputs.audioUrl;
    if (!audioUrl) {
      toast.error(`Node "${d.label}": no audio input found`);
      return Promise.reject(new Error("No audio input"));
    }
    if (!d.voiceId) {
      toast.error(`Node "${d.label}": no voice selected`);
      return Promise.reject(new Error("No voice selected"));
    }
    return runProcessingNode(
      node.id,
      () =>
        voiceChangerApi(
          audioUrl,
          d.voiceId!,
          ctx.userId,
          d.stability,
          d.similarityBoost,
          d.removeBackgroundNoise,
        ),
      "generatedAudioUrl",
      "Voice Changer",
      ctx,
    );
  }

  if (node.type === "dubbing") {
    const d = node.data as DubbingData;
    const audioUrl = inputs.audioUrl;
    if (!audioUrl) {
      toast.error(`Node "${d.label}": no audio input found`);
      return Promise.reject(new Error("No audio input"));
    }
    if (!d.targetLanguage) {
      toast.error(`Node "${d.label}": no target language selected`);
      return Promise.reject(new Error("No target language"));
    }
    return runProcessingNode(
      node.id,
      () =>
        dubbingApi(
          audioUrl,
          d.targetLanguage,
          ctx.userId,
          d.sourceLanguage,
          d.numSpeakers,
        ),
      "generatedAudioUrl",
      "Dubbing",
      ctx,
    );
  }

  if (node.type === "voice-remix") {
    const d = node.data as VoiceRemixData;
    if (!d.text?.trim()) {
      toast.error(`Node "${d.label}": no preview text provided`);
      return Promise.reject(new Error("No text"));
    }
    if (!d.voiceDescription?.trim()) {
      toast.error(`Node "${d.label}": no voice description provided`);
      return Promise.reject(new Error("No voice description"));
    }
    return runProcessingNode(
      node.id,
      () =>
        voiceRemixApi(
          d.text!,
          d.voiceDescription!,
          ctx.userId,
        ),
      "generatedAudioUrl",
      "Voice Remix",
      ctx,
    );
  }

  if (node.type === "voice-design") {
    const d = node.data as VoiceDesignData;
    if (!d.text?.trim()) {
      toast.error(`Node "${d.label}": no preview text provided`);
      return Promise.reject(new Error("No text"));
    }
    if (!d.voiceDescription?.trim()) {
      toast.error(`Node "${d.label}": no voice description provided`);
      return Promise.reject(new Error("No voice description"));
    }
    return runProcessingNode(
      node.id,
      () =>
        voiceDesignApi(
          d.text!,
          d.voiceDescription!,
          {
            model: d.model,
            loudness: d.loudness,
            guidanceScale: d.guidanceScale,
            seed: d.seed,
            quality: d.quality,
            shouldEnhance: d.shouldEnhance,
          },
          ctx.userId,
        ),
      "generatedAudioUrl",
      "Voice Design",
      ctx,
      (outputData) => ({
        generatedVoiceId: outputData.generatedVoiceId as string | undefined,
      }),
    );
  }

  if (node.type === "forced-alignment") {
    const d = node.data as ForcedAlignmentData;
    const audioUrl = inputs.audioUrl;
    if (!audioUrl) {
      toast.error(`Node "${d.label}": no audio input found`);
      return Promise.reject(new Error("No audio input"));
    }
    if (!d.transcript?.trim()) {
      toast.error(`Node "${d.label}": no transcript provided`);
      return Promise.reject(new Error("No transcript"));
    }
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      alignmentResults: undefined,
      errorMessage: undefined,
      currentJobId: undefined,
    });

    return new Promise<void>((resolve, reject) => {
      forcedAlignmentApi(audioUrl, d.transcript!, ctx.userId)
        .then(({ jobId }) => {
          toast.info("Forced alignment started", { description: `Job ID: ${jobId}` });
          updateNodeData(node.id, { currentJobId: jobId });

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
                if (job.status === "processing" && job.progress != null) {
                  updateNodeData(node.id, { currentJobProgress: job.progress });
                }

                if (job.status === "completed") {
                  ctx.untrackInterval(poll);
                  const alignment = (job.output_data as Record<string, unknown>)?.alignment as Array<{ word: string; start: number; end: number }> | undefined;
                  updateNodeData(node.id, {
                    executionStatus: "completed",
                    alignmentResults: alignment ?? [],
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  toast.success("Forced alignment complete");
                  resolve();
                } else if (job.status === "failed") {
                  ctx.untrackInterval(poll);
                  const errMsg = job.error_message ?? "Alignment failed";
                  updateNodeData(node.id, {
                    executionStatus: "failed",
                    errorMessage: errMsg,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  toast.error("Forced alignment failed", { description: errMsg });
                  reject(new Error(errMsg));
                }
              } catch (err) {
                pollFailures++;
                if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                  ctx.untrackInterval(poll);
                  updateNodeData(node.id, {
                    executionStatus: "failed",
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  toast.error("Failed to check alignment status");
                  reject(err);
                }
              }
            }, 2000),
          );
        })
        .catch((err) => {
          updateNodeData(node.id, {
            executionStatus: "failed",
            currentJobId: undefined,
            currentJobProgress: undefined,
          });
          if (!checkStorageError(err, ctx)) {
            toast.error("Failed to start forced alignment", {
              description: err instanceof Error ? err.message : "Unknown error",
            });
          }
          reject(err);
        });
    });
  }

  if (node.type === "suno-generate") {
    const d = node.data as SunoGenerateData;
    const prompt = overridePrompt ?? inputs.prompt ?? resolveTextRefs(d.prompt?.trim(), refMap);
    if (!prompt) {
      toast.error(`Node "${d.label}": no prompt found`);
      return Promise.reject(new Error("No prompt"));
    }
    const hasCustomFields = !!(d.style || d.title || d.lyrics);
    return runProcessingNode(
      node.id,
      () =>
        sunoGenerateApi({
          prompt,
          model: d.model || undefined,
          lyrics: d.lyrics || undefined,
          style: d.style || undefined,
          title: d.title || undefined,
          negativeStyle: d.negativeStyle || undefined,
          vocalGender: d.vocalGender || undefined,
          styleWeight: d.styleWeight,
          weirdnessConstraint: d.weirdnessConstraint,
          audioWeight: d.audioWeight,
          customMode: d.customMode ?? hasCustomFields,
          instrumental: d.instrumental ?? false,
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Generate",
      ctx,
      (od) => ({
        sunoTrackId: od.sunoTrackId as string | undefined,
        sunoTaskId: od.sunoTaskId as string | undefined,
      }),
    );
  }

  if (node.type === "suno-cover") {
    const d = node.data as SunoCoverData;
    const prompt = inputs.prompt ?? resolveTextRefs(d.prompt?.trim(), refMap);
    if (!prompt) {
      toast.error(`Node "${d.label}": no prompt found`);
      return Promise.reject(new Error("No prompt"));
    }
    const uploadUrl =
      inputs.uploadUrl ?? inputs.audioUrl ?? d.uploadUrl?.trim();
    if (!uploadUrl) {
      toast.error(`Node "${d.label}": no source audio URL found`);
      return Promise.reject(new Error("No upload URL"));
    }
    const hasCoverCustomFields = !!(d.style || d.title || d.lyrics);
    return runProcessingNode(
      node.id,
      () =>
        sunoCoverApi({
          prompt,
          uploadUrl,
          model: d.model || undefined,
          lyrics: d.lyrics || undefined,
          style: d.style || undefined,
          title: d.title || undefined,
          negativeStyle: d.negativeStyle || undefined,
          vocalGender: d.vocalGender || undefined,
          customMode: d.customMode ?? hasCoverCustomFields,
          instrumental: d.instrumental ?? false,
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Cover",
      ctx,
      (od) => ({
        sunoTrackId: od.sunoTrackId as string | undefined,
        sunoTaskId: od.sunoTaskId as string | undefined,
      }),
    );
  }

  if (node.type === "suno-extend") {
    const d = node.data as SunoExtendData;
    const audioId = inputs.sunoTrackId ?? d.audioId?.trim();
    if (!audioId) {
      toast.error(
        `Node "${d.label}": no audio ID found (connect a Suno Generate/Cover node or enter manually)`,
      );
      return Promise.reject(new Error("No audio ID"));
    }
    return runProcessingNode(
      node.id,
      () =>
        sunoExtendApi({
          audioId,
          defaultParamFlag: d.defaultParamFlag ?? true,
          prompt: d.prompt?.trim() || undefined,
          model: d.model || undefined,
          style: d.style || undefined,
          title: d.title || undefined,
          continueAt: d.continueAt ?? undefined,
          negativeStyle: d.negativeStyle || undefined,
          vocalGender: d.vocalGender || undefined,
          styleWeight: d.styleWeight,
          weirdnessConstraint: d.weirdnessConstraint,
          audioWeight: d.audioWeight,
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Extend",
      ctx,
      (od) => ({
        sunoTrackId: od.sunoTrackId as string | undefined,
        sunoTaskId: od.sunoTaskId as string | undefined,
      }),
    );
  }

  if (node.type === "suno-lyrics") {
    const d = node.data as SunoLyricsData;
    const prompt = inputs.prompt ?? resolveTextRefs(d.prompt?.trim(), refMap);
    if (!prompt) {
      toast.error(`Node "${d.label}": no prompt found`);
      return Promise.reject(new Error("No prompt"));
    }
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      generatedText: undefined,
      generatedTitle: undefined,
      currentJobId: undefined,
    });

    return new Promise<void>((resolve, reject) => {
      sunoLyricsApi({ prompt, userId: ctx.userId })
        .then(({ jobId }) => {
          toast.info("Lyrics generation started", {
            description: `Job ID: ${jobId}`,
          });
          updateNodeData(node.id, { currentJobId: jobId });

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
                if (job.progress)
                  updateNodeData(node.id, {
                    currentJobProgress: job.progress,
                  });

                if (job.status === "completed") {
                  ctx.untrackInterval(poll);
                  const lyrics = (job.output_data as Record<string, unknown>)
                    ?.lyrics as
                    | Array<{ text: string; title: string }>
                    | undefined;
                  const first = lyrics?.[0];
                  updateNodeData(node.id, {
                    executionStatus: "completed",
                    generatedText: first?.text ?? "",
                    generatedTitle: first?.title ?? "",
                    generatedResults: lyrics?.map((l) => ({
                      text: l.text,
                      title: l.title,
                      jobId,
                    })),
                    activeResultIndex: 0,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  toast.success("Lyrics generation complete");
                  resolve();
                } else if (job.status === "failed") {
                  ctx.untrackInterval(poll);
                  const errMsg =
                    job.error_message ?? "Lyrics generation failed";
                  updateNodeData(node.id, {
                    executionStatus: "failed",
                    errorMessage: errMsg,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  toast.error("Lyrics generation failed", {
                    description: errMsg,
                  });
                  reject(new Error(errMsg));
                }
              } catch (err) {
                pollFailures++;
                if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                  ctx.untrackInterval(poll);
                  updateNodeData(node.id, {
                    executionStatus: "failed",
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  toast.error("Failed to check lyrics status");
                  reject(err);
                }
              }
            }, 3000),
          );
        })
        .catch((err) => {
          updateNodeData(node.id, {
            executionStatus: "failed",
            currentJobId: undefined,
            currentJobProgress: undefined,
          });
          if (!checkStorageError(err, ctx)) {
            toast.error("Failed to start lyrics generation", {
              description:
                err instanceof Error ? err.message : "Unknown error",
            });
          }
          reject(err);
        });
    });
  }

  if (node.type === "suno-separate") {
    const d = node.data as SunoSeparateData;
    const taskId = inputs.sunoTaskId ?? d.taskId?.trim();
    const audioId = inputs.sunoTrackId ?? d.audioId?.trim();
    if (!taskId) {
      toast.error(
        `Node "${d.label}": no task ID found (connect a Suno Generate/Cover/Extend node or enter manually)`,
      );
      return Promise.reject(new Error("No task ID"));
    }
    return runProcessingNode(
      node.id,
      () =>
        sunoSeparateApi({
          taskId,
          audioId: audioId ?? taskId,
          type: d.type || "separate_vocal",
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Separate",
      ctx,
      (od) => {
        const extra: Record<string, unknown> = {};
        if (od.vocalUrl) extra.vocalUrl = od.vocalUrl;
        if (od.instrumentalUrl) extra.instrumentalUrl = od.instrumentalUrl;
        if (od.stems) extra.stems = od.stems;
        return extra;
      },
    );
  }

  if (node.type === "suno-music-video") {
    const d = node.data as SunoMusicVideoData;
    const taskId = inputs.sunoTaskId ?? d.taskId?.trim();
    const audioId = inputs.sunoTrackId ?? d.audioId?.trim();
    if (!taskId || !audioId) {
      toast.error(
        `Node "${d.label}": missing taskId or audioId. Connect to a Suno node.`,
      );
      return Promise.reject(new Error("Missing taskId/audioId"));
    }
    return runProcessingNode(
      node.id,
      () =>
        sunoMusicVideoApi({
          taskId,
          audioId,
          userId: ctx.userId,
        }),
      "generatedVideoUrl",
      "Suno Music Video",
      ctx,
    );
  }

  if (node.type === "transcribe") {
    let audioUrl = inputs.audioUrl ?? inputs.videoUrl;
    if (!audioUrl) {
      toast.error(
        `Node "${(node.data as TranscribeData).label}": no audio/video input found`,
      );
      return Promise.reject(new Error("No audio input"));
    }
    const d = node.data as TranscribeData;
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      generatedText: undefined,
      currentJobId: undefined,
      currentJobProgress: 0,
    });

    const isVideoUrl =
      /(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com)/.test(
        audioUrl,
      );

    const getTranscribeAudioUrl = async (): Promise<string> => {
      if (!isVideoUrl) return audioUrl as string;
      toast.info("Extracting audio from video...");
      const result = await downloadYouTubeAudio(audioUrl as string);

      if (result.thumbnailUrl) {
        const { edges: curEdges, nodes: currentNodes } = useWorkflowStore.getState();
        const incomingEdge = curEdges.find((e) => e.target === node.id);
        if (incomingEdge) {
          const sourceNode = currentNodes.find(
            (n) => n.id === incomingEdge.source,
          );
          if (
            sourceNode?.type === "youtube-video" &&
            !(sourceNode.data as Record<string, unknown>).thumbnailUrl
          ) {
            updateNodeData(sourceNode.id, {
              thumbnailUrl: result.thumbnailUrl,
            });
          }
        }
      }

      return result.url;
    };

    return new Promise((resolve, reject) => {
      getTranscribeAudioUrl()
        .then((resolvedAudioUrl) => {
          audioUrl = resolvedAudioUrl;
          return transcribeApi(
            audioUrl,
            d.provider || undefined,
            d.language || undefined,
            ctx.userId,
            d.diarize,
            d.tagAudioEvents,
          );
        })
        .then(({ jobId }) => {
          toast.info("Transcription started", {
            description: `Job ID: ${jobId}`,
          });
          updateNodeData(node.id, { currentJobId: jobId });

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
                if (job.status === "processing" && job.progress != null) {
                  updateNodeData(node.id, {
                    currentJobProgress: job.progress,
                  });
                }
                if (job.status === "completed") {
                  ctx.untrackInterval(poll);
                  const text = job.output_data?.text as string | undefined;
                  const language =
                    (job.output_data?.language as string | undefined) ??
                    "unknown";
                  if (!text) {
                    const errMsg = "No transcript text returned from job";
                    updateNodeData(node.id, {
                      executionStatus: "failed",
                      errorMessage: errMsg,
                      currentJobId: undefined,
                      currentJobProgress: undefined,
                    });
                    toast.error("Transcription failed", {
                      description: errMsg,
                    });
                    reject(new Error(errMsg));
                    return;
                  }
                  const existingResults =
                    ((
                      useWorkflowStore
                        .getState()
                        .nodes.find((n) => n.id === node.id)?.data as Record<
                        string,
                        unknown
                      >
                    )?.generatedResults as
                      | Array<{
                          text: string;
                          language: string;
                          jobId: string;
                          timestamp: string;
                        }>
                      | undefined) ?? [];
                  const newResult = {
                    text,
                    language,
                    jobId,
                    timestamp: new Date().toISOString(),
                  };
                  updateNodeData(node.id, {
                    executionStatus: "completed",
                    generatedText: text,
                    generatedResults: [newResult, ...existingResults],
                    activeResultIndex: 0,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  toast.success("Transcription complete");
                  resolve();
                } else if (job.status === "failed") {
                  ctx.untrackInterval(poll);
                  const errMsg = job.error_message ?? "Unknown error";
                  updateNodeData(node.id, {
                    executionStatus: "failed",
                    errorMessage: errMsg,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  toast.error("Transcription failed", {
                    description: errMsg,
                  });
                  reject(new Error(errMsg));
                }
              } catch (err) {
                pollFailures++;
                if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                  ctx.untrackInterval(poll);
                  updateNodeData(node.id, {
                    executionStatus: "failed",
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  toast.error("Failed to check transcription status");
                  reject(err);
                }
              }
            }, 2000),
          );
        })
        .catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          updateNodeData(node.id, {
            executionStatus: "failed",
            errorMessage: errMsg,
            currentJobId: undefined,
            currentJobProgress: undefined,
          });
          if (!checkStorageError(err, ctx)) {
            toast.error("Transcription failed", { description: errMsg });
          }
          reject(err);
        });
    });
  }

  if (node.type === "image-to-text") {
    const imageUrl = inputs.imageUrl;
    if (!imageUrl) {
      toast.error(
        `Node "${(node.data as ImageToTextData).label}": no image input found`,
      );
      return Promise.reject(new Error("No image input"));
    }
    const itData = node.data as ImageToTextData;
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      generatedText: undefined,
      errorMessage: undefined,
    });

    return imageToTextApi(
      imageUrl,
      itData.detailLevel || "detailed",
      itData.customPrompt || undefined,
      ctx.userId,
    )
      .then((result) => {
        const existingResults =
          (
            useWorkflowStore.getState().nodes.find((n) => n.id === node.id)
              ?.data as ImageToTextData | undefined
          )?.generatedResults ?? [];
        const newResult = {
          text: result.generatedText,
          jobId: result.jobId,
          timestamp: new Date().toISOString(),
        };
        const newResults = [...existingResults, newResult];
        updateNodeData(node.id, {
          executionStatus: "completed",
          generatedText: result.generatedText,
          generatedResults: newResults,
          activeResultIndex: newResults.length - 1,
          errorMessage: undefined,
        });
        toast.success("Image described successfully");
      })
      .catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: errMsg,
        });
        toast.error("Image description failed", { description: errMsg });
        throw err;
      });
  }

  if (node.type === "ai-writer") {
    const writerData = node.data as AIWriterNodeData;
    const { updateNodeData } = useWorkflowStore.getState();

    const writerTemplate = getAIWriterTemplate(writerData.templateId);
    if (writerTemplate && writerTemplate.id !== "custom") {
      const IMG_SRC_TYPES = new Set([
        "generate-image",
        "upload-image",
        "edit-image",
        "image-to-image",
        "character",
        "object",
        "location",
        "face",
      ]);
      const writerEdges = edges.filter((e) => e.target === node.id);
      const hasImageSource = writerEdges.some((e) => {
        const src = nodes.find((n) => n.id === e.source);
        return src && IMG_SRC_TYPES.has(src.type ?? "");
      });
      if (!hasImageSource) {
        toast.error(
          `Node "${writerData.label}": connect a reference image (Generate Image, Upload Image, etc.) before running with a template`,
        );
        return Promise.reject(new Error("No reference image connected"));
      }
    }

    if (!writerData.systemPrompt?.trim()) {
      updateNodeData(node.id, {
        executionStatus: "failed",
        errorMessage: "System prompt is required",
      });
      return Promise.resolve();
    }

    const userInput =
      overridePrompt ||
      (typeof inputs.prompt === "string" && inputs.prompt.trim()
        ? inputs.prompt
        : writerData.userInput);

    if (!userInput?.trim()) {
      toast.error(`Node "${writerData.label}": no input provided`);
      return Promise.reject(new Error("No input"));
    }

    updateNodeData(node.id, {
      executionStatus: "running",
      errorMessage: undefined,
      generatedText: "",
      activeResultIndex: -1,
    });

    const processedPrompt = writerData.systemPrompt;

    return generateAIWriterStream({
      userId: ctx.userId ?? "",
      systemPrompt: processedPrompt,
      userInput,
      model: writerData.model || "claude-sonnet-4-5-20250929",
      temperature: writerData.temperature ?? 0.7,
      maxTokens: writerData.maxTokens ?? 4096,
      onToken: (token) => {
        const fresh = useWorkflowStore
          .getState()
          .nodes.find((n) => n.id === node.id);
        const prev =
          (fresh?.data as AIWriterNodeData | undefined)?.generatedText ?? "";
        updateNodeData(node.id, { generatedText: prev + token });
      },
    })
      .then((result) => {
        const existingResults =
          (
            useWorkflowStore.getState().nodes.find((n) => n.id === node.id)
              ?.data as AIWriterNodeData | undefined
          )?.generatedResults ?? [];
        const newResult = {
          text: result.generatedText,
          jobId: result.jobId,
          timestamp: new Date().toISOString(),
        };

        const items = [result.generatedText];

        updateNodeData(node.id, {
          executionStatus: "completed",
          generatedText: result.generatedText,
          generatedItems: items,
          generatedResults: [newResult, ...existingResults],
          activeResultIndex: 0,
        });
        toast.success(
          `AI Agent completed: ${items.length} item${items.length !== 1 ? "s" : ""} generated`,
        );
      })
      .catch((err: Error) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err.message || "Generation failed",
        });
        toast.error(`AI Agent failed: ${err.message}`);
        throw err;
      });
  }

  if (node.type === "lip-sync") {
    const lsData = node.data as LipSyncData;

    let imageUrl: string | undefined = overrideMediaUrl;
    if (!imageUrl && lsData.selectedImageNodeId) {
      const imageNode = nodes.find(
        (n) => n.id === lsData.selectedImageNodeId,
      );
      if (imageNode) {
        imageUrl = extractNodeOutput(imageNode);
      }
    }
    if (!imageUrl) {
      imageUrl = inputs.imageUrl;
    }

    let audioUrl: string | undefined;
    if (lsData.selectedAudioNodeId) {
      const audioNode = nodes.find(
        (n) => n.id === lsData.selectedAudioNodeId,
      );
      if (audioNode) {
        audioUrl = extractNodeOutput(audioNode);
      }
    }
    if (!audioUrl) {
      audioUrl = inputs.audioUrl;
    }

    if (!imageUrl) {
      toast.error(`Node "${lsData.label}": no portrait image found`);
      return Promise.reject(new Error("No portrait image"));
    }
    if (!audioUrl) {
      toast.error(`Node "${lsData.label}": no audio track found`);
      return Promise.reject(new Error("No audio track"));
    }

    return runProcessingNode(
      node.id,
      () =>
        lipSyncApi(
          imageUrl!,
          audioUrl!,
          lsData.prompt || "A person talking naturally",
          lsData.provider || undefined,
          lsData.resolution || undefined,
          ctx.userId,
        ),
      "generatedVideoUrl",
      "Lip Sync",
      ctx,
    );
  }

  if (node.type === "motion-transfer") {
    const mtData = node.data as unknown as MotionTransferData;

    const IMAGE_PRODUCING_TYPES = new Set([
      "generate-image",
      "upload-image",
      "character",
      "location",
      "object",
    ]);
    const VIDEO_PRODUCING_TYPES = new Set([
      "image-to-video",
      "text-to-video",
      "video-to-video",
      "upload-video",
    ]);

    const incomingEdges = edges.filter((e) => e.target === node.id);
    let imageUrl: string | undefined;
    let videoUrl: string | undefined;

    for (const edge of incomingEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;
      const output = extractNodeOutput(sourceNode);
      if (!output) continue;

      if (IMAGE_PRODUCING_TYPES.has(sourceNode.type || "")) {
        imageUrl = output;
      } else if (VIDEO_PRODUCING_TYPES.has(sourceNode.type || "")) {
        videoUrl = output;
      }
    }

    if (!imageUrl) {
      toast.error(
        `Node "${mtData.label}": no character image found. Connect an image node (Generate Image, Upload Image, Character, etc.)`,
      );
      return Promise.reject(new Error("No character image"));
    }
    if (!videoUrl) {
      toast.error(
        `Node "${mtData.label}": no motion video found. Connect a video node (Image to Video, Upload Video, etc.)`,
      );
      return Promise.reject(new Error("No motion video"));
    }

    return runProcessingNode(
      node.id,
      () =>
        motionTransferApi(
          imageUrl!,
          videoUrl!,
          mtData.prompt || undefined,
          mtData.characterOrientation || undefined,
          mtData.resolution || undefined,
          ctx.userId,
        ),
      "generatedVideoUrl",
      "Motion Transfer",
      ctx,
    );
  }

  if (node.type === "video-upscale") {
    const vuData = node.data as unknown as VideoUpscaleData;
    const provider = vuData.provider || "topaz";

    if (provider === "veo-1080p" || provider === "veo-4k") {
      const kieTaskId = resolveUpstreamKieTaskId(node.id, vuData as unknown as Record<string, unknown>);
      if (!kieTaskId) {
        toast.error(`Node "${vuData.label}": no upstream kieTaskId found. Connect a VEO video node.`);
        return Promise.reject(new Error("No kieTaskId"));
      }

      return runProcessingNode(
        node.id,
        () => videoUpscaleApi({ userId: ctx.userId, provider, kieTaskId }),
        "generatedVideoUrl",
        "Video Upscale",
        ctx,
      );
    }

    // Topaz provider - requires videoUrl
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(`Node "${vuData.label}": no video input found`);
      return Promise.reject(new Error("No video input"));
    }

    return runProcessingNode(
      node.id,
      () => videoUpscaleApi({ videoUrl, upscaleFactor: vuData.upscaleFactor || undefined, userId: ctx.userId, provider: "topaz" }),
      "generatedVideoUrl",
      "Video Upscale",
      ctx,
    );
  }

  if (node.type === "extend-video") {
    const evData = node.data as unknown as ExtendVideoData;
    const prompt = overridePrompt ?? inputs.prompt ?? resolveTextRefs(evData.prompt, refMap);

    const kieTaskId = resolveUpstreamKieTaskId(node.id, evData as unknown as Record<string, unknown>);

    if (!kieTaskId) {
      toast.error(`Node "${evData.label}": no upstream kieTaskId found. Connect a VEO or Runway video node.`);
      return Promise.reject(new Error("No kieTaskId"));
    }

    return runProcessingNode(
      node.id,
      () =>
        extendVideo({
          kieTaskId,
          prompt: prompt || "",
          provider: evData.provider || "veo-extend",
          model: evData.provider === "veo-extend" ? evData.model : undefined,
          quality: evData.provider === "runway-extend" ? evData.quality : undefined,
          userId: ctx.userId,
        }),
      "generatedVideoUrl",
      "Extend Video",
      ctx,
    );
  }

  if (node.type === "combine-videos") {
    const combineData = node.data as CombineVideosData;
    let videoUrls = inputs.videoUrls ?? [];

    if (combineData.clipOrder?.length) {
      const sourceEntries =
        (inputs.videoUrlsWithSourceIds as Array<{
          nodeId: string;
          url: string;
        }>) ?? [];
      const ordered: string[] = [];
      for (const nodeId of combineData.clipOrder) {
        const entry = sourceEntries.find((e) => e.nodeId === nodeId);
        if (entry) ordered.push(entry.url);
      }
      if (ordered.length >= 2) videoUrls = ordered;
    }

    if (videoUrls.length < 2) {
      toast.error(
        `Node "${combineData.label}": need at least 2 video inputs`,
      );
      return Promise.reject(new Error("Need at least 2 videos"));
    }
    return runCombineVideos(
      node.id,
      videoUrls,
      combineData.transition ?? "cut",
      combineData.transitionDuration ?? 0.5,
      combineData.audioMode ?? "crossfade",
      ctx,
    );
  }

  if (node.type === "merge-video-audio") {
    const videoUrl = inputs.videoUrl;
    const audioSources = inputs.audioSources ?? [];
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as MergeVideoAudioData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    if (audioSources.length === 0) {
      toast.error(
        `Node "${(node.data as MergeVideoAudioData).label}": no audio input`,
      );
      return Promise.reject(new Error("No audio"));
    }
    const d = node.data as MergeVideoAudioData;
    const ts = d.trackSettings ?? {};
    const audioTracks = audioSources.map(
      (s: { url: string; sourceNodeId: string; sourceType?: string }) => {
        const setting = ts[s.sourceNodeId];
        return {
          url: s.url,
          startTime:
            setting?.startTime ?? d.audioOffsets?.[s.sourceNodeId] ?? 0,
          volume: setting?.volume ?? d.voiceoverVolume ?? 100,
          sourceType: s.sourceType as "audio" | "video" | undefined,
        };
      },
    );
    const keepOrig = d.keepOriginalAudio ?? true;
    const origVol = d.originalAudioVolume ?? d.backgroundVolume ?? 30;
    return runProcessingNode(
      node.id,
      () =>
        mergeVideoAudioApi(
          videoUrl,
          audioTracks,
          origVol,
          keepOrig,
          ctx.userId,
        ),
      "generatedVideoUrl",
      "Merge Video & Audio",
      ctx,
    );
  }

  if (node.type === "extract-audio") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as ExtractAudioData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const d = node.data as ExtractAudioData;
    return runProcessingNode(
      node.id,
      () =>
        extractAudioApi(
          videoUrl,
          d.audioFormat,
          d.outputSilentVideo,
          ctx.userId,
        ),
      "generatedAudioUrl",
      "Extract Audio",
      ctx,
    );
  }

  if (node.type === "trim-video") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as TrimVideoData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const d = node.data as TrimVideoData;
    return runProcessingNode(
      node.id,
      () =>
        trimVideoApi(videoUrl, d.startTime, d.endTime || undefined, ctx.userId),
      "generatedVideoUrl",
      "Trim Video",
      ctx,
    );
  }

  if (node.type === "transcode-video") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as TranscodeVideoData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const d = node.data as TranscodeVideoData;
    return runProcessingNode(
      node.id,
      () =>
        transcodeVideoApi(
          videoUrl,
          d.codec || undefined,
          d.crf ?? undefined,
          d.resolution || undefined,
          d.audioBitrate || undefined,
          ctx.userId,
        ),
      "generatedVideoUrl",
      "Transcode Video",
      ctx,
    );
  }

  if (node.type === "manual-edit") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as ManualEditData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const { updateNodeData: setNodeData } = useWorkflowStore.getState();
    setNodeData(node.id, {
      executionStatus: "awaiting-user",
      inputVideoUrl: videoUrl,
      errorMessage: undefined,
    });
    toast.info("Manual edit required — click 'Open Editor' on the node");
    return new Promise<void>((resolve, reject) => {
      pendingManualEdits.set(node.id, { resolve, reject });
    });
  }

  if (node.type === "speed-ramp") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as SpeedRampData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const d = node.data as SpeedRampData;
    return runProcessingNode(
      node.id,
      () => speedRampApi(videoUrl, d.speed, d.adjustAudio, ctx.userId),
      "generatedVideoUrl",
      "Adjust Speed",
      ctx,
    );
  }

  if (node.type === "loop-video") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as LoopVideoData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const d = node.data as LoopVideoData;
    return runProcessingNode(
      node.id,
      () =>
        loopVideoApi(
          videoUrl,
          d.mode ?? "repeat",
          d.repeatCount,
          d.targetDuration,
          ctx.userId,
        ),
      "generatedVideoUrl",
      "Loop Video",
      ctx,
    );
  }

  if (node.type === "fade-video") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as FadeVideoData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const d = node.data as FadeVideoData;
    return runProcessingNode(
      node.id,
      () =>
        fadeVideoApi(
          videoUrl,
          d.fadeIn !== false,
          d.fadeInDuration ?? 0.5,
          d.fadeOut !== false,
          d.fadeOutDuration ?? 0.5,
          d.color ?? "black",
          ctx.userId,
        ),
      "generatedVideoUrl",
      "Fade In/Out",
      ctx,
    );
  }

  if (node.type === "resize-video") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as ResizeVideoData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const d = node.data as ResizeVideoData;
    return runProcessingNode(
      node.id,
      () =>
        resizeVideoApi(
          videoUrl,
          d.targetAspect,
          d.method,
          d.padColor || undefined,
          ctx.userId,
        ),
      "generatedVideoUrl",
      "Resize Video",
      ctx,
    );
  }

  if (node.type === "social-media-format") {
    const mediaUrl = overrideMediaUrl ?? inputs.videoUrl ?? inputs.imageUrl;
    if (!mediaUrl) {
      toast.error(
        `Node "${(node.data as SocialMediaFormatData).label}": no media input`,
      );
      return Promise.reject(new Error("No media"));
    }
    const d = node.data as SocialMediaFormatData;
    const spec = PLATFORM_SPECS[d.specKey];
    if (!spec) {
      toast.error(`Node "${d.label}": invalid spec key "${d.specKey}"`);
      return Promise.reject(new Error("Invalid spec key"));
    }
    const mediaType: "image" | "video" = inputs.videoUrl ? "video" : "image";
    return runProcessingNode(
      node.id,
      () =>
        socialMediaFormatApi(
          mediaUrl,
          mediaType,
          d.specKey,
          spec.width,
          spec.height,
          d.method,
          d.padColor || undefined,
          ctx.userId,
        ),
      "generatedVideoUrl",
      "Social Media Format",
      ctx,
    );
  }

  if (node.type === "adjust-volume") {
    const videoUrl = inputs.videoUrl;
    const audioUrl = inputs.audioUrl;
    const inputUrl = overrideMediaUrl ?? videoUrl ?? audioUrl;
    if (!inputUrl) {
      toast.error(
        `Node "${(node.data as AdjustVolumeData).label}": no audio or video input`,
      );
      return Promise.reject(new Error("No input"));
    }
    const inputType: "video" | "audio" = videoUrl ? "video" : "audio";
    const outputKey: "generatedVideoUrl" | "generatedAudioUrl" =
      inputType === "video" ? "generatedVideoUrl" : "generatedAudioUrl";
    const d = node.data as AdjustVolumeData;
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, { lastInputType: inputType });
    return runProcessingNode(
      node.id,
      () =>
        adjustVolumeApi(
          inputUrl,
          inputType,
          d.volume,
          d.normalize,
          d.fadeIn,
          d.fadeOut,
          ctx.userId,
        ),
      outputKey,
      "Adjust Volume",
      ctx,
    );
  }

  if (node.type === "add-captions") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as AddCaptionsData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const d = node.data as AddCaptionsData;
    const text = inputs.prompt ?? "";
    if (!text) {
      toast.error(`Node "${d.label}": no caption text`);
      return Promise.reject(new Error("No text"));
    }
    return runProcessingNode(
      node.id,
      () =>
        addCaptionsApi(
          videoUrl,
          text,
          d.style,
          d.position,
          d.fontSize,
          d.color,
          undefined,
          ctx.userId,
        ),
      "generatedVideoUrl",
      "Add Captions",
      ctx,
    );
  }

  if (node.type === "mix-audio") {
    const mixData = node.data as MixAudioData;
    let sourceEntries = inputs.audioUrlsWithSourceIds ?? [];

    // Apply trackOrder to reorder audio inputs
    if (mixData.trackOrder?.length && sourceEntries.length > 1) {
      sourceEntries = applyMediaOrder(
        sourceEntries.map((e) => ({ id: e.nodeId, ...e })),
        mixData.trackOrder,
      ).map((e) => ({ nodeId: e.nodeId, url: e.url }));
    }

    const audioUrls = sourceEntries.map((e) => e.url);
    if (audioUrls.length < 2) {
      toast.error(
        `Node "${mixData.label}": need at least 2 audio inputs`,
      );
      return Promise.reject(new Error("Need at least 2 audio tracks"));
    }
    const volumes = sourceEntries.map(
      (e) => mixData.trackVolumes?.[e.nodeId] ?? 100,
    );
    return runProcessingNode(
      node.id,
      () => mixAudioApi(audioUrls, volumes, ctx.userId),
      "generatedAudioUrl",
      "Mix Audio",
      ctx,
    );
  }

  if (node.type === "video-composer") {
    const d = node.data as VideoComposerData;
    if (!d.compositionPrompt?.trim()) {
      toast.error(`Node "${d.label}": no composition prompt set`);
      return Promise.reject(new Error("No composition prompt"));
    }
    if (!ctx.userId) {
      toast.error("Not authenticated");
      return Promise.reject(new Error("Not authenticated"));
    }
    const assets = collectMediaAssets(node, edges, nodes);
    if (assets.length === 0) {
      toast.error(`Node "${d.label}": no media assets connected`);
      return Promise.reject(new Error("No media assets"));
    }
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      sceneGraph: undefined,
      errorMessage: undefined,
    });
    return generateSceneGraph({
      prompt: d.compositionPrompt,
      assets,
      fps: d.fps,
      aspectRatio: d.aspectRatio,
      durationSeconds: d.durationSeconds,
      userId: ctx.userId,
    })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          sceneGraph: result.sceneGraph,
        });
        toast.success("Composition generated");
      })
      .catch((err) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      });
  }

  if (node.type === "after-effects") {
    const d = node.data as AfterEffectsData;
    if (!d.effectPrompt?.trim()) {
      toast.error(`Node "${d.label}": no effect prompt set`);
      return Promise.reject(new Error("No effect prompt"));
    }
    if (!ctx.userId) {
      toast.error("Not authenticated");
      return Promise.reject(new Error("Not authenticated"));
    }
    const aeIncomingEdges = edges.filter((e) => e.target === node.id);
    let inputVideoUrl: string | undefined;
    for (const edge of aeIncomingEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (sourceNode) {
        const output = extractNodeOutput(sourceNode);
        if (output && (output.startsWith("http") || output.startsWith("/"))) {
          inputVideoUrl = output;
          break;
        }
      }
    }
    if (!inputVideoUrl) {
      toast.error(`Node "${d.label}": no video input connected`);
      return Promise.reject(new Error("No video input"));
    }
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      effectPlan: undefined,
      errorMessage: undefined,
      inputVideoUrl,
    });
    const aeWidth = d.width ?? 1920;
    const aeHeight = d.height ?? 1080;
    return generateAfterEffects({
      prompt: d.effectPrompt,
      inputVideoUrl,
      fps: d.fps,
      width: aeWidth,
      height: aeHeight,
      durationSeconds: d.durationSeconds,
      userId: ctx.userId,
    })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          effectPlan: result.effectPlan,
        });
        toast.success("After effects plan generated");
      })
      .catch((err) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      });
  }

  if (node.type === "lottie-overlay") {
    const d = node.data as LottieOverlayData;
    if (!d.overlayPrompt?.trim()) {
      toast.error(`Node "${d.label}": no overlay prompt set`);
      return Promise.reject(new Error("No overlay prompt"));
    }
    if (!ctx.userId) {
      toast.error("Not authenticated");
      return Promise.reject(new Error("Not authenticated"));
    }
    const loIncomingEdges = edges.filter((e) => e.target === node.id);
    let inputVideoUrl: string | undefined;
    const lottieAssets: Array<{ id: string; url: string; name: string }> = [];
    for (const edge of loIncomingEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;
      if (edge.targetHandle === "in") {
        const output = extractNodeOutput(sourceNode);
        if (output && (output.startsWith("http") || output.startsWith("/"))) {
          inputVideoUrl = output;
        }
      } else if (edge.targetHandle === "lottie") {
        const output = extractNodeOutput(sourceNode);
        if (output && (output.startsWith("http") || output.startsWith("/"))) {
          lottieAssets.push({
            id: sourceNode.id,
            url: output,
            name: (sourceNode.data as Record<string, unknown>).label as string ?? "Lottie Asset",
          });
        }
      }
    }
    if (!inputVideoUrl) {
      toast.error(`Node "${d.label}": no video input connected`);
      return Promise.reject(new Error("No video input"));
    }
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      overlayPlan: undefined,
      errorMessage: undefined,
      inputVideoUrl,
    });
    return generateLottieOverlay({
      prompt: d.overlayPrompt,
      inputVideoUrl,
      fps: d.fps,
      width: d.width ?? 1920,
      height: d.height ?? 1080,
      durationSeconds: d.durationSeconds,
      lottieAssets: lottieAssets.length > 0 ? lottieAssets : undefined,
      userId: ctx.userId,
    })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          overlayPlan: result.overlayPlan,
        });
        toast.success("Lottie overlay plan generated");
      })
      .catch((err) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      });
  }

  if (node.type === "3d-title") {
    const d = node.data as ThreeDTitleData;
    if (!d.titlePrompt?.trim()) {
      toast.error(`Node "${d.label}": no title prompt set`);
      return Promise.reject(new Error("No title prompt"));
    }
    if (!ctx.userId) {
      toast.error("Not authenticated");
      return Promise.reject(new Error("Not authenticated"));
    }
    const tdIncomingEdges = edges.filter((e) => e.target === node.id);
    let backgroundMediaUrl: string | undefined;
    for (const edge of tdIncomingEdges) {
      if (edge.targetHandle === "background") {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        if (sourceNode) {
          const output = extractNodeOutput(sourceNode);
          if (output && (output.startsWith("http") || output.startsWith("/"))) {
            backgroundMediaUrl = output;
            break;
          }
        }
      }
    }
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      titlePlan: undefined,
      errorMessage: undefined,
      backgroundMediaUrl,
    });
    const ASPECT_DIMS: Record<string, { width: number; height: number }> = {
      "16:9": { width: 1920, height: 1080 },
      "9:16": { width: 1080, height: 1920 },
      "1:1": { width: 1080, height: 1080 },
      "4:5": { width: 1080, height: 1350 },
    };
    const dims = ASPECT_DIMS[d.aspectRatio] ?? { width: 1920, height: 1080 };
    return generate3DTitle({
      prompt: d.titlePrompt,
      fps: d.fps,
      aspectRatio: d.aspectRatio,
      width: dims.width,
      height: dims.height,
      durationSeconds: d.durationSeconds,
      backgroundColor: d.backgroundColor,
      backgroundMediaUrl,
      userId: ctx.userId,
    })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          titlePlan: result.titlePlan,
        });
        toast.success("3D title plan generated");
      })
      .catch((err) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      });
  }

  if (node.type === "motion-graphics") {
    const d = node.data as MotionGraphicsData;
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      motionPlan: undefined,
      errorMessage: undefined,
    });
    const ASPECT_DIMS: Record<string, { width: number; height: number }> = {
      "16:9": { width: 1920, height: 1080 },
      "9:16": { width: 1080, height: 1920 },
      "1:1": { width: 1080, height: 1080 },
      "4:5": { width: 1080, height: 1350 },
    };
    const dims = ASPECT_DIMS[d.aspectRatio] ?? { width: 1920, height: 1080 };
    return generateMotionGraphics({
      prompt: d.motionPrompt,
      fps: d.fps,
      aspectRatio: d.aspectRatio,
      width: dims.width,
      height: dims.height,
      durationSeconds: d.durationSeconds,
      backgroundColor: d.backgroundColor,
      userId: ctx.userId!,
    })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          motionPlan: result.motionPlan,
        });
        toast.success("Motion graphics plan generated");
      })
      .catch((err) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      });
  }

  if (node.type === "composite") {
    const d = node.data as CompositeData;
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      compositePlan: undefined,
      errorMessage: undefined,
    });
    try {
      const ASPECT_DIMS: Record<string, { width: number; height: number }> = {
        "16:9": { width: 1920, height: 1080 },
        "9:16": { width: 1080, height: 1920 },
        "1:1": { width: 1080, height: 1080 },
        "4:5": { width: 1080, height: 1350 },
      };
      const dims = ASPECT_DIMS[d.aspectRatio] ?? { width: 1920, height: 1080 };
      const durationInFrames = Math.round(d.durationSeconds * d.fps);

      const incomingEdges = edges.filter((e) => e.target === node.id);
      const handleVideoMap = new Map<string, string>();
      for (const edge of incomingEdges) {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        if (!sourceNode) continue;
        const output = extractNodeOutput(sourceNode);
        if (!output || output === "plan-ready") continue;
        const targetHandle = edge.targetHandle ?? "video1";
        handleVideoMap.set(targetHandle, output);
      }

      if (handleVideoMap.size === 0) {
        throw new Error("No video inputs connected. Connect at least one video to an input handle.");
      }

      const layers: Array<{
        id: string;
        sourceVideo: string;
        position: "fullscreen" | "positioned";
        x: number;
        y: number;
        width: number;
        height: number;
        startFrame: number;
        durationInFrames?: number;
        opacity: number;
        blendMode: "normal" | "multiply" | "screen" | "overlay";
        zIndex: number;
      }> = [];
      const existingLayerMap = new Map(d.layers.map((l) => [l.inputHandle, l]));

      for (const [handle, videoUrl] of handleVideoMap) {
        const existing = existingLayerMap.get(handle);
        if (existing) {
          layers.push({
            id: existing.id,
            sourceVideo: videoUrl,
            position: existing.position,
            x: existing.x,
            y: existing.y,
            width: existing.width,
            height: existing.height,
            startFrame: existing.startFrame,
            durationInFrames: existing.durationInFrames,
            opacity: existing.opacity,
            blendMode: existing.blendMode,
            zIndex: existing.zIndex,
          });
        } else {
          layers.push({
            id: `layer-${handle}-${Date.now()}`,
            sourceVideo: videoUrl,
            position: "fullscreen",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            startFrame: 0,
            opacity: 1,
            blendMode: "normal",
            zIndex: layers.length,
          });
        }
      }

      layers.sort((a, b) => a.zIndex - b.zIndex);

      const compositePlan = {
        planType: "composite" as const,
        fps: d.fps,
        width: dims.width,
        height: dims.height,
        durationInFrames,
        backgroundColor: d.backgroundColor,
        layers,
      };

      updateNodeData(node.id, {
        executionStatus: "completed",
        compositePlan,
      });
      toast.success("Composite plan built");
      return Promise.resolve();
    } catch (err) {
      updateNodeData(node.id, {
        executionStatus: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  if (node.type === "render-video") {
    const d = node.data as RenderVideoData;
    const COMPOSER_PLAN_MAP: Record<string, { planType: string; planField: string }> = {
      "video-composer": { planType: "scene-graph", planField: "sceneGraph" },
      "after-effects": { planType: "after-effects", planField: "effectPlan" },
      "lottie-overlay": { planType: "lottie-overlay", planField: "overlayPlan" },
      "3d-title": { planType: "3d-title", planField: "titlePlan" },
      "motion-graphics": { planType: "motion-graphics", planField: "motionPlan" },
      "composite": { planType: "composite", planField: "compositePlan" },
    };
    const incomingEdges = edges.filter((e) => e.target === node.id);
    let upstreamPlanType: string | undefined;
    let upstreamPlan: Record<string, unknown> | undefined;
    for (const edge of incomingEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;
      const composerInfo = COMPOSER_PLAN_MAP[sourceNode.type!];
      if (composerInfo) {
        const nodePlan = (sourceNode.data as Record<string, unknown>)[composerInfo.planField];
        if (nodePlan) {
          upstreamPlanType = composerInfo.planType;
          upstreamPlan = nodePlan as Record<string, unknown>;
          break;
        }
      }
    }

    if (upstreamPlan) {
      if (upstreamPlanType === "scene-graph") {
        return runProcessingNode(
          node.id,
          () => renderVideoWithSceneGraph({
            sceneGraph: upstreamPlan!,
            userId: ctx.userId,
          }),
          "generatedVideoUrl",
          "Render Video",
          ctx,
        );
      }
      return runProcessingNode(
        node.id,
        () => renderVideoWithPlan({
          planType: upstreamPlanType!,
          plan: upstreamPlan!,
          userId: ctx.userId,
        }),
        "generatedVideoUrl",
        "Render Video",
        ctx,
      );
    }

    const mediaAssets = collectMediaAssets(node, edges, nodes);
    if (mediaAssets.length === 0) {
      toast.error(`Node "${d.label}": no media assets connected`);
      return Promise.reject(new Error("No media assets"));
    }
    const autoSceneGraph = buildAutoComposition(
      mediaAssets,
      d.fps,
      d.durationSeconds,
      d.aspectRatio,
      d.backgroundColor,
    );
    return runProcessingNode(
      node.id,
      () => renderVideoWithSceneGraph({
        sceneGraph: autoSceneGraph,
        userId: ctx.userId,
      }),
      "generatedVideoUrl",
      "Render Video",
      ctx,
    );
  }

  if (node.type === "character") {
    const charData = node.data as CharacterNodeData;
    if (!charData.characterName) {
      toast.error(`Node "${charData.label}": no character name set`);
      return Promise.reject(new Error("No character name"));
    }
    return runCharacterGeneration(node.id, charData, ctx);
  }

  if (node.type === "face") {
    const faceData = node.data as FaceNodeData;
    if (!faceData.faceName) {
      toast.error(`Node "${faceData.label}": no face name set`);
      return Promise.reject(new Error("No face name"));
    }
    const sourceImageUrl = faceData.sourceImageUrl || inputs.imageUrl;
    if (!sourceImageUrl) {
      toast.error(`Node "${faceData.label}": no reference photo uploaded`);
      return Promise.reject(new Error("No reference photo"));
    }
    return runFaceGeneration(node.id, { ...faceData, sourceImageUrl }, ctx);
  }

  if (node.type === "object") {
    const objData = node.data as ObjectNodeData;
    if (!objData.objectName) {
      toast.error(`Node "${objData.label}": no object name set`);
      return Promise.reject(new Error("No object name"));
    }
    return runObjectGeneration(node.id, objData, ctx);
  }

  if (node.type === "location") {
    const locData = node.data as LocationNodeData;
    if (!locData.locationName) {
      toast.error(`Node "${locData.label}": no location name set`);
      return Promise.reject(new Error("No location name"));
    }
    return runLocationGeneration(node.id, locData, ctx);
  }

  if (node.type === "scene") {
    const sceneData = node.data as unknown as SceneNodeDataType;
    const {
      nodes: allNodes,
      edges: allEdges,
      characterDefinitions,
    } = useWorkflowStore.getState();

    const sceneInputs = resolveNodeInputs(node, allNodes, allEdges);
    const connectedPrompt = sceneInputs.prompt ?? "";

    const sceneStylePrompt = buildScenePrompt(
      sceneData,
      characterDefinitions,
    );

    let combinedPrompt = connectedPrompt
      ? `${connectedPrompt}. ${sceneStylePrompt}`
      : sceneStylePrompt;

    if (!combinedPrompt.trim()) {
      toast.error(
        `Scene "${sceneData.sceneName || sceneData.label}": no scene data to generate prompt`,
      );
      return Promise.reject(new Error("Empty scene prompt"));
    }

    const allAssetIds = [
      ...sceneData.characters.map((c) => c.assetId),
      ...(sceneData.locations ?? []).map((l) => l.assetId),
      ...sceneData.objects.map((o) => o.assetId),
    ];
    const refUrls: string[] = [...(sceneInputs.referenceImageUrls ?? [])];
    const charDescs: string[] = [];
    const sceneUserTemplates =
      useWorkflowStore.getState().userPromptTemplates;
    const sceneFlowTemplates =
      useWorkflowStore.getState().flowPromptTemplates;
    for (const assetId of allAssetIds) {
      const asset = characterDefinitions.find((a) => a.id === assetId);
      if (asset?.referenceImageUrl) refUrls.push(asset.referenceImageUrl);
      if (asset?.type === "description" && asset.description) {
        const templateKey =
          asset.category === "face"
            ? "face-description"
            : asset.category === "location"
              ? "location-description"
              : asset.category === "object"
                ? "object-description"
                : "character-description";
        const template = resolveTemplate(
          templateKey,
          sceneUserTemplates,
          sceneFlowTemplates,
        );
        charDescs.push(
          applyTemplate(template, {
            name: asset.name,
            description: asset.description,
          }),
        );
      }
    }
    const finalPrompt =
      charDescs.length > 0
        ? `${combinedPrompt}\n${charDescs.join(" ")}`
        : combinedPrompt;
    const sceneAspectRatio = (sceneData as Record<string, unknown>)
      .aspectRatio as string | undefined;
    return runImageGeneration(
      node.id,
      finalPrompt,
      ctx,
      refUrls.length > 0 ? refUrls : undefined,
      undefined,
      sceneAspectRatio,
    );
  }

  if (node.type === "combine-text") {
    const {
      nodes: currentNodes,
      edges: currentEdges,
      updateNodeData,
    } = useWorkflowStore.getState();
    const combineData = node.data as CombineTextNodeData;

    const separatorMap: Record<string, string> = {
      newline: "\n",
      "double-newline": "\n\n",
      comma: ", ",
      space: " ",
      custom: combineData.customSeparator ?? "",
    };
    const sep = separatorMap[combineData.separator] ?? "\n";

    const incomingEdges = currentEdges.filter((e) => e.target === node.id);
    const textParts: string[] = [];

    for (const edge of incomingEdges) {
      const sourceNode = currentNodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;

      const srcData = sourceNode.data as Record<string, unknown>;
      const listResults = srcData.__listResults as string[] | undefined;

      if (listResults && listResults.length > 0) {
        for (const item of listResults) {
          if (item?.trim()) textParts.push(item.trim());
        }
        continue;
      }

      const output = extractNodeOutput(sourceNode);
      if (output?.trim()) textParts.push(output.trim());
    }

    const combinedText = textParts.join(sep);
    updateNodeData(node.id, {
      combinedText,
      executionStatus: "completed",
    });
    return Promise.resolve();
  }

  if (node.type === "split-text") {
    const {
      nodes: currentNodes,
      edges: currentEdges,
      updateNodeData,
    } = useWorkflowStore.getState();
    const splitData = node.data as SplitTextData;
    const separator = splitData.separator || "===NEXT===";

    const incomingEdges = currentEdges.filter((e) => e.target === node.id);
    let inputText = "";

    for (const edge of incomingEdges) {
      const sourceNode = currentNodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;
      const output = extractNodeOutput(sourceNode);
      if (output) inputText += output;
    }

    if (!inputText) {
      updateNodeData(node.id, {
        executionStatus: "failed",
        errorMessage: "No input text received",
      });
      return Promise.resolve();
    }

    let parts = inputText.split(separator);

    if (splitData.trimWhitespace !== false) {
      parts = parts.map((p) => p.trim());
    }
    if (splitData.removeEmpty !== false) {
      parts = parts.filter((p) => p.length > 0);
    }

    updateNodeData(node.id, {
      splitResults: parts,
      executionStatus: "completed",
      errorMessage: undefined,
      __listResults: [...parts],
      __listTotal: parts.length,
    });
    return Promise.resolve();
  }

  // Webhook Output — collect upstream data and POST to configured URL
  if (node.type === "webhook-output") {
    const {
      nodes: currentNodes,
      edges: currentEdges,
      updateNodeData,
    } = useWorkflowStore.getState();
    const whData = node.data as Record<string, unknown>;
    const url = (whData.url as string)?.trim();
    const params = (whData.params as Array<{ id: string; name: string; type: string }>) ?? [];

    if (!url) {
      updateNodeData(node.id, { executionStatus: "failed", errorMessage: "No webhook URL configured" });
      return Promise.resolve();
    }

    // Build payload from upstream connections
    const payload: Record<string, unknown> = {};
    const incomingEdges = currentEdges.filter((e) => e.target === node.id);

    if (params.length > 0) {
      for (const param of params) {
        const edge = incomingEdges.find((e) => e.targetHandle === param.id);
        if (!edge) continue;
        const sourceNode = currentNodes.find((n) => n.id === edge.source);
        if (!sourceNode) continue;
        const output = extractNodeOutput(sourceNode);
        if (output) payload[param.name] = output;
      }
    } else {
      for (const edge of incomingEdges) {
        const sourceNode = currentNodes.find((n) => n.id === edge.source);
        if (!sourceNode) continue;
        const output = extractNodeOutput(sourceNode);
        if (output) payload[sourceNode.type ?? "data"] = output;
      }
    }

    updateNodeData(node.id, { executionStatus: "running" });
    return import("@/lib/api").then(({ sendWebhookOutput }) =>
      sendWebhookOutput({ url, payload }).then(
        () => { updateNodeData(node.id, { executionStatus: "completed" }); },
        (err) => {
          updateNodeData(node.id, {
            executionStatus: "failed",
            errorMessage: err instanceof Error ? err.message : "Webhook send failed",
          });
        },
      ),
    );
  }

  // Social Media Post — publish to connected platform
  if (
    node.type === "instagram-post" ||
    node.type === "tiktok-post" ||
    node.type === "youtube-upload" ||
    node.type === "linkedin-post" ||
    node.type === "x-post" ||
    node.type === "facebook-post"
  ) {
    const { updateNodeData } = useWorkflowStore.getState();
    const d = node.data as SocialPostData;
    const mediaUrl = overrideMediaUrl ?? inputs.videoUrl ?? inputs.imageUrl ?? inputs.audioUrl;

    updateNodeData(node.id, { executionStatus: "running", errorMessage: undefined });

    return import("@/lib/api").then(({ socialPublishApi }) =>
      socialPublishApi({
        platform: d.platform,
        action: d.action,
        connectionId: d.connectionId,
        mediaUrl,
        caption: d.caption || undefined,
        title: d.title || undefined,
        description: d.description || undefined,
        tags: d.tags,
        privacy: d.privacy,
      }).then(
        (result) => {
          updateNodeData(node.id, {
            executionStatus: "completed",
            platformPostId: result.platformPostId,
            platformPostUrl: result.platformPostUrl,
          });
        },
        (err) => {
          updateNodeData(node.id, {
            executionStatus: "failed",
            errorMessage: err instanceof Error ? err.message : "Social publish failed",
          });
          throw err;
        },
      ),
    );
  }

  // Sub-Workflow — delegates to the sub-workflow executor
  if (node.type === "sub-workflow") {
    return import("./sub-workflow-executor").then(({ executeSubWorkflow }) =>
      executeSubWorkflow(node, ctx),
    )
  }

  return Promise.resolve();
}
