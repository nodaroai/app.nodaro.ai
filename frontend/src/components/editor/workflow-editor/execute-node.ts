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
  sunoMashupApi,
  sunoReplaceSectionApi,
  sunoStyleBoostApi,
  sunoAddInstrumentalApi,
  sunoAddVocalsApi,
  sunoConvertWavApi,
  sunoUploadExtendApi,
  transcribeApi,
  imageToTextApi,
  voiceChangerApi,
  dubbingApi,
  voiceRemixApi,
  voiceDesignApi,
  forcedAlignmentApi,
  downloadYouTubeAudio,
  lipSyncApi,
  speechToVideoApi,
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
  trimAudioApi,
  splitMediaApi,
  trimVideoApi,
  extractFrameApi,
  transcodeVideoApi,
  speedRampApi,
  loopVideoApi,
  fadeVideoApi,
  resizeVideoApi,
  socialMediaFormatApi,
  adjustVolumeApi,
  addCaptionsApi,
  mixAudioApi,
  combineAudioApi,
  generateImage,
  getJobStatus,
  generateAIWriterStream,
  llmChatStream,
  setForcePrivate,
  setUserPromptTemplate,
  qaCheckApi,
  saveToStorageApi,
  webScrape,
} from "@/lib/api";
import { resolveTemplate, applyTemplate } from "@/lib/prompt-templates";
import { ASPECT_RATIO_DIMENSIONS, COMPOSER_PLAN_MAP, VIDEO_INPUT_LIP_SYNC_PROVIDERS, FLEXIBLE_INPUT_LIP_SYNC_PROVIDERS, isSeedance2Provider } from "@nodaro/shared";
import { getAIWriterTemplate } from "@/lib/ai-writer-templates";
import { buildScenePrompt } from "@/lib/prompt-builder";
import type {
  WorkflowNode,
  GenerateScriptData,
  GenerateImageData,
  EditImageData,
  ImageToImageData,
  ModifyImageData,
  UpscaleImageData,
  RemoveBackgroundData,
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
  SunoMashupData,
  SunoReplaceSectionData,
  SunoStyleBoostData,
  SunoAddInstrumentalData,
  SunoAddVocalsData,
  SunoConvertWavData,
  SunoUploadExtendData,
  TranscribeData,
  ImageToTextData,
  AIWriterNodeData,
  LLMChatData,
  LipSyncData,
  SpeechToVideoData,
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
  TrimAudioData,
  SplitMediaData,
  TrimVideoData,
  ExtractFrameData,
  TranscodeVideoData,
  ManualEditData,
  SpeedRampData,
  LoopVideoData,
  FadeVideoData,
  ResizeVideoData,
  AdjustVolumeData,
  AddCaptionsData,
  MixAudioData,
  CombineAudioData,
  CharacterNodeData,
  FaceNodeData,
  ObjectNodeData,
  LocationNodeData,
  SceneNodeDataType,
  CombineTextNodeData,
  SplitTextData,
  PreviewNodeData,
  VoiceChangerData,
  DubbingData,
  VoiceRemixData,
  VoiceDesignData,
  ForcedAlignmentData,
  SubWorkflowData,
  SocialMediaFormatData,
  SocialPostData,
  SaveToStorageData,
  QACheckData,
  GeneratedResult,
  WebScrapeNodeData,
  ExtractFieldNodeData,
  JsonProcessNodeData,
  FilterListNodeData,
  FilterListCondition,
  RouterNodeData,
  DeduplicateNodeData,
  MergeListsNodeData,
  SortListNodeData,
} from "@/types/nodes";
import {
  WorkflowStaleError,
  MAX_CONSECUTIVE_POLL_FAILURES,
  checkStorageError,
  updateProgressIfChanged,
  type ExecutionContext,
} from "./types";
import { PLATFORM_SPECS } from "@/lib/social-media-specs";
import { extractNodeOutput, collectMediaAssets, buildAutoComposition, collectAncestorRefs, IMAGE_SOURCE_TYPES, VIDEO_SOURCE_TYPES_FOR_RENDER, AUDIO_SOURCE_TYPES } from "./execution-graph";
import { resolveNodeInputs, extractNodeOutputAsList, resolveSourceThroughConnectedList, type FrontendResolvedInputs } from "./node-input-resolver";
import { collectPreviewItems } from "./preview-items";
import { buildNodeRefMap, resolveTextRefs } from "@/lib/node-refs";
import { resolveFieldMappings, NODE_MAPPABLE_FIELDS } from "./resolve-field-mappings";
import { pollJobWithNodeUpdate, guardedToast } from "./poll-job";
import {
  runImageGeneration,
  runEditImage,
  runImageToImage,
  runModifyImage,
  runUpscaleImage,
  runRemoveBackground,
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
import { buildImagePrompt } from "@nodaro/shared";
import type { CharacterDef, ConnectedReference, ReferenceSource } from "@nodaro/shared";
import { collectIdentityLockClause } from "@nodaro/shared";
import { resolveSeparator } from "@nodaro/shared";
import { evaluateJsonPath, stringifyPathResults } from "@nodaro/shared";
import { spreadJsonArrayIfSingleton } from "@nodaro/shared";
import { zipMergeLists } from "@nodaro/shared";
import { evaluateJsonExpression, buildExpressionFromVisual, jsonResultToList } from "@nodaro/shared";
import {
  tryParseJson,
  evaluateCondition,
  evaluateConditionGroup,
  resolveConditionValue,
} from "@nodaro/shared";
import { sortListItems } from "@nodaro/shared";
import { buildConditionVariables, VARIABLES_HANDLE_ID } from "@nodaro/shared";
import { collectCinematographyHints, hasConnectedStyleNode, STILL_IMAGE_EXCLUDE_TYPES } from "@/lib/cinematography-hints";
import { collectAudioStyleHints, truncateForField, appendField } from "@/lib/audio-style-hints";
import { getEffectiveSunoCustomMode } from "@nodaro/shared";
import { applyMediaOrder } from "../config-panels/connected-media-list";
import {
  getUpstreamDuration,
  getCombineUpstreamDurations,
} from "@/lib/upstream-duration";

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

// Cinematography hint aggregation lives in `@/lib/cinematography-hints` —
// both the DAG executor and UI preview components import it from there.

/**
 * Alias for pollJobWithNodeUpdate to match original codebase naming.
 * Used for node types that follow the standard poll-to-completion pattern.
 */
/** Extract sunoTrackId/sunoTaskId from job output_data for downstream Suno node chaining. */
const extractSunoOutputFields = (od: Record<string, unknown>) => ({
  sunoTrackId: od.sunoTrackId as string | undefined,
  sunoTaskId: od.sunoTaskId as string | undefined,
});

/** Extract Suno taskId/audioId from inputs or node data, returning null if missing. */
function resolveSunoIds(
  inputs: FrontendResolvedInputs,
  data: Record<string, unknown>,
): { taskId: string; audioId: string } | null {
  const taskId = (inputs.sunoTaskId as string | undefined) ?? (data.taskId as string | undefined);
  const audioId = (inputs.sunoTrackId as string | undefined) ?? (data.audioId as string | undefined);
  if (!taskId || !audioId) return null;
  return { taskId, audioId };
}

function runProcessingNode(
  nodeId: string,
  apiCall: () => Promise<{ jobId: string }>,
  outputKey: "generatedVideoUrl" | "generatedAudioUrl" | "generatedImageUrl",
  label: string,
  ctx: ExecutionContext,
  extraOutputFields?: (
    outputData: Record<string, unknown>,
  ) => Record<string, unknown>,
): Promise<string> {
  return pollJobWithNodeUpdate(nodeId, apiCall, outputKey, label, ctx, extraOutputFields);
}

/**
 * Build the request params for the /v1/web-scrape endpoint from node data.
 *
 * Kept as a pure, exported function so it's testable without a full
 * executor harness — the RSS field-dropping bug could have been caught here
 * with a one-line assertion. Each actor reuses a small, overlapping set of
 * config keys (url / query / target + resultsLimit / maxResults) and the
 * mapping is purely declarative.
 *
 * `upstream` is the prompt value flowing in from upstream text so users can
 * wire a Text Prompt → Web Scrape without re-typing URLs/queries.
 */
export function buildWebScrapeParams(
  data: WebScrapeNodeData,
  upstream: string | undefined,
): Parameters<typeof webScrape>[0] {
  const actor = data.actor ?? "google-search";
  const params: Parameters<typeof webScrape>[0] = { actor };
  switch (actor) {
    case "content-crawler":
      params.url = data.url || upstream;
      params.mode = data.mode ?? "page";
      break;
    case "google-search":
      params.query = data.query || upstream;
      params.maxResults = data.maxResults;
      params.countryCode = data.countryCode;
      break;
    case "instagram":
    case "tiktok":
      params.target = data.target || upstream;
      params.resultsLimit = data.resultsLimit;
      break;
    case "rss":
      // RSS reuses the same `url` node-data key as content-crawler and the
      // `resultsLimit` key as instagram/tiktok. The previous ternary-ladder
      // implementation only set url for content-crawler and resultsLimit
      // for instagram/tiktok, so running the RSS actor sent
      // `{ actor: "rss", workflowId }` to the backend and 400'd at Zod.
      params.url = data.url || upstream;
      params.resultsLimit = data.resultsLimit;
      break;
  }
  return params;
}

// ---------------------------------------------------------------------------
// Helpers for list-processing inline nodes: filter-list, deduplicate, merge-lists
// ---------------------------------------------------------------------------

function collectItemsForEdgeFrontend(
  edge: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null },
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>,
): string[] {
  if (edge.targetHandle === VARIABLES_HANDLE_ID) return [];
  const resolvedEdge = resolveSourceThroughConnectedList(edge, nodes, edges);
  const src = nodes.find((n) => n.id === resolvedEdge.source);
  if (!src) return [];
  // extractNodeOutputAsList handles split-text, list, generatedJson arrays
  // (web-scrape), generatedResults, and __listResults — same coverage as the
  // backend collector. Mirrors inline-executor.ts:collectItemsForEdge.
  const listItems = extractNodeOutputAsList(src);
  if (listItems && listItems.length > 0) {
    return listItems.filter((item): item is string => item != null);
  }
  const primary = extractNodeOutput(src, resolvedEdge.sourceHandle ?? undefined);
  return primary != null && primary !== "" ? [primary] : [];
}

function collectUpstreamListItemsFrontend(
  nodeId: string,
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>,
  nodes: ReadonlyArray<WorkflowNode>,
): string[] {
  const items: string[] = [];
  const incoming = edges.filter((e) => e.target === nodeId);
  for (const edge of incoming) {
    items.push(...collectItemsForEdgeFrontend(edge, nodes, edges));
  }
  return spreadJsonArrayIfSingleton(items);
}

function collectUpstreamListsPerEdgeFrontend(
  nodeId: string,
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>,
  nodes: ReadonlyArray<WorkflowNode>,
): string[][] {
  return edges
    .filter((e) => e.target === nodeId)
    .map((edge) => spreadJsonArrayIfSingleton(collectItemsForEdgeFrontend(edge, nodes, edges)));
}

export function resolveFilterConditionValue(raw: string, valueType: string | undefined): string {
  return resolveConditionValue(raw, valueType);
}

/**
 * Main node execution dispatch. Routes each node type to its executor.
 * Accepts optional overrides for list execution chaining.
 */
const UPLOAD_NODE_TYPES = new Set(["upload-image", "upload-video", "upload-audio"]);

/** Check if a node has any upload-* ancestors via BFS backward through edges. */
function hasUploadAncestor(nodeId: string, nodes: readonly { id: string; type: string }[], edges: readonly { source: string; target: string }[]): boolean {
  // Build parent map once: target → source IDs
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    const list = parents.get(edge.target) ?? [];
    list.push(edge.source);
    parents.set(edge.target, list);
  }
  const nodeTypeMap = new Map(nodes.map((n) => [n.id, n.type]));

  const visited = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const srcId of parents.get(current) ?? []) {
      const srcType = nodeTypeMap.get(srcId);
      if (srcType && UPLOAD_NODE_TYPES.has(srcType)) return true;
      queue.push(srcId);
    }
  }
  return false;
}

export function executeNode(
  node: WorkflowNode,
  ctx: ExecutionContext,
  overridePrompt?: string,
  overrideMediaUrl?: string,
  listIterationIndex?: number,
  runId?: string,
): Promise<string> {
  const { nodes, edges } = useWorkflowStore.getState();
  const inputs = resolveNodeInputs(node, nodes, edges, listIterationIndex);

  // Set forcePrivate flag if this node uses uploaded/private content as input.
  // The flag is module-global; it survives the sync path from here to the API
  // wrapper's synchronous body-build + withWorkflowId consumption. Any branch
  // below that awaits before its API call must re-apply this (see transcribe).
  const forcePrivate = hasUploadAncestor(node.id, nodes, edges);
  setForcePrivate(forcePrivate);

  // Build label→output map for resolving {Node Label} references in text fields
  const refMap = buildNodeRefMap(node.id, nodes, edges);
  // Resolve refs in upstream-provided prompt so downstream code sees clean text
  if (inputs.prompt && refMap.size > 0) {
    inputs.prompt = resolveTextRefs(inputs.prompt, refMap) ?? inputs.prompt;
  }
  // Also resolve refs in the override prompt from list fan-out
  if (overridePrompt && refMap.size > 0) {
    overridePrompt = resolveTextRefs(overridePrompt, refMap) ?? overridePrompt;
  }

  // --- Field mapping resolution + {} injection (centralized) ---
  const mappableFields = NODE_MAPPABLE_FIELDS[node.type ?? ""]
  if (mappableFields?.length) {
    const upstreamText = overridePrompt ?? inputs.prompt
    const resolvedData = resolveFieldMappings(
      node.data as Record<string, unknown>,
      nodes,
      upstreamText,
      mappableFields,
    )
    node = { ...node, data: resolvedData } as WorkflowNode
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
    setUserPromptTemplate(undefined);
    return runScriptGeneration(
      node.id,
      prompt,
      ctx,
      scriptData.sceneCount,
      scriptData.tone || undefined,
      scriptData.targetLength || undefined,
      scriptData.provider || undefined,
      scriptData.llmModel || undefined,
    );
  }

  if (node.type === "generate-image") {
    const imgData = node.data as GenerateImageData;
    const providerKey = imgData.provider || "nano-banana-pro";

    // Build a rich, ordered list of connected references (manual + wired + char)
    // with source-type and default-name metadata. This drives both the
    // referenceImageUrls array sent to the provider and the fidelity blocks
    // injected into the final prompt.
    const refMetaMap = new Map<string, Omit<ConnectedReference, "id">>();

    // Manual uploads (new multi-image format)
    const manualImgs = imgData.referenceImageUrls ?? [];
    for (let i = 0; i < manualImgs.length; i++) {
      const img = manualImgs[i];
      refMetaMap.set(img.id, {
        defaultName: `Image ${i + 1}`,
        source: "manual",
        url: img.url,
      });
    }
    // Legacy single referenceImageUrl
    if (imgData.referenceImageUrl && refMetaMap.size === 0) {
      refMetaMap.set("__legacy__", {
        defaultName: "Image 1",
        source: "manual",
        url: imgData.referenceImageUrl,
      });
    }
    // Wired upstream images — include char/face/object/location for rich metadata
    const chainRefs =
      inputs.referenceImageUrls ??
      (inputs.imageUrl ? [inputs.imageUrl] : undefined);
    if (chainRefs) {
      const incomingEdges = edges.filter((e) => e.target === node.id);
      const wiredSourceTypeMap: Record<string, ReferenceSource> = {
        "upload-image": "wired-image",
        "generate-image": "wired-image",
        "edit-image": "wired-image",
        "image-to-image": "wired-image",
        "modify-image": "wired-image",
        "upscale-image": "wired-image",
        "remove-background": "wired-image",
        "character": "wired-character",
        "face": "wired-face",
        "object": "wired-object",
        "location": "wired-location",
      };
      const wiredSourceNodes = incomingEdges
        .map((e) => nodes.find((n) => n.id === e.source))
        .filter((n): n is WorkflowNode => Boolean(n && n.type && n.type in wiredSourceTypeMap));
      for (let i = 0; i < chainRefs.length; i++) {
        const upstream = wiredSourceNodes[i];
        if (upstream) {
          const upstreamData = upstream.data as Record<string, unknown>;
          refMetaMap.set(upstream.id, {
            defaultName: (upstreamData.label as string) || (upstreamData.name as string) || upstream.type!,
            source: wiredSourceTypeMap[upstream.type!],
            description: upstreamData.description as string | undefined,
            url: chainRefs[i],
          });
        } else {
          refMetaMap.set(`wired_${i}`, {
            defaultName: `Wired Image ${i + 1}`,
            source: "wired-image",
            url: chainRefs[i],
          });
        }
      }
    }
    const extractedRefs = (node.data as Record<string, unknown>)
      .extractedReferenceUrls as string[] | undefined;
    if (extractedRefs) {
      for (let i = 0; i < extractedRefs.length; i++) {
        refMetaMap.set(`extracted_${i}`, {
          defaultName: `Extracted ${i + 1}`,
          source: "manual",
          url: extractedRefs[i],
        });
      }
    }
    // Character reference images (from character-definitions store)
    const charIds = imgData.characterDefinitionIds ?? [];
    const allCharDefs = useWorkflowStore.getState().characterDefinitions;
    const charDefs = allCharDefs.filter((c) => charIds.includes(c.id));
    const charCategorySource: Record<string, ReferenceSource> = {
      face: "wired-face",
      object: "wired-object",
      location: "wired-location",
    };
    for (const c of charDefs) {
      if (c.type === "reference" && c.referenceImageUrl) {
        refMetaMap.set(`char_${c.id}`, {
          defaultName: c.name,
          source: charCategorySource[c.category ?? ""] ?? "wired-character",
          description: c.description,
          url: c.referenceImageUrl,
        });
      }
    }

    // Apply ordering: use referenceImageOrder if set, otherwise default map order
    const orderIds = imgData.referenceImageOrder ?? [];
    const connectedReferences: ConnectedReference[] = [];
    const seen = new Set<string>();
    for (const id of orderIds) {
      const meta = refMetaMap.get(id);
      if (meta) {
        connectedReferences.push({ id, ...meta });
        seen.add(id);
      }
    }
    for (const [id, meta] of refMetaMap) {
      if (!seen.has(id)) connectedReferences.push({ id, ...meta });
    }
    const orderedUrls = connectedReferences.map((r) => r.url);

    const ancestorRefs = orderedUrls.length === 0
      ? collectAncestorRefs(node.id, nodes, edges)
      : [];

    // Manual field wins when set — the MappableField dropdown's "Manual"
    // label must actually mean manual. `inputs.prompt` is only used as a
    // fallback when the user hasn't typed anything. fieldMappings resolution
    // (upstream dropdown pick) already ran earlier, so if the user selected
    // a source, `imgData.prompt` holds that source's output.
    const manualImgPrompt = resolveTextRefs(imgData.prompt?.trim(), refMap);
    let prompt = overridePrompt || manualImgPrompt || inputs.prompt;
    // Fold cinematography hints BEFORE the empty check — a Person / Framing /
    // Style node wired to the `cinematography` handle is a perfectly valid
    // prompt source on its own. Requiring a manual prompt in that case would
    // force users to type filler.
    {
      const cinematographyHints = collectCinematographyHints(node.id, nodes, edges, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES });
      if (cinematographyHints.length > 0) {
        const joined = cinematographyHints.join(", ");
        prompt = prompt ? `${prompt}. ${joined}` : joined;
      }
    }
    if (!prompt) {
      toast.error(`Node "${imgData.label}": no prompt — type one or connect a cinematography source`);
      return Promise.reject(new Error("No prompt"));
    }
    {
      const identityClause = collectIdentityLockClause(node.id, nodes, edges);
      if (identityClause) prompt = `${prompt} ${identityClause}`;
    }

    const result = buildImagePrompt({
      prompt,
      provider: providerKey,
      style: hasConnectedStyleNode(node.id, nodes, edges) ? undefined : imgData.style,
      negativePrompt: imgData.negativePrompt,
      userTemplates: useWorkflowStore.getState().userPromptTemplates,
      flowTemplates: useWorkflowStore.getState().flowPromptTemplates,
      connectedReferences,
      identityMeta: imgData.identityMeta ?? [],
      ancestorRefs,
    });

    // Capture the user-typed template (pre-resolution) so it lands in
    // jobs.input_data.userPrompt for debugging.
    setUserPromptTemplate(imgData.prompt?.trim() || undefined);
    return runImageGeneration(
      node.id,
      result.prompt,
      ctx,
      result.referenceImageUrls,
      providerKey,
      imgData.aspectRatio || undefined,
      imgData.resolution || undefined,
      imgData.quality || undefined,
      result.nativeNegativePrompt,
      imgData.seed,
      imgData.renderingSpeed || undefined,
      imgData.styleType || undefined,
      imgData.expandPrompt,
    );
  }

  if ((node.type as string) === "edit-image") {
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

    // Manual wins — user's instruction wins over an upstream text source.
    const manualEditPrompt = resolveTextRefs(editData.prompt?.trim(), refMap);
    let prompt = manualEditPrompt || inputs.prompt || undefined;
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
    {
      const cinematographyHints = collectCinematographyHints(node.id, nodes, edges, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES });
      if (cinematographyHints.length > 0) {
        const joined = cinematographyHints.join(", ");
        prompt = prompt ? `${prompt}. ${joined}` : joined;
      }
    }
    {
      const identityClause = collectIdentityLockClause(node.id, nodes, edges);
      if (identityClause) prompt = prompt ? `${prompt} ${identityClause}` : identityClause;
    }

    // Collect reference images for nano-banana-edit
    const editRefUrls = orderedImageUrls.filter((url) => url !== imageUrl);

    setUserPromptTemplate(editData.prompt?.trim() || undefined);
    return runEditImage(node.id, imageUrl, ctx, prompt, provider, {
      upscaleFactor: editData.upscaleFactor,
      targetResolution: editData.targetResolution,
      aspectRatio: editData.aspectRatio,
      negativePrompt: editData.negativePrompt,
      style: hasConnectedStyleNode(node.id, nodes, edges) ? undefined : editData.style,
      seed: editData.seed,
      referenceImageUrls: editRefUrls.length > 0 ? editRefUrls : undefined,
    });
  }

  if ((node.type as string) === "image-to-image") {
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
    let rawPrompt: string | undefined = i2iData.prompt;
    if (!rawPrompt) {
      toast.error(
        `Node "${i2iData.label}": transformation prompt is required`,
      );
      return Promise.reject(new Error("Transformation prompt is required"));
    }
    const provider = i2iData.provider || "nano-banana";

    {
      const cinematographyHints = collectCinematographyHints(node.id, nodes, edges, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES });
      if (cinematographyHints.length > 0) {
        const joined = cinematographyHints.join(", ");
        rawPrompt = rawPrompt ? `${rawPrompt}. ${joined}` : joined;
      }
    }
    {
      const identityClause = collectIdentityLockClause(node.id, nodes, edges);
      if (identityClause) rawPrompt = `${rawPrompt} ${identityClause}`;
    }

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
      style: hasConnectedStyleNode(node.id, nodes, edges) ? undefined : i2iData.style,
      negativePrompt: i2iData.negativePrompt,
      characterDefs: charDefs as CharacterDef[],
      userTemplates: useWorkflowStore.getState().userPromptTemplates,
      flowTemplates: useWorkflowStore.getState().flowPromptTemplates,
      referenceImageUrls: directRefs,
      ancestorRefs: [],
    });

    // Resolve mask from handle or painted mask
    let maskUrl: string | undefined;
    const maskEdge = edges.find(
      (e) => e.target === node.id && e.targetHandle === "mask",
    );
    if (maskEdge) {
      const maskNode = nodes.find((n) => n.id === maskEdge.source);
      if (maskNode) maskUrl = extractNodeOutput(maskNode);
    }
    if (!maskUrl) maskUrl = i2iData.maskUrl;

    setUserPromptTemplate(i2iData.prompt?.trim() || undefined);
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
        maskUrl,
      },
    );
  }

  if (node.type === "modify-image") {
    const modData = node.data as ModifyImageData;

    // Apply connectedMediaOrder to determine main image vs references
    let orderedImageUrls: string[] = inputs.referenceImageUrls ?? [];
    if (modData.connectedMediaOrder?.length && orderedImageUrls.length > 1) {
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
        modData.connectedMediaOrder,
      );
      orderedImageUrls = reordered
        .map((e) => idToUrl.get(e.id))
        .filter((u): u is string => !!u);
    }

    const imageUrl =
      overrideMediaUrl ?? orderedImageUrls[0] ?? inputs.imageUrl;
    if (!imageUrl) {
      toast.error(
        `Node "${modData.label}": no input image found`,
      );
      return Promise.reject(new Error("No input image"));
    }
    let rawPrompt: string | undefined = modData.prompt;
    if (!rawPrompt) {
      toast.error(
        `Node "${modData.label}": transformation prompt is required`,
      );
      return Promise.reject(new Error("Transformation prompt is required"));
    }
    const provider = modData.provider || "nano-banana";

    {
      const cinematographyHints = collectCinematographyHints(node.id, nodes, edges, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES });
      if (cinematographyHints.length > 0) {
        const joined = cinematographyHints.join(", ");
        rawPrompt = rawPrompt ? `${rawPrompt}. ${joined}` : joined;
      }
    }
    {
      const identityClause = collectIdentityLockClause(node.id, nodes, edges);
      if (identityClause) rawPrompt = `${rawPrompt} ${identityClause}`;
    }

    // Collect reference images from connected nodes + character assets
    const chainRefs = orderedImageUrls.filter((url) => url !== imageUrl);
    const charIds = modData.characterDefinitionIds ?? [];
    const allCharDefs = useWorkflowStore.getState().characterDefinitions;
    const charDefs = allCharDefs.filter((c) => charIds.includes(c.id));
    const charRefUrls = charDefs
      .filter((c) => c.type === "reference" && c.referenceImageUrl)
      .map((c) => c.referenceImageUrl as string);
    const nodeRefUrl = modData.referenceImageUrl;
    const directRefs = [
      ...(nodeRefUrl ? [nodeRefUrl] : []),
      ...chainRefs,
      ...charRefUrls,
    ];

    // Build prompt with style + character descriptions
    const styleBypass = hasConnectedStyleNode(node.id, nodes, edges);
    const result = buildImagePrompt({
      prompt: rawPrompt,
      provider,
      style: styleBypass ? undefined : modData.style,
      negativePrompt: modData.negativePrompt,
      characterDefs: charDefs as CharacterDef[],
      userTemplates: useWorkflowStore.getState().userPromptTemplates,
      flowTemplates: useWorkflowStore.getState().flowPromptTemplates,
      referenceImageUrls: directRefs,
      ancestorRefs: [],
    });

    // Resolve mask from handle or painted mask
    let maskUrl: string | undefined;
    const maskEdge = edges.find(
      (e) => e.target === node.id && e.targetHandle === "mask",
    );
    if (maskEdge) {
      const maskNode = nodes.find((n) => n.id === maskEdge.source);
      if (maskNode) maskUrl = extractNodeOutput(maskNode);
    }
    if (!maskUrl) maskUrl = modData.maskUrl;

    setUserPromptTemplate(modData.prompt?.trim() || undefined);
    return runModifyImage(
      node.id,
      imageUrl,
      result.prompt,
      ctx,
      provider,
      result.referenceImageUrls?.length ? result.referenceImageUrls : undefined,
      {
        strength: modData.strength,
        aspectRatio: modData.aspectRatio,
        resolution: modData.resolution,
        quality: modData.quality,
        negativePrompt: result.nativeNegativePrompt,
        seed: modData.seed,
        renderingSpeed: modData.renderingSpeed,
        guidanceScale: modData.guidanceScale,
        maskUrl,
        style: styleBypass ? undefined : modData.style,
      },
    );
  }

  if (node.type === "upscale-image") {
    const upData = node.data as UpscaleImageData;
    const imageUrl = overrideMediaUrl ?? inputs.imageUrl;
    if (!imageUrl) {
      toast.error(
        `Node "${upData.label}": no input image found`,
      );
      return Promise.reject(new Error("No input image"));
    }
    setUserPromptTemplate(undefined);
    return runUpscaleImage(
      node.id,
      imageUrl,
      ctx,
      upData.provider || undefined,
      {
        upscaleFactor: upData.upscaleFactor,
        targetResolution: upData.targetResolution,
      },
    );
  }

  if (node.type === "remove-background") {
    const rbData = node.data as RemoveBackgroundData;
    const imageUrl = overrideMediaUrl ?? inputs.imageUrl;
    if (!imageUrl) {
      toast.error(
        `Node "${rbData.label}": no input image found`,
      );
      return Promise.reject(new Error("No input image"));
    }
    setUserPromptTemplate(undefined);
    return runRemoveBackground(node.id, imageUrl, ctx);
  }

  if (node.type === "image-to-video") {
    const i2vData = node.data as ImageToVideoData;
    const nodeProvider = i2vData.provider;

    let startFrameUrl: string | undefined = overrideMediaUrl ?? inputs.startFrameUrl;
    if (!startFrameUrl) {
      const startEdge = edges.find(
        (e) => e.target === node.id && e.targetHandle === "startFrame",
      );
      if (startEdge) {
        const startNode = nodes.find((n) => n.id === startEdge.source);
        if (startNode && startNode.type !== "loop" && startNode.type !== "list") {
          startFrameUrl = extractNodeOutput(startNode, startEdge.sourceHandle ?? undefined);
        }
        // Loop nodes: already resolved via resolveNodeInputs → inputs.startFrameUrl
      }
    }
    if (!startFrameUrl && i2vData.selectedStartFrameNodeId) {
      const startNode = nodes.find(
        (n) => n.id === i2vData.selectedStartFrameNodeId,
      );
      if (startNode) startFrameUrl = extractNodeOutput(startNode);
    }
    if (!startFrameUrl) startFrameUrl = inputs.imageUrl;

    // VEO reference mode doesn't use start frame — skip the requirement
    const isVeoRefMode = (nodeProvider === "veo3" || nodeProvider === "veo3.1" || nodeProvider === "veo3_lite") && i2vData.veoMode === "reference"
    if (!startFrameUrl && !isVeoRefMode) {
      const debugSources = edges.filter((e) => e.target === node.id).map((e) => `${e.sourceHandle ?? "?"}→${e.targetHandle ?? "?"}`).join(", ")
      toast.error(`Node "${i2vData.label}": no start frame image found (inputs: startFrame=${inputs.startFrameUrl ?? "none"}, imageUrl=${inputs.imageUrl ?? "none"}, edges: ${debugSources || "none"})`);
      return Promise.reject(new Error("No start frame image"));
    }

    let endFrameUrl: string | undefined = inputs.endFrameUrl;
    if (!endFrameUrl) {
      const endEdge = edges.find(
        (e) => e.target === node.id && e.targetHandle === "endFrame",
      );
      if (endEdge) {
        const endNode = nodes.find((n) => n.id === endEdge.source);
        if (endNode) endFrameUrl = extractNodeOutput(endNode, endEdge.sourceHandle ?? undefined);
      }
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

    const referenceImageUrls = inputs.referenceImageUrls as string[] | undefined

    // Manual wins — see gen-image note above.
    let prompt = (resolveTextRefs(i2vData.prompt?.trim() || undefined, refMap) ?? inputs.prompt) as string | undefined;
    // Inject motion + cinematography hints into prompt
    const motionHints: string[] = [];
    if (i2vData.motionEnabled && i2vData.motion) motionHints.push(`${i2vData.motion} motion`);
    const cinematographyHints = collectCinematographyHints(node.id, nodes, edges);
    for (const h of cinematographyHints) motionHints.push(h);
    if (motionHints.length > 0 && prompt) prompt = `${prompt}. ${motionHints.join(", ")}`;
    else if (motionHints.length > 0) prompt = motionHints.join(", ");
    {
      const identityClause = collectIdentityLockClause(node.id, nodes, edges);
      if (identityClause) prompt = prompt ? `${prompt} ${identityClause}` : identityClause;
    }
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
    const referenceVideoUrls = inputs.referenceVideoUrls as string[] | undefined
    const referenceAudioUrls = inputs.referenceAudioUrls as string[] | undefined
    // Seedance 2 accepts aspect_ratio + resolution in every request. Pickers
    // render a default ("16:9" / "720p") even when `data.aspectRatio` is
    // undefined — which meant submissions from an untouched node dropped
    // both fields silently. Send explicit defaults so the value the user
    // SEES in the picker always matches what KIE receives.
    const isSeedance2I2V = isSeedance2Provider(nodeProvider ?? "")
    const effectiveAspectRatio = i2vData.aspectRatio ?? (isSeedance2I2V ? "16:9" : undefined)
    const effectiveResolution = i2vData.resolution ?? (isSeedance2I2V ? "720p" : undefined)
    setUserPromptTemplate(i2vData.prompt?.trim() || undefined);
    return runVideoGeneration(
      node.id,
      startFrameUrl ?? "",
      ctx,
      endFrameUrl,
      audioUrl,
      nodeProvider || undefined,
      i2vData.generateAudio,
      i2vData.duration,
      prompt,
      kling3Mode,
      kling3Sound,
      effectiveAspectRatio,
      i2vData.multiShot,
      i2vData.shots,
      i2vData.elements,
      i2vNegativePrompt,
      i2vCfgScale,
      effectiveResolution,
      i2vData.grokMode,
      i2vData.videoSize,
      i2vData.seed,
      i2vData.cameraFixed,
      referenceImageUrls?.length ? referenceImageUrls : undefined,
      i2vData.veoMode === "reference" ? "REFERENCE_2_VIDEO" : undefined,
      {
        referenceVideoUrls: referenceVideoUrls?.length ? referenceVideoUrls : undefined,
        referenceAudioUrls: referenceAudioUrls?.length ? referenceAudioUrls : undefined,
        webSearch: i2vData.webSearch,
        nsfwChecker: i2vData.nsfwChecker,
        enableTranslation: i2vData.enableTranslation,
        loopTrim: i2vData.loopTrim,
      },
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
    const dataPrompt = resolveTextRefs(
      typeof v2vData.prompt === "string" ? v2vData.prompt.trim() : undefined,
      refMap,
    );
    // Manual wins — see gen-image note above.
    let prompt = dataPrompt || inputPrompt;
    {
      const cinematographyHints = collectCinematographyHints(node.id, nodes, edges);
      if (cinematographyHints.length > 0) {
        const joined = cinematographyHints.join(", ");
        prompt = prompt ? `${prompt}. ${joined}` : joined;
      }
    }
    {
      const identityClause = collectIdentityLockClause(node.id, nodes, edges);
      if (identityClause) prompt = prompt ? `${prompt} ${identityClause}` : identityClause;
    }
    const provider =
      typeof v2vData.provider === "string" ? v2vData.provider : undefined;
    const v2vManualPrompt = typeof v2vData.prompt === "string" ? v2vData.prompt.trim() : undefined;
    setUserPromptTemplate(v2vManualPrompt || undefined);
    return runVideoToVideoGeneration(
      node.id,
      sourceVideoUrl,
      ctx,
      prompt,
      provider,
      {
        duration: v2vData.v2vDuration,
        resolution: v2vData.v2vResolution,
        audio: v2vData.audio,
        multiShots: v2vData.multiShots,
        aspectRatio: v2vData.aspectRatio,
        seed: v2vData.seed,
        referenceImageUrl: typeof inputs.referenceImageUrls === "string" ? inputs.referenceImageUrls : Array.isArray(inputs.referenceImageUrls) ? inputs.referenceImageUrls[0] : undefined,
      },
    );
  }

  if (node.type === "text-to-video") {
    const t2vData = node.data as TextToVideoData;
    // Manual wins — see gen-image note above.
    let prompt =
      overridePrompt ??
      resolveTextRefs(t2vData.prompt?.trim(), refMap) ??
      (typeof inputs.prompt === "string" ? inputs.prompt : undefined);
    {
      const cinematographyHints = collectCinematographyHints(node.id, nodes, edges);
      if (cinematographyHints.length > 0) {
        const joined = cinematographyHints.join(", ");
        prompt = prompt ? `${prompt}. ${joined}` : joined;
      }
    }
    if (!prompt) {
      toast.error(`Node "${t2vData.label}": no prompt — type one or connect a cinematography source`);
      return Promise.reject(new Error("No prompt"));
    }
    {
      const identityClause = collectIdentityLockClause(node.id, nodes, edges);
      if (identityClause) prompt = `${prompt} ${identityClause}`;
    }
    const t2vProvider = t2vData.provider || "seedance-2-fast";
    const t2vRaw = t2vData as Record<string, unknown>;
    const isKlingVariant =
      t2vProvider === "kling" ||
      t2vProvider === "kling-turbo" ||
      t2vProvider === "kling-3.0";
    const isSeedance2T2V = isSeedance2Provider(t2vProvider)
    const t2vRefImages = inputs.referenceImageUrls as string[] | undefined
    const t2vRefVideos = inputs.referenceVideoUrls as string[] | undefined
    const t2vRefAudios = inputs.referenceAudioUrls as string[] | undefined
    const seedance2Extras = isSeedance2T2V
      ? {
          resolution: (t2vRaw.resolution as string | undefined) ?? "720p",
          generateAudio: (t2vRaw.generateAudio as boolean | undefined) ?? true,
          referenceImageUrls: t2vRefImages?.length ? t2vRefImages : undefined,
          referenceVideoUrls: t2vRefVideos?.length ? t2vRefVideos : undefined,
          referenceAudioUrls: t2vRefAudios?.length ? t2vRefAudios : undefined,
          webSearch: (t2vRaw.webSearch as boolean | undefined) ?? false,
          nsfwChecker: t2vRaw.nsfwChecker as boolean | undefined,
        }
      : {};
    // Pickers show "16:9" / "720p" as defaults but don't persist them to
    // data until the user actively picks — so an untouched Seedance 2 node
    // silently submits without aspectRatio/resolution. Fill the defaults
    // explicitly so the request matches what the user sees.
    const effectiveT2vAspect = (t2vData.aspectRatio as string | undefined) ?? (isSeedance2T2V ? "16:9" : undefined)
    const t2vOptions = isKlingVariant
      ? {
          duration: t2vData.duration,
          mode: t2vRaw.kling3Mode as string | undefined,
          sound: t2vRaw.kling3Sound as boolean | undefined,
          negativePrompt: t2vData.negativePrompt || undefined,
          cfgScale: t2vRaw.cfgScale as number | undefined,
          aspectRatio: effectiveT2vAspect,
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
      : {
          duration: t2vData.duration,
          aspectRatio: effectiveT2vAspect,
          negativePrompt: t2vData.negativePrompt || undefined,
          seed: t2vRaw.seed as number | undefined,
          enableTranslation: t2vData.enableTranslation,
          ...seedance2Extras,
        };
    setUserPromptTemplate(t2vData.prompt?.trim() || undefined);
    return runTextToVideoGeneration(
      node.id,
      prompt,
      ctx,
      t2vProvider,
      t2vOptions,
    );
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
    setUserPromptTemplate(ttsData.directText?.trim() || undefined);
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
    // Manual wins — see gen-image note above.
    const prompt =
      overridePrompt ??
      resolveTextRefs((node.data as GenerateMusicData).prompt?.trim(), refMap) ??
      inputs.prompt;
    if (!prompt) {
      toast.error(
        `Node "${(node.data as GenerateMusicData).label}": no prompt found`,
      );
      return Promise.reject(new Error("No prompt"));
    }
    const d = node.data as GenerateMusicData;
    const refUrl = inputs.audioUrl || d.referenceAudioUrl || undefined;
    // Fold connected Sound nodes (music-genre / music-mood / instrumentation)
    // into the prompt and — for minimax — into the typed genre/mood/instrumental
    // fields. Other providers receive prompt-only.
    const audioStyle = collectAudioStyleHints(node, "generate-music", nodes, edges);
    const composedPrompt = truncateForField(audioStyle.text, prompt, 2000);
    const finalPrompt = appendField(prompt, composedPrompt);
    const finalGenre = (d.genre || audioStyle.fields.genre) ?? "";
    const finalMood  = (d.mood  || audioStyle.fields.mood)  ?? "";
    const finalInstrumental = d.instrumental || audioStyle.fields.instrumental || false;
    setUserPromptTemplate(d.prompt?.trim() || undefined);
    return runProcessingNode(
      node.id,
      () =>
        generateMusicApi(
          finalPrompt,
          d.provider || undefined,
          d.duration || undefined,
          finalGenre || undefined,
          finalMood || undefined,
          finalInstrumental,
          d.lyrics || undefined,
          refUrl,
          ctx.userId,
          d.modelVersion || undefined,
        ),
      "generatedAudioUrl",
      "Generate Music",
      ctx,
    );
  }

  if (node.type === "text-to-audio") {
    // Manual wins — see gen-image note above.
    const prompt =
      overridePrompt ??
      resolveTextRefs((node.data as TextToAudioData).prompt?.trim(), refMap) ??
      inputs.prompt;
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
    // Fold connected Sound nodes (music-genre / music-mood / instrumentation)
    // into the SFX prompt with a 2000-char budget.
    const audioStyle = collectAudioStyleHints(node, "text-to-audio", nodes, edges);
    const composedPrompt = truncateForField(audioStyle.text, prompt, 2000);
    const finalPrompt = appendField(prompt, composedPrompt);
    setUserPromptTemplate(d.prompt?.trim() || undefined);
    return runProcessingNode(
      node.id,
      () =>
        textToAudioApi(
          finalPrompt,
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
    setUserPromptTemplate(undefined);
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
    let dialogue = d.dialogue?.filter((l) => l.text.trim());

    // Auto-fill from connected generate-script if dialogue is empty
    if ((!dialogue || dialogue.length === 0) && inputs.dialogueLines && inputs.dialogueLines.length > 0) {
      dialogue = inputs.dialogueLines.map((line) => ({
        id: crypto.randomUUID(),
        text: line.text,
        voice: (d.dialogue?.[0]?.voice) || "",
        voiceLabel: line.speaker,
      }));
    }

    if (!dialogue || dialogue.length === 0) {
      toast.error(`Node "${d.label}": no dialogue lines`);
      return Promise.reject(new Error("No dialogue lines"));
    }
    const dialogueTemplate = (d.dialogue ?? [])
      .map((l) => l.text)
      .join("\n")
      .trim();
    setUserPromptTemplate(dialogueTemplate || undefined);
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
    setUserPromptTemplate(undefined);
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
    setUserPromptTemplate(undefined);
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
    const remixText = inputs.prompt || d.text;
    if (!remixText?.trim()) {
      toast.error(`Node "${d.label}": no preview text provided`);
      return Promise.reject(new Error("No text"));
    }
    if (!d.voiceDescription?.trim()) {
      toast.error(`Node "${d.label}": no voice description provided`);
      return Promise.reject(new Error("No voice description"));
    }
    setUserPromptTemplate(d.voiceDescription?.trim() || undefined);
    return runProcessingNode(
      node.id,
      () =>
        voiceRemixApi(
          remixText,
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
    const designText = inputs.prompt || d.text;
    if (!designText?.trim()) {
      toast.error(`Node "${d.label}": no preview text provided`);
      return Promise.reject(new Error("No text"));
    }
    if (!d.voiceDescription?.trim()) {
      toast.error(`Node "${d.label}": no voice description provided`);
      return Promise.reject(new Error("No voice description"));
    }
    // Fold connected Voice Sound nodes (voice-character / voice-delivery)
    // into the voiceDescription field with a 1000-char budget.
    const audioStyle = collectAudioStyleHints(node, "voice-design", nodes, edges);
    const userVoiceDesc = d.voiceDescription ?? "";
    const composedVoiceDesc = truncateForField(audioStyle.text, userVoiceDesc, 1000);
    const finalVoiceDescription = appendField(userVoiceDesc, composedVoiceDesc);
    setUserPromptTemplate(d.voiceDescription?.trim() || undefined);
    return runProcessingNode(
      node.id,
      () =>
        voiceDesignApi(
          designText,
          finalVoiceDescription,
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
    const alignTranscript = inputs.prompt || d.transcript;
    if (!alignTranscript?.trim()) {
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

    setUserPromptTemplate(d.transcript?.trim() || undefined);
    return new Promise<string>((resolve, reject) => {
      forcedAlignmentApi(audioUrl, alignTranscript, ctx.userId)
        .then(({ jobId }) => {
          guardedToast.info("Forced alignment started", { description: `Job ID: ${jobId}` });
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
                  updateProgressIfChanged(node.id, job.progress, updateNodeData);
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
                  guardedToast.success("Forced alignment complete");
                  resolve(JSON.stringify(alignment ?? []));
                } else if (job.status === "failed") {
                  ctx.untrackInterval(poll);
                  const errMsg = job.error_message ?? "Alignment failed";
                  updateNodeData(node.id, {
                    executionStatus: "failed",
                    errorMessage: errMsg,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  guardedToast.error("Forced alignment failed", { description: errMsg });
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
                  guardedToast.error("Failed to check alignment status");
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
            guardedToast.error("Failed to start forced alignment", {
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
    const effectiveCustomMode = getEffectiveSunoCustomMode(d);
    // Fold connected Sound nodes (music-genre / music-mood / instrumentation)
    // into either `style` (customMode true, 500-char budget) or `prompt`
    // (customMode false, 3000-char budget). Suno enforces these caps server-side.
    const audioStyle = collectAudioStyleHints(node, "suno-generate", nodes, edges);
    const userStyle = d.style ?? "";
    let finalStyle = userStyle;
    let finalPrompt = prompt;
    if (effectiveCustomMode) {
      const composedStyle = truncateForField(audioStyle.text, userStyle, 500);
      finalStyle = appendField(userStyle, composedStyle);
    } else {
      const composedPrompt = truncateForField(audioStyle.text, prompt, 3000);
      finalPrompt = appendField(prompt, composedPrompt);
    }
    setUserPromptTemplate(d.prompt?.trim() || undefined);
    return runProcessingNode(
      node.id,
      () =>
        sunoGenerateApi({
          prompt: finalPrompt,
          model: d.model || undefined,
          lyrics: d.lyrics || undefined,
          style: finalStyle || undefined,
          title: d.title || undefined,
          negativeStyle: d.negativeStyle || undefined,
          vocalGender: d.vocalGender || undefined,
          styleWeight: d.styleWeight,
          weirdnessConstraint: d.weirdnessConstraint,
          audioWeight: d.audioWeight,
          customMode: effectiveCustomMode,
          instrumental: d.instrumental ?? false,
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Generate",
      ctx,
      extractSunoOutputFields,
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
    setUserPromptTemplate(d.prompt?.trim() || undefined);
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
      extractSunoOutputFields,
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
    setUserPromptTemplate(d.prompt?.trim() || undefined);
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
      extractSunoOutputFields,
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

    setUserPromptTemplate(d.prompt?.trim() || undefined);
    return new Promise<string>((resolve, reject) => {
      sunoLyricsApi({ prompt, userId: ctx.userId })
        .then(({ jobId }) => {
          guardedToast.info("Lyrics generation started", {
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
                if (job.progress) {
                  updateProgressIfChanged(node.id, job.progress, updateNodeData);
                }

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
                  guardedToast.success("Lyrics generation complete");
                  resolve(first?.text ?? "");
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
                  guardedToast.error("Lyrics generation failed", {
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
                  guardedToast.error("Failed to check lyrics status");
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
            guardedToast.error("Failed to start lyrics generation", {
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
    let taskId: string | undefined = inputs.sunoTaskId ?? d.taskId?.trim();
    let audioId: string | undefined = inputs.sunoTrackId ?? d.audioId?.trim();

    // Fallback: walk upstream to find sunoTaskId/sunoTrackId from connected Suno node
    if (!taskId || !audioId) {
      const { nodes: allNodes, edges: allEdges } = useWorkflowStore.getState();
      const incomingEdges = allEdges.filter(e => e.target === node.id);
      for (const edge of incomingEdges) {
        const srcNode = allNodes.find(n => n.id === edge.source);
        if (!srcNode) continue;
        const srcData = srcNode.data as Record<string, unknown>;
        if (!taskId) {
          taskId = srcData.sunoTaskId as string | undefined;
          if (!taskId) {
            const results = srcData.generatedResults as Array<Record<string, unknown>> | undefined;
            const activeIndex = (srcData.activeResultIndex as number | undefined) ?? 0;
            const activeResult = results?.[activeIndex];
            taskId = (activeResult?.sunoTaskId ?? undefined) as string | undefined;
          }
        }
        if (!audioId) {
          audioId = srcData.sunoTrackId as string | undefined;
          if (!audioId) {
            const results = srcData.generatedResults as Array<Record<string, unknown>> | undefined;
            const activeIndex = (srcData.activeResultIndex as number | undefined) ?? 0;
            const activeResult = results?.[activeIndex];
            audioId = (activeResult?.sunoTrackId ?? undefined) as string | undefined;
          }
        }
        if (taskId && audioId) break;
      }
    }
    if (!taskId) {
      toast.error(
        `Node "${d.label}": no task ID found (connect a Suno Generate/Cover/Extend node or enter manually)`,
      );
      return Promise.reject(new Error("No task ID"));
    }
    setUserPromptTemplate(undefined);
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
    setUserPromptTemplate(undefined);
    return runProcessingNode(
      node.id,
      () =>
        sunoMusicVideoApi({
          taskId,
          audioId,
          userId: ctx.userId,
        }),
      "generatedVideoUrl",
      "Music Video",
      ctx,
    );
  }

  if (node.type === "suno-mashup") {
    const d = node.data as SunoMashupData;
    // Mashup needs 2 audio inputs — backend expects uploadUrlList tuple
    const audioUrl1 = inputs.audioUrl ?? (inputs.audioUrls ?? [])[0];
    const audioUrl2 = inputs.audioUrl2 ?? (inputs.audioUrls ?? [])[1];
    if (!audioUrl1 || !audioUrl2) {
      toast.error(`Node "${d.label}": connect two audio sources for mashup`);
      return Promise.reject(new Error("Need two audio inputs"));
    }
    setUserPromptTemplate(undefined);
    return runProcessingNode(
      node.id,
      () =>
        sunoMashupApi({
          uploadUrlList: [audioUrl1, audioUrl2],
          model: d.model || undefined,
          customMode: d.customMode ?? false,
          style: d.style || undefined,
          title: d.title || undefined,
          negativeStyle: d.negativeStyle || undefined,
          vocalGender: d.vocalGender || undefined,
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Mashup",
      ctx,
      extractSunoOutputFields,
    );
  }

  if (node.type === "suno-replace-section") {
    const d = node.data as SunoReplaceSectionData;
    const ids = resolveSunoIds(inputs, d as Record<string, unknown>);
    if (!ids) {
      toast.error(
        `Node "${d.label}": missing taskId or audioId. Connect to a Suno node or enter manually.`,
      );
      return Promise.reject(new Error("Missing taskId/audioId"));
    }
    setUserPromptTemplate(d.prompt?.trim() || undefined);
    return runProcessingNode(
      node.id,
      () =>
        sunoReplaceSectionApi({
          taskId: ids.taskId,
          audioId: ids.audioId,
          infillStartS: d.infillStartS ?? 0,
          infillEndS: d.infillEndS ?? 30,
          prompt: d.prompt?.trim() || "",
          tags: d.tags?.trim() || "",
          title: d.title?.trim() || undefined,
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Replace Section",
      ctx,
      extractSunoOutputFields,
    );
  }

  if (node.type === "suno-style-boost") {
    const d = node.data as SunoStyleBoostData;
    const content = inputs.prompt ?? d.content?.trim();
    if (!content) {
      toast.error(`Node "${d.label}": no content provided`);
      return Promise.reject(new Error("No content"));
    }
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, {
      executionStatus: "running",
      generatedText: undefined,
    });
    setUserPromptTemplate(d.content?.trim() || undefined);
    return sunoStyleBoostApi({ content, userId: ctx.userId })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          generatedText: result.text,
          generatedResults: [{ url: "", timestamp: new Date().toISOString(), jobId: "" }],
          activeResultIndex: 0,
        });
        guardedToast.success("Style Boost completed");
        return result.text ?? "";
      })
      .catch((err) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err instanceof Error ? err.message : "Style boost failed",
        });
        throw err;
      });
  }

  if (node.type === "suno-add-instrumental") {
    const d = node.data as SunoAddInstrumentalData;
    const ids = resolveSunoIds(inputs, d as Record<string, unknown>);
    if (!ids) {
      toast.error(
        `Node "${d.label}": missing taskId or audioId. Connect to a Suno node or enter manually.`,
      );
      return Promise.reject(new Error("Missing taskId/audioId"));
    }
    setUserPromptTemplate(undefined);
    return runProcessingNode(
      node.id,
      () =>
        sunoAddInstrumentalApi({
          taskId: ids.taskId,
          audioId: ids.audioId,
          model: d.model || undefined,
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Add Instrumental",
      ctx,
      extractSunoOutputFields,
    );
  }

  if (node.type === "suno-add-vocals") {
    const d = node.data as SunoAddVocalsData;
    const ids = resolveSunoIds(inputs, d as Record<string, unknown>);
    if (!ids) {
      toast.error(
        `Node "${d.label}": missing taskId or audioId. Connect to a Suno node or enter manually.`,
      );
      return Promise.reject(new Error("Missing taskId/audioId"));
    }
    setUserPromptTemplate(undefined);
    return runProcessingNode(
      node.id,
      () =>
        sunoAddVocalsApi({
          taskId: ids.taskId,
          audioId: ids.audioId,
          model: d.model || undefined,
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Add Vocals",
      ctx,
      extractSunoOutputFields,
    );
  }

  if (node.type === "suno-convert-wav") {
    const d = node.data as SunoConvertWavData;
    const ids = resolveSunoIds(inputs, d as Record<string, unknown>);
    if (!ids) {
      toast.error(
        `Node "${d.label}": missing taskId or audioId. Connect to a Suno node or enter manually.`,
      );
      return Promise.reject(new Error("Missing taskId/audioId"));
    }
    setUserPromptTemplate(undefined);
    return runProcessingNode(
      node.id,
      () =>
        sunoConvertWavApi({
          taskId: ids.taskId,
          audioId: ids.audioId,
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Convert WAV",
      ctx,
      extractSunoOutputFields,
    );
  }

  if (node.type === "suno-upload-extend") {
    const d = node.data as SunoUploadExtendData;
    const audioUrl = inputs.audioUrl;
    if (!audioUrl) {
      toast.error(`Node "${d.label}": no audio input found`);
      return Promise.reject(new Error("No audio input"));
    }
    setUserPromptTemplate(d.prompt?.trim() || undefined);
    return runProcessingNode(
      node.id,
      () =>
        sunoUploadExtendApi({
          // Route expects `uploadUrl`, not `audioUrl`.
          uploadUrl: audioUrl,
          // Route requires a numeric continueAt; default to 0 (extend from start).
          continueAt: d.continueAt ?? 0,
          prompt: d.prompt?.trim() || undefined,
          model: d.model || undefined,
          style: inputs.prompt || d.style || undefined,
          title: d.title || undefined,
          negativeStyle: d.negativeStyle || undefined,
          vocalGender: d.vocalGender || undefined,
          defaultParamFlag: d.defaultParamFlag ?? true,
          userId: ctx.userId,
        }),
      "generatedAudioUrl",
      "Suno Upload Extend",
      ctx,
      extractSunoOutputFields,
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
      guardedToast.info("Extracting audio from video...");
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

    return new Promise<string>((resolve, reject) => {
      getTranscribeAudioUrl()
        .then((resolvedAudioUrl) => {
          audioUrl = resolvedAudioUrl;
          // Re-apply sync so transcribeApi's body build consumes the flag
          // before another parallel executeNode can clobber it.
          setForcePrivate(forcePrivate);
          setUserPromptTemplate(undefined);
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
          guardedToast.info("Transcription started", {
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
                  updateProgressIfChanged(node.id, job.progress, updateNodeData);
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
                    guardedToast.error("Transcription failed", {
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
                  guardedToast.success("Transcription complete");
                  resolve(text);
                } else if (job.status === "failed") {
                  ctx.untrackInterval(poll);
                  const errMsg = job.error_message ?? "Unknown error";
                  updateNodeData(node.id, {
                    executionStatus: "failed",
                    errorMessage: errMsg,
                    currentJobId: undefined,
                    currentJobProgress: undefined,
                  });
                  guardedToast.error("Transcription failed", {
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
                  guardedToast.error("Failed to check transcription status");
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
            guardedToast.error("Transcription failed", { description: errMsg });
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

    setUserPromptTemplate(itData.customPrompt?.trim() || undefined);
    return imageToTextApi(
      imageUrl,
      itData.detailLevel || "detailed",
      inputs.prompt || itData.customPrompt || undefined,
      ctx.userId,
      itData.llmModel,
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
        guardedToast.success("Image described successfully");
        return result.generatedText ?? "";
      })
      .catch((err) => {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: errMsg,
        });
        guardedToast.error("Image description failed", { description: errMsg });
        throw err;
      });
  }

  if (node.type === "llm-chat") {
    const chatData = node.data as LLMChatData;
    const { updateNodeData } = useWorkflowStore.getState();

    // Manual wins over upstream on both fields — matches the dropdown's "Manual"
    // default: unless the user explicitly maps a source (fieldMappings), their
    // typed text is the source of truth. resolveTextRefs handles inline
    // `{Label}` refs so `{Framing}` in the textarea becomes the framing hint.
    const rawSystemPrompt = chatData.systemPrompt?.trim()
      ? chatData.systemPrompt
      : (typeof inputs.systemPrompt === "string" && inputs.systemPrompt.trim() ? inputs.systemPrompt : "");
    const systemPrompt = resolveTextRefs(rawSystemPrompt, refMap) ?? rawSystemPrompt;

    const listValue = overridePrompt || (typeof inputs.prompt === "string" && inputs.prompt.trim() ? inputs.prompt : undefined);
    const rawUserInput = chatData.userInput?.trim()
      ? chatData.userInput
      : (listValue ?? "");
    const userInput = resolveTextRefs(rawUserInput, refMap) ?? rawUserInput;

    if (!userInput?.trim()) {
      toast.error(`Node "${chatData.label}": no user prompt provided`);
      return Promise.reject(new Error("No user prompt"));
    }

    updateNodeData(node.id, {
      executionStatus: "running",
      errorMessage: undefined,
      generatedText: "",
      activeResultIndex: -1,
    });

    updateNodeData(node.id, {
      lastSystemPrompt: systemPrompt || "",
      lastUserPrompt: userInput,
    });

    setUserPromptTemplate(chatData.userInput?.trim() || undefined);
    return llmChatStream({
      userId: ctx.userId ?? "",
      systemPrompt: systemPrompt || "",
      userInput,
      referenceImageUrls: inputs.referenceImageUrls,
      referenceVideoUrls: inputs.referenceVideoUrls,
      referenceAudioUrls: inputs.referenceAudioUrls,
      temperature: chatData.temperature ?? 0.7,
      maxTokens: chatData.maxTokens ?? 2048,
      llmModel: chatData.llmModel,
      onToken: (token) => {
        const fresh = useWorkflowStore
          .getState()
          .nodes.find((n) => n.id === node.id);
        const prev =
          (fresh?.data as LLMChatData | undefined)?.generatedText ?? "";
        updateNodeData(node.id, { generatedText: prev + token });
      },
    })
      .then((result) => {
        const existingResults =
          (
            useWorkflowStore.getState().nodes.find((n) => n.id === node.id)
              ?.data as LLMChatData | undefined
          )?.generatedResults ?? [];
        const newResult = {
          text: result.generatedText,
          jobId: result.jobId,
          timestamp: new Date().toISOString(),
          systemPrompt: systemPrompt || "",
          userPrompt: userInput,
          listValue: listValue || undefined,
          runId: runId ?? "manual",
        };
        updateNodeData(node.id, {
          executionStatus: "completed",
          generatedText: result.generatedText,
          generatedResults: [newResult, ...existingResults].slice(0, 10),
          activeResultIndex: 0,
          lastSystemPrompt: systemPrompt || "",
          lastUserPrompt: userInput,
        });
        guardedToast.success("LLM Chat completed");
        return result.generatedText ?? "";
      })
      .catch((err: Error) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err.message || "LLM Chat failed",
        });
        guardedToast.error(`LLM Chat failed: ${err.message}`);
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
        "modify-image",
        "upscale-image",
        "remove-background",
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
      return Promise.resolve("");
    }

    // Manual wins — see gen-image note above. {} refs in userInput resolve
    // so "{Framing}" etc. is replaced with the connected source's output.
    const manualWriterInput = resolveTextRefs(writerData.userInput?.trim(), refMap);
    const userInput =
      overridePrompt ||
      manualWriterInput ||
      (typeof inputs.prompt === "string" && inputs.prompt.trim()
        ? inputs.prompt
        : "");

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

    setUserPromptTemplate(writerData.userInput?.trim() || undefined);
    return generateAIWriterStream({
      userId: ctx.userId ?? "",
      systemPrompt: processedPrompt,
      userInput,
      temperature: writerData.temperature ?? 0.7,
      maxTokens: writerData.maxTokens ?? 4096,
      llmModel: writerData.llmModel,
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
        guardedToast.success(
          `AI Agent completed: ${items.length} item${items.length !== 1 ? "s" : ""} generated`,
        );
        return result.generatedText ?? "";
      })
      .catch((err: Error) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err.message || "Generation failed",
        });
        guardedToast.error(`AI Agent failed: ${err.message}`);
        throw err;
      });
  }

  if (node.type === "web-scrape") {
    const d = node.data as WebScrapeNodeData;
    const { updateNodeData } = useWorkflowStore.getState();
    const upstream = inputs.prompt;
    const params = buildWebScrapeParams(d, upstream);

    updateNodeData(node.id, {
      executionStatus: "running",
      errorMessage: undefined,
    });

    setUserPromptTemplate(undefined);
    return webScrape(params)
      .then((res) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          generatedJson: res.json,
        });
        guardedToast.success("Web Scrape completed");
        // Return stringified JSON for callers that expect a string — same coercion
        // getPrimaryOutput uses on the backend.
        return res.json === undefined ? "" : JSON.stringify(res.json);
      })
      .catch((err: Error) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err.message || "Scrape failed",
        });
        guardedToast.error(`Web Scrape failed: ${err.message}`);
        throw err;
      });
  }

  if (node.type === "lip-sync") {
    const lsData = node.data as LipSyncData;
    const lsProvider = lsData.provider || "kling-avatar";

    // Resolve image URL (for image-input providers)
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

    // Resolve video URL (for video-input providers)
    let videoUrl: string | undefined;
    if (lsData.selectedVideoNodeId) {
      const videoNode = nodes.find(
        (n) => n.id === lsData.selectedVideoNodeId,
      );
      if (videoNode) {
        videoUrl = extractNodeOutput(videoNode);
      }
    }
    if (!videoUrl) {
      videoUrl = inputs.videoUrl;
    }

    // Resolve audio URL
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

    // Validate required inputs based on provider
    const needsVideo = VIDEO_INPUT_LIP_SYNC_PROVIDERS.has(lsProvider as never);
    const needsImage = !needsVideo && !FLEXIBLE_INPUT_LIP_SYNC_PROVIDERS.has(lsProvider as never);
    const faceUrl = videoUrl || imageUrl;

    if (needsVideo && !videoUrl) {
      toast.error(`Node "${lsData.label}": ${lsProvider} requires a video input`);
      return Promise.reject(new Error("No video input"));
    }
    if (needsImage && !imageUrl) {
      toast.error(`Node "${lsData.label}": no portrait image found`);
      return Promise.reject(new Error("No portrait image"));
    }
    if (!faceUrl) {
      toast.error(`Node "${lsData.label}": no image or video input found`);
      return Promise.reject(new Error("No face input"));
    }
    if (!audioUrl) {
      toast.error(`Node "${lsData.label}": no audio track found`);
      return Promise.reject(new Error("No audio track"));
    }

    setUserPromptTemplate(lsData.prompt?.trim() || undefined);
    return runProcessingNode(
      node.id,
      () =>
        lipSyncApi(
          needsVideo ? undefined : (imageUrl || undefined),
          audioUrl!,
          lsData.prompt || "A person talking naturally",
          lsData.provider || undefined,
          lsData.resolution || undefined,
          ctx.userId,
          {
            videoUrl: videoUrl || undefined,
            guidanceScale: lsData.guidanceScale,
            inferenceSteps: lsData.inferenceSteps,
            seed: lsData.seed,
            pads: lsData.pads,
            smooth: lsData.smooth,
            fps: lsData.fps,
            resizeFactor: lsData.resizeFactor,
            enhancer: lsData.enhancer,
            preprocess: lsData.preprocess,
            still: lsData.still,
            poseStyle: lsData.poseStyle,
            expressionScale: lsData.expressionScale,
          },
        ),
      "generatedVideoUrl",
      "Lip Sync",
      ctx,
    );
  }

  if (node.type === "speech-to-video") {
    const s2vData = node.data as SpeechToVideoData;

    let imageUrl: string | undefined = overrideMediaUrl;
    if (!imageUrl && s2vData.selectedImageNodeId) {
      const imageNode = nodes.find(
        (n) => n.id === s2vData.selectedImageNodeId,
      );
      if (imageNode) {
        imageUrl = extractNodeOutput(imageNode);
      }
    }
    if (!imageUrl) {
      imageUrl = inputs.imageUrl;
    }

    let audioUrl: string | undefined;
    if (s2vData.selectedAudioNodeId) {
      const audioNode = nodes.find(
        (n) => n.id === s2vData.selectedAudioNodeId,
      );
      if (audioNode) {
        audioUrl = extractNodeOutput(audioNode);
      }
    }
    if (!audioUrl) {
      audioUrl = inputs.audioUrl;
    }

    // Manual wins — see gen-image note above.
    let prompt =
      overridePrompt || resolveTextRefs(s2vData.prompt?.trim(), refMap) || inputs.prompt || "";

    if (!imageUrl) {
      toast.error(`Node "${s2vData.label}": no image input found`);
      return Promise.reject(new Error("No image input"));
    }
    if (!audioUrl) {
      toast.error(`Node "${s2vData.label}": no audio track found`);
      return Promise.reject(new Error("No audio track"));
    }
    if (!prompt) {
      toast.error(`Node "${s2vData.label}": no prompt provided`);
      return Promise.reject(new Error("No prompt"));
    }
    {
      const cinematographyHints = collectCinematographyHints(node.id, nodes, edges);
      if (cinematographyHints.length > 0) {
        const joined = cinematographyHints.join(", ");
        prompt = prompt ? `${prompt}. ${joined}` : joined;
      }
    }
    {
      const identityClause = collectIdentityLockClause(node.id, nodes, edges);
      if (identityClause) prompt = `${prompt} ${identityClause}`;
    }

    setUserPromptTemplate(s2vData.prompt?.trim() || undefined);
    return runProcessingNode(
      node.id,
      () =>
        speechToVideoApi({
          imageUrl: imageUrl!,
          audioUrl: audioUrl!,
          prompt,
          resolution: s2vData.resolution || "480p",
          negativePrompt: s2vData.negativePrompt || undefined,
          seed: s2vData.seed || undefined,
          numFrames: s2vData.numFrames || undefined,
          fps: s2vData.fps || undefined,
          inferenceSteps: s2vData.inferenceSteps || undefined,
          guidanceScale: s2vData.guidanceScale || undefined,
          shift: s2vData.shift || undefined,
          userId: ctx.userId,
        }),
      "generatedVideoUrl",
      "Speech to Video",
      ctx,
    );
  }

  if (node.type === "motion-transfer") {
    const mtData = node.data as unknown as MotionTransferData;

    // Use resolved inputs from resolveNodeInputs (covers all image/video source types)
    const imageUrl = inputs.imageUrl;
    const videoUrl = inputs.videoUrl;

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

    setUserPromptTemplate(mtData.prompt?.trim() || undefined);
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
          mtData.provider || undefined,
          mtData.backgroundSource || undefined,
          mtData.videoDuration || undefined,
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

      setUserPromptTemplate(undefined);
      return runProcessingNode(
        node.id,
        () => videoUpscaleApi({ userId: ctx.userId, provider, kieTaskId }),
        "generatedVideoUrl",
        "Upscale Video",
        ctx,
      );
    }

    // Topaz provider - requires videoUrl
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(`Node "${vuData.label}": no video input found`);
      return Promise.reject(new Error("No video input"));
    }

    setUserPromptTemplate(undefined);
    return runProcessingNode(
      node.id,
      () => videoUpscaleApi({ videoUrl, upscaleFactor: vuData.upscaleFactor || undefined, userId: ctx.userId, provider: "topaz" }),
      "generatedVideoUrl",
      "Upscale Video",
      ctx,
    );
  }

  if (node.type === "extend-video") {
    const evData = node.data as unknown as ExtendVideoData;
    // Manual wins — see gen-image note above.
    let prompt = overridePrompt ?? resolveTextRefs(evData.prompt, refMap) ?? inputs.prompt;

    const kieTaskId = resolveUpstreamKieTaskId(node.id, evData as unknown as Record<string, unknown>);

    if (!kieTaskId) {
      toast.error(`Node "${evData.label}": no upstream kieTaskId found. Connect a VEO or Runway video node.`);
      return Promise.reject(new Error("No kieTaskId"));
    }

    {
      const cinematographyHints = collectCinematographyHints(node.id, nodes, edges);
      if (cinematographyHints.length > 0) {
        const joined = cinematographyHints.join(", ");
        prompt = prompt ? `${prompt}. ${joined}` : joined;
      }
    }
    {
      const identityClause = collectIdentityLockClause(node.id, nodes, edges);
      if (identityClause) prompt = prompt ? `${prompt} ${identityClause}` : identityClause;
    }

    setUserPromptTemplate(evData.prompt?.trim() || undefined);
    return runProcessingNode(
      node.id,
      () =>
        extendVideo({
          kieTaskId,
          prompt: prompt || "",
          provider: evData.provider || "veo-extend",
          model: evData.provider === "veo-extend" ? evData.model : undefined,
          quality: evData.provider === "runway-extend" ? evData.quality : undefined,
          seeds: evData.provider === "veo-extend" ? evData.seeds : undefined,
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
    setUserPromptTemplate(undefined);
    const { nodes: combineNodes, edges: combineEdges } = useWorkflowStore.getState();
    const upstreamDurations = getCombineUpstreamDurations(node, combineNodes, combineEdges);
    return runCombineVideos(
      node.id,
      videoUrls,
      combineData.transition ?? "cut",
      combineData.transitionDuration ?? 0.5,
      combineData.audioMode ?? "crossfade",
      ctx,
      combineData.trimStartFrames,
      combineData.trimEndFrames,
      upstreamDurations,
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
    setUserPromptTemplate(undefined);
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

  if (node.type === "trim-audio") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl ?? inputs.audioUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as TrimAudioData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const d = node.data as TrimAudioData;
    setUserPromptTemplate(undefined);
    return runProcessingNode(
      node.id,
      () =>
        trimAudioApi(
          videoUrl,
          d.audioFormat,
          ctx.userId,
          d.startTime as number | undefined,
          d.endTime as number | undefined,
        ),
      "generatedAudioUrl",
      "Trim Audio",
      ctx,
    );
  }

  if (node.type === "split-media") {
    const d = node.data as SplitMediaData;
    const videoUrl = inputs.videoUrl;
    const audioUrl = inputs.audioUrl;
    if (!videoUrl && !audioUrl) {
      toast.error(`Node "${d.label}": no video or audio input found`);
      return Promise.reject(new Error("No input"));
    }
    const { updateNodeData } = useWorkflowStore.getState();
    updateNodeData(node.id, { executionStatus: "running", currentJobProgress: 0 });
    setUserPromptTemplate(undefined);
    return new Promise<string>((resolve, reject) => {
      splitMediaApi({
        videoUrl: videoUrl || undefined,
        audioUrl: audioUrl || undefined,
        chunkDuration: d.chunkDuration || 10,
        audioFormat: d.audioFormat || "mp3",
        userId: ctx.userId,
      }).then(({ jobId }) => {
        toast.info("Split Media started", { description: `Job ID: ${jobId}` });
        updateNodeData(node.id, { currentJobId: jobId });
        const poll = setInterval(async () => {
          try {
            const job = await getJobStatus(jobId);
            if (job.progress != null) updateProgressIfChanged(node.id, job.progress, updateNodeData);
            if (job.status === "completed") {
              clearInterval(poll);
              const od = job.output_data as Record<string, unknown>;
              const videoUrls = od.videoUrls as string[] | undefined;
              const audioUrls = od.audioUrls as string[] | undefined;
              const chunkIdx = d.outputChunkIndex ?? 0;
              const singleResult = [audioUrls?.[chunkIdx] ?? videoUrls?.[chunkIdx]].filter(Boolean) as string[];
              updateNodeData(node.id, {
                executionStatus: "completed",
                generatedVideoUrls: videoUrls,
                generatedAudioUrls: audioUrls,
                generatedItems: [...(audioUrls ?? []), ...(videoUrls ?? [])],
                __listResults: singleResult,
                currentJobId: undefined,
                currentJobProgress: undefined,
              });
              // Create upload nodes on canvas for each chunk
              const { addNode } = useWorkflowStore.getState();
              const currentNode = useWorkflowStore.getState().nodes.find(n => n.id === node.id);
              const baseX = (currentNode?.position?.x ?? 0) + 300;
              const baseY = (currentNode?.position?.y ?? 0);
              const allUrls = [...(audioUrls ?? []), ...(videoUrls ?? [])];
              allUrls.forEach((url, i) => {
                const isAudio = !!(audioUrls && i < audioUrls.length);
                const result = { url, timestamp: new Date().toISOString() };
                addNode(
                  isAudio ? "upload-audio" : "upload-video",
                  { x: baseX, y: baseY + (i * 120) },
                  {
                    label: `Chunk ${i + 1}`,
                    url,
                    externalUrl: url,
                    r2Url: "",
                    assetId: "",
                    filename: `chunk-${i + 1}`,
                    generatedResults: [result],
                    activeResultIndex: 0,
                    executionStatus: "completed",
                  },
                );
              });

              toast.success(`Split Media complete: ${od.chunkCount} chunks`);
              resolve((audioUrls?.[0] ?? videoUrls?.[0]) as string);
            } else if (job.status === "failed") {
              clearInterval(poll);
              updateNodeData(node.id, { executionStatus: "failed", errorMessage: job.error_message ?? "Failed", currentJobId: undefined });
              toast.error(`Split Media failed: ${job.error_message}`);
              reject(new Error(job.error_message ?? "Failed"));
            }
          } catch {
            clearInterval(poll);
            updateNodeData(node.id, { executionStatus: "failed", currentJobId: undefined });
            reject(new Error("Polling failed"));
          }
        }, 2000);
        ctx.trackInterval(poll);
      }).catch((err) => {
        updateNodeData(node.id, { executionStatus: "failed", currentJobId: undefined });
        reject(err);
      });
    });
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
    setUserPromptTemplate(undefined);
    const trimMode = d.trimMode ?? "time";
    const { nodes: trimNodes, edges: trimEdges } = useWorkflowStore.getState();
    const upstreamDuration = getUpstreamDuration(node.id, trimNodes, trimEdges);
    return runProcessingNode(
      node.id,
      () =>
        trimVideoApi(
          videoUrl,
          d.startTime,
          d.endTime || undefined,
          ctx.userId,
          d.outputSilentVideo,
          {
            trimStartFrames: trimMode === "frames" ? d.trimStartFrames : undefined,
            trimEndFrames: trimMode === "frames" ? d.trimEndFrames : undefined,
            smartLoopCut: trimMode === "smart-loop-cut",
            smartLoopCutLookback: trimMode === "smart-loop-cut" ? d.smartLoopCutLookback : undefined,
            trimMode,
            upstreamDuration,
          },
        ),
      "generatedVideoUrl",
      "Trim Video",
      ctx,
      (od) => ({
        generatedSilentVideoUrl: od.videoUrlSilent as string | undefined,
      }),
    );
  }

  if (node.type === "extract-frame") {
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;
    if (!videoUrl) {
      toast.error(
        `Node "${(node.data as ExtractFrameData).label}": no video input`,
      );
      return Promise.reject(new Error("No video"));
    }
    const d = node.data as ExtractFrameData;
    return runProcessingNode(
      node.id,
      () =>
        extractFrameApi(videoUrl, d.mode || "first", d.timestamp || undefined, ctx.userId),
      "generatedImageUrl",
      "Extract Frame",
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
    const meData = node.data as ManualEditData;
    const mode = meData.mode ?? "bypass";

    // Collect all input assets
    const inputAssets = (inputs.inputAssets as Array<{ nodeId: string; url: string; type: string }>) ?? [];
    const videoUrl = overrideMediaUrl ?? inputs.videoUrl;

    // Store assets on node for FreeCut to use
    const { updateNodeData: setNodeData } = useWorkflowStore.getState();
    if (inputAssets.length > 0 || videoUrl) {
      setNodeData(node.id, {
        inputAssets: inputAssets.length > 0 ? inputAssets : videoUrl ? [{ nodeId: "upstream", url: videoUrl, type: "video" as const }] : [],
        inputVideoUrl: videoUrl ?? inputAssets.find(a => a.type === "video")?.url,
      });
    }

    if (mode === "bypass") {
      const outputUrl = videoUrl ?? inputAssets.find(a => a.type === "video")?.url ?? inputAssets[0]?.url;
      if (!outputUrl) {
        toast.error(`Node "${meData.label}": no input assets connected`);
        return Promise.reject(new Error("No input"));
      }
      setNodeData(node.id, { executionStatus: "completed", generatedVideoUrl: outputUrl });
      return Promise.resolve(outputUrl);
    }

    // Wait mode
    if (!videoUrl && inputAssets.length === 0) {
      toast.error(`Node "${meData.label}": no input assets connected`);
      return Promise.reject(new Error("No input"));
    }
    setNodeData(node.id, {
      executionStatus: "awaiting-user",
      errorMessage: undefined,
    });
    guardedToast.info("Manual edit required — click 'Open Editor' on the node");
    return new Promise<string>((resolve, reject) => {
      pendingManualEdits.set(node.id, { resolve: () => resolve(""), reject });
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
    const { nodes: loopNodes, edges: loopEdges } = useWorkflowStore.getState();
    const upstreamDuration = getUpstreamDuration(node.id, loopNodes, loopEdges);
    return runProcessingNode(
      node.id,
      () =>
        loopVideoApi(
          videoUrl,
          d.mode ?? "repeat",
          d.repeatCount,
          d.targetDuration,
          ctx.userId,
          {
            smartLoopCutBeforeRepeat: d.smartLoopCutBeforeRepeat,
            smartLoopCutLookback: d.smartLoopCutLookback,
            upstreamDuration,
          },
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
          d.backgroundColor as string | undefined,
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

  if (node.type === "combine-audio") {
    const combineData = node.data as CombineAudioData;
    let sourceEntries = inputs.audioUrlsWithSourceIds ?? [];

    // Apply segmentOrder to reorder audio inputs
    if (combineData.segmentOrder?.length && sourceEntries.length > 1) {
      sourceEntries = applyMediaOrder(
        sourceEntries.map((e) => ({ id: e.nodeId, ...e })),
        combineData.segmentOrder,
      ).map((e) => ({ nodeId: e.nodeId, url: e.url }));
    }

    const segments = sourceEntries.map((e) => {
      const settings = combineData.segmentSettings?.[e.nodeId] ?? {};
      return {
        url: e.url,
        ...(settings.startTime != null ? { startTime: settings.startTime } : {}),
        ...(settings.endTime != null ? { endTime: settings.endTime } : {}),
      };
    });
    if (segments.length === 0) {
      toast.error(
        `Node "${combineData.label}": need at least 1 audio input`,
      );
      return Promise.reject(new Error("Need at least 1 audio segment"));
    }
    return runProcessingNode(
      node.id,
      () => combineAudioApi({ segments, userId: ctx.userId }),
      "generatedAudioUrl",
      "Combine Audio",
      ctx,
    );
  }

  if (node.type === "video-composer") {
    const d = node.data as VideoComposerData;
    const composerPrompt = inputs.prompt || d.compositionPrompt;
    if (!composerPrompt?.trim()) {
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
      prompt: composerPrompt,
      assets,
      fps: d.fps,
      aspectRatio: d.aspectRatio,
      durationSeconds: d.durationSeconds,
      userId: ctx.userId,
      llmModel: d.llmModel,
    })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          sceneGraph: result.sceneGraph,
        });
        guardedToast.success("Composition generated");
        return "plan-ready";
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
    const aePrompt = inputs.prompt || d.effectPrompt;
    if (!aePrompt?.trim()) {
      toast.error(`Node "${d.label}": no effect prompt set`);
      return Promise.reject(new Error("No effect prompt"));
    }
    if (!ctx.userId) {
      toast.error("Not authenticated");
      return Promise.reject(new Error("Not authenticated"));
    }
    // Use resolved inputs from resolveNodeInputs (matches backend routing)
    const inputVideoUrl = inputs.videoUrl || d.inputVideoUrl;
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
      prompt: aePrompt,
      inputVideoUrl,
      fps: d.fps,
      width: aeWidth,
      height: aeHeight,
      durationSeconds: d.durationSeconds,
      userId: ctx.userId,
      llmModel: d.llmModel,
    })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          effectPlan: result.effectPlan,
        });
        guardedToast.success("After effects plan generated");
        return "plan-ready";
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
    const loPrompt = inputs.prompt || d.overlayPrompt;
    if (!loPrompt?.trim()) {
      toast.error(`Node "${d.label}": no overlay prompt set`);
      return Promise.reject(new Error("No overlay prompt"));
    }
    if (!ctx.userId) {
      toast.error("Not authenticated");
      return Promise.reject(new Error("Not authenticated"));
    }
    // Use resolved inputs for video URL (matches backend routing)
    const inputVideoUrl = inputs.videoUrl || d.inputVideoUrl;
    // Lottie assets still need edge iteration for handle-specific collection
    const lottieAssets: Array<{ id: string; url: string; name: string }> = [];
    const loIncomingEdges = edges.filter((e) => e.target === node.id);
    for (const edge of loIncomingEdges) {
      if (edge.targetHandle !== "lottie") continue;
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;
      const output = extractNodeOutput(sourceNode);
      if (output && (output.startsWith("http") || output.startsWith("/"))) {
        lottieAssets.push({
          id: sourceNode.id,
          url: output,
          name: (sourceNode.data as Record<string, unknown>).label as string ?? "Lottie Asset",
        });
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
      prompt: loPrompt,
      inputVideoUrl,
      fps: d.fps,
      width: d.width ?? 1920,
      height: d.height ?? 1080,
      durationSeconds: d.durationSeconds,
      lottieAssets: lottieAssets.length > 0 ? lottieAssets : undefined,
      userId: ctx.userId,
      llmModel: d.llmModel,
    })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          overlayPlan: result.overlayPlan,
        });
        guardedToast.success("Lottie overlay plan generated");
        return "plan-ready";
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
    const tdPrompt = inputs.prompt || d.titlePrompt;
    if (!tdPrompt?.trim()) {
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
    const dims = ASPECT_RATIO_DIMENSIONS[d.aspectRatio] ?? { width: 1920, height: 1080 };
    return generate3DTitle({
      prompt: tdPrompt,
      fps: d.fps,
      aspectRatio: d.aspectRatio,
      width: dims.width,
      height: dims.height,
      durationSeconds: d.durationSeconds,
      backgroundColor: d.backgroundColor,
      backgroundMediaUrl,
      userId: ctx.userId,
      llmModel: d.llmModel,
    })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          titlePlan: result.titlePlan,
        });
        guardedToast.success("3D title plan generated");
        return "plan-ready";
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
    const dims = ASPECT_RATIO_DIMENSIONS[d.aspectRatio] ?? { width: 1920, height: 1080 };
    return generateMotionGraphics({
      prompt: inputs.prompt || d.motionPrompt,
      fps: d.fps,
      aspectRatio: d.aspectRatio,
      width: dims.width,
      height: dims.height,
      durationSeconds: d.durationSeconds,
      backgroundColor: d.backgroundColor,
      userId: ctx.userId!,
      llmModel: d.llmModel,
    })
      .then((result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          motionPlan: result.motionPlan,
        });
        guardedToast.success("Motion graphics plan generated");
        return "plan-ready";
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
      const dims = ASPECT_RATIO_DIMENSIONS[d.aspectRatio] ?? { width: 1920, height: 1080 };
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
            x: existing.x ?? 0,
            y: existing.y ?? 0,
            width: existing.width ?? 100,
            height: existing.height ?? 100,
            startFrame: existing.startFrame ?? 0,
            durationInFrames: existing.durationInFrames,
            opacity: existing.opacity,
            blendMode: existing.blendMode,
            zIndex: existing.zIndex ?? 0,
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
        layout: d.layout ?? "custom",
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
      guardedToast.success("Composite plan built");
      return Promise.resolve("");
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
    const cinematographyHints = collectCinematographyHints(node.id, nodes, edges, {
      excludeTypes: STILL_IMAGE_EXCLUDE_TYPES,
    });
    const augmentedData = cinematographyHints.length > 0
      ? {
          ...locData,
          description: locData.description
            ? `${locData.description}. ${cinematographyHints.join(", ")}`
            : cinematographyHints.join(", "),
        }
      : locData;
    return runLocationGeneration(node.id, augmentedData, ctx);
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

  if (node.type === "teleport-send" || node.type === "teleport-receive") {
    // Passthrough: extract upstream output directly (same pattern as combine-text)
    const { nodes: currentNodes, edges: currentEdges, updateNodeData } = useWorkflowStore.getState()
    const incomingEdges = currentEdges.filter((e) => e.target === node.id)
    let value = ""
    for (const edge of incomingEdges) {
      const src = currentNodes.find((n) => n.id === edge.source)
      if (!src) continue
      const output = extractNodeOutput(src, edge.sourceHandle ?? undefined)
      if (output) { value = output; break }
    }
    updateNodeData(node.id, { result: value, executionStatus: "completed" })
    return Promise.resolve(value)
  }

  if (node.type === "router") {
    const { nodes: currentNodes, edges: currentEdges, updateNodeData } = useWorkflowStore.getState()
    const routerData = node.data as RouterNodeData
    const mode = routerData.mode ?? "radio"
    const routes = routerData.routes ?? []

    // Resolve upstream input (passthrough) — skip the dedicated variables handle
    const incomingEdges = currentEdges.filter((e) => e.target === node.id && e.targetHandle !== VARIABLES_HANDLE_ID)
    let inputValue: string | undefined
    for (const edge of incomingEdges) {
      const src = currentNodes.find((n) => n.id === edge.source)
      if (!src) continue
      const output = extractNodeOutput(src, edge.sourceHandle ?? undefined)
      if (output) { inputValue = output; break }
    }

    let activeRoutes: string[]
    if (mode === "conditional") {
      const groups = routerData.conditionGroups ?? []
      if (groups.length === 0) {
        activeRoutes = []
      } else {
        const parsed = tryParseJson(inputValue ?? "")
        const raw = inputValue ?? ""
        const variables = buildConditionVariables(node.id, currentEdges, currentNodes, (n) => extractNodeOutput(n))
        const opts = { variables }
        const union = new Set<string>()
        for (const group of groups) {
          if (!group.routeIds?.length) continue
          const logic = group.conditionLogic === "OR" ? "OR" : "AND"
          if (evaluateConditionGroup(parsed, raw, group.conditions ?? [], logic, undefined, opts)) {
            for (const id of group.routeIds) union.add(id)
          }
        }
        activeRoutes = routes.filter((r) => union.has(r.id)).map((r) => r.id)
      }
    } else {
      activeRoutes = routes.filter((r) => r.active).map((r) => r.id)
    }

    const routeOutputs: Record<string, string | undefined> = {}
    for (const route of routes) {
      routeOutputs[route.id] = activeRoutes.includes(route.id) ? (inputValue ?? "gate") : undefined
    }

    updateNodeData(node.id, {
      activeRoutes,
      routeOutputs,
      result: activeRoutes.length > 0 ? "routed" : undefined,
      executionStatus: "completed",
    })
    return Promise.resolve("")
  }

  if (node.type === "combine-text") {
    const {
      nodes: currentNodes,
      edges: currentEdges,
      updateNodeData,
    } = useWorkflowStore.getState();
    const combineData = node.data as CombineTextNodeData;
    const sep = resolveSeparator(combineData.separator, combineData.customSeparator, {
      combineSpacing: true,
    });

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

      // Fallback: accumulated generatedResults from multiple manual runs
      const genResults = srcData.generatedResults as
        | Array<{ url?: string; text?: string }>
        | undefined;
      if (genResults && genResults.length > 1) {
        for (const r of genResults) {
          const val = r.url || r.text || "";
          if (val.trim()) textParts.push(val.trim());
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
    return Promise.resolve("");
  }

  if (node.type === "split-text") {
    const {
      nodes: currentNodes,
      edges: currentEdges,
      updateNodeData,
    } = useWorkflowStore.getState();
    const splitData = node.data as SplitTextData;
    const separator = resolveSeparator(splitData.separator, splitData.customSeparator);

    const incomingEdges = currentEdges.filter((e) => e.target === node.id);
    let inputText = "";

    for (const edge of incomingEdges) {
      const sourceNode = currentNodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;
      const output = extractNodeOutput(sourceNode);
      if (output) inputText += output;
    }

    // Fall back to resolved upstream prompt or node data (matches backend split-text)
    if (!inputText) {
      inputText = inputs.prompt || (splitData.text as string) || "";
    }

    if (!inputText) {
      updateNodeData(node.id, {
        executionStatus: "failed",
        errorMessage: "No input text received",
      });
      return Promise.resolve("");
    }

    let parts = separator ? inputText.split(separator) : [inputText];

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
    return Promise.resolve("");
  }

  if (node.type === "extract-field") {
    const {
      nodes: currentNodes,
      edges: currentEdges,
      updateNodeData,
    } = useWorkflowStore.getState();
    const extractData = node.data as ExtractFieldNodeData;
    const path = (extractData.field ?? "").trim();

    // Find the single upstream edge on `in`.
    const rawInEdge = currentEdges.find((e) => e.target === node.id && e.targetHandle === "in")
      ?? currentEdges.find((e) => e.target === node.id);
    if (!rawInEdge) {
      updateNodeData(node.id, { extractedText: "", executionStatus: "completed" });
      return Promise.resolve("");
    }
    const inEdge = resolveSourceThroughConnectedList(rawInEdge, currentNodes, currentEdges);
    const src = currentNodes.find((n) => n.id === inEdge.source);
    if (!src) {
      updateNodeData(node.id, { extractedText: "", executionStatus: "completed" });
      return Promise.resolve("");
    }

    // Prefer structured json from the source node's data (web-scrape's generatedJson).
    let value: unknown = (src.data as { generatedJson?: unknown }).generatedJson;

    // When upstream is a list-producing node (filter-list / deduplicate /
    // merge-lists / split-text), iterate over the FULL list so the path
    // evaluates per-item. Without this, Extract Field would silently read only
    // listResults[0] via extractNodeOutput and produce inconsistent counts
    // whenever upstream order shifted between runs. Mirrors backend
    // executeExtractField's `output.listResults` branch.
    if (value === undefined) {
      const listItems = extractNodeOutputAsList(src);
      if (listItems && listItems.length > 0) {
        const spread = spreadJsonArrayIfSingleton(listItems);
        value = spread.map((item) => tryParseJson(item));
      }
    }

    // Fall back to the upstream's text output (for text-prompt, llm-chat, etc.) and JSON.parse it.
    if (value === undefined) {
      const text = extractNodeOutput(src, inEdge.sourceHandle ?? undefined);
      if (typeof text !== "string" || text.length === 0) {
        updateNodeData(node.id, { extractedText: "", executionStatus: "completed" });
        return Promise.resolve("");
      }
      try {
        value = JSON.parse(text);
      } catch {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: "Input is not valid JSON",
        });
        return Promise.reject(new Error("Input is not valid JSON"));
      }
    }

    const raw = evaluateJsonPath(value ?? null, path);
    const strings = stringifyPathResults(raw);
    const joined = strings.join("\n");
    const outputType = extractData.outputType ?? "text";
    updateNodeData(node.id, {
      extractedText: joined,
      executionStatus: "completed",
      __listResults: outputType === "list" ? strings : undefined,
      generatedJson: outputType === "json" ? raw : undefined,
    });
    return Promise.resolve(joined);
  }

  if (node.type === "json-process") {
    const {
      nodes: currentNodes,
      edges: currentEdges,
      updateNodeData,
    } = useWorkflowStore.getState();
    const jpData = node.data as JsonProcessNodeData;

    const rawInEdge = currentEdges.find((e) => e.target === node.id && e.targetHandle === "in")
      ?? currentEdges.find((e) => e.target === node.id);
    if (!rawInEdge) {
      updateNodeData(node.id, { processedResult: null, executionStatus: "completed" });
      return Promise.resolve("");
    }
    const inEdge = resolveSourceThroughConnectedList(rawInEdge, currentNodes, currentEdges);
    const src = currentNodes.find((n) => n.id === inEdge.source);
    if (!src) {
      updateNodeData(node.id, { processedResult: null, executionStatus: "completed" });
      return Promise.resolve("");
    }

    let input: unknown = (src.data as { generatedJson?: unknown }).generatedJson;
    if (input === undefined) {
      const text = extractNodeOutput(src, inEdge.sourceHandle ?? undefined);
      if (typeof text !== "string" || text.length === 0) {
        updateNodeData(node.id, { processedResult: null, executionStatus: "completed" });
        return Promise.resolve("");
      }
      try {
        input = JSON.parse(text);
      } catch {
        input = text;
      }
    }

    const expression = jpData.mode === "advanced"
      ? (jpData.expression ?? ".")
      : buildExpressionFromVisual({
          inputPath: jpData.inputPath ?? "",
          filters: jpData.filters ?? [],
          projections: jpData.projections ?? [],
        });

    const result = evaluateJsonExpression(input, expression);
    if (!result.ok) {
      updateNodeData(node.id, {
        executionStatus: "failed",
        errorMessage: result.error,
      });
      return Promise.reject(new Error(result.error));
    }

    const processedResult = result.value;
    const listResults = jsonResultToList(processedResult);

    updateNodeData(node.id, {
      processedResult,
      __listResults: listResults,
      executionStatus: "completed",
      errorMessage: undefined,
    });
    return Promise.resolve(listResults[0] ?? "");
  }

  if (node.type === "filter-list") {
    const { nodes: currentNodes, edges: currentEdges, updateNodeData } = useWorkflowStore.getState();
    const filterData = node.data as FilterListNodeData;
    const items = collectUpstreamListItemsFrontend(node.id, currentEdges, currentNodes);
    const effectiveConditions = (filterData.conditions ?? []).filter((c) => c && c.operator);
    const logic = filterData.conditionLogic === "OR" ? "OR" : "AND";
    const variables = buildConditionVariables(node.id, currentEdges, currentNodes, (n) => extractNodeOutput(n));
    // Condition values are constant across items — resolve once up-front.
    const resolvedConditions = effectiveConditions.map((c) => ({
      ...c,
      value: resolveConditionValue(c.value ?? "", c.valueType, undefined, variables),
    }));
    const opts = { caseSensitive: filterData.caseSensitive };
    const filtered = resolvedConditions.length === 0
      ? items
      : items.filter((item) => {
        const parsed = tryParseJson(item);
        const results = resolvedConditions.map((c) => evaluateCondition(parsed, item, c, undefined, opts));
        return logic === "OR" ? results.some(Boolean) : results.every(Boolean);
      });
    updateNodeData(node.id, {
      listResults: filtered,
      __listResults: filtered,
      __listTotal: filtered.length,
      executionStatus: "completed",
      errorMessage: undefined,
    });
    return Promise.resolve(filtered[0] ?? "");
  }

  if (node.type === "deduplicate") {
    const { nodes: currentNodes, edges: currentEdges, updateNodeData } = useWorkflowStore.getState();
    const dedupData = node.data as DeduplicateNodeData;
    const path = (dedupData.field ?? "").trim();
    const items = collectUpstreamListItemsFrontend(node.id, currentEdges, currentNodes);

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const item of items) {
      let key: string;
      if (path === "") {
        key = item;
      } else {
        const parsed = tryParseJson(item);
        const matches = evaluateJsonPath(parsed, path);
        const first = matches.length > 0 ? matches[0] : undefined;
        key = first === undefined || first === null
          ? ""
          : typeof first === "string" ? first : JSON.stringify(first);
      }
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    updateNodeData(node.id, {
      listResults: deduped,
      __listResults: deduped,
      __listTotal: deduped.length,
      executionStatus: "completed",
      errorMessage: undefined,
    });
    return Promise.resolve(deduped[0] ?? "");
  }

  if (node.type === "merge-lists") {
    const { nodes: currentNodes, edges: currentEdges, updateNodeData } = useWorkflowStore.getState();
    const mergeData = node.data as MergeListsNodeData;
    const mode = mergeData.mode === "zip" ? "zip" : "concat";

    const items = mode === "zip"
      ? zipMergeLists(collectUpstreamListsPerEdgeFrontend(node.id, currentEdges, currentNodes))
      : collectUpstreamListItemsFrontend(node.id, currentEdges, currentNodes);

    let merged = items;
    if (mergeData.deduplicate === true) {
      const seen = new Set<string>();
      merged = [];
      for (const item of items) {
        if (seen.has(item)) continue;
        seen.add(item);
        merged.push(item);
      }
    }

    updateNodeData(node.id, {
      listResults: merged,
      __listResults: merged,
      __listTotal: merged.length,
      executionStatus: "completed",
      errorMessage: undefined,
    });
    return Promise.resolve(merged[0] ?? "");
  }

  if (node.type === "sort-list") {
    const { nodes: currentNodes, edges: currentEdges, updateNodeData } = useWorkflowStore.getState();
    const sortData = node.data as SortListNodeData;
    const items = collectUpstreamListItemsFrontend(node.id, currentEdges, currentNodes);
    const sorted = sortListItems(items, {
      field: sortData.field ?? "",
      sortType: sortData.sortType ?? "auto",
      direction: sortData.direction ?? "asc",
    });
    updateNodeData(node.id, {
      listResults: sorted,
      __listResults: sorted,
      __listTotal: sorted.length,
      executionStatus: "completed",
      errorMessage: undefined,
    });
    return Promise.resolve(sorted[0] ?? "");
  }

  // Preview — collect upstream values and pass through
  if (node.type === "preview") {
    const {
      nodes: currentNodes,
      edges: currentEdges,
      updateNodeData,
    } = useWorkflowStore.getState();

    const prevData = node.data as PreviewNodeData;
    updateNodeData(node.id, { executionStatus: "running", errorMessage: undefined });

    const { ordered, itemOrder } = collectPreviewItems(node.id, currentNodes, currentEdges, prevData);

    updateNodeData(node.id, {
      previewItems: ordered,
      itemOrder,
      executionStatus: "completed",
    });
    return Promise.resolve("");
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
      return Promise.resolve("");
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
        (result) => {
          updateNodeData(node.id, {
            executionStatus: "completed",
            currentJobId: result.jobId,
            webhookSuccess: result.success,
            webhookStatusCode: result.statusCode,
            webhookResponseBody: result.responseBody,
          });
          return "";
        },
        (err) => {
          updateNodeData(node.id, {
            executionStatus: "failed",
            errorMessage: err instanceof Error ? err.message : "Webhook send failed",
          });
          return "";
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
    node.type === "facebook-post" ||
    node.type === "telegram-post"
  ) {
    const { updateNodeData } = useWorkflowStore.getState();
    const d = node.data as SocialPostData;
    const mediaUrl = overrideMediaUrl ?? inputs.videoUrl ?? inputs.imageUrl ?? inputs.audioUrl;

    // Resolve {Node Label} refs in caption
    const resolvedCaption = resolveTextRefs(d.caption?.trim(), refMap) || inputs.prompt || undefined;

    // Auto-detect Telegram action and collect all connected media
    let action = d.action;
    let mediaItems: Array<{ type: "photo" | "video"; url: string }> | undefined;
    if (d.platform === "telegram") {
      const items: Array<{ type: "photo" | "video"; url: string }> = [];
      if (inputs.imageUrl) items.push({ type: "photo", url: inputs.imageUrl });
      if (inputs.videoUrl) items.push({ type: "video", url: inputs.videoUrl });

      if (items.length >= 2) {
        action = "send-media-group";
        mediaItems = items;
      } else if (items.length === 1) {
        action = items[0].type === "video" ? "send-video" : "send-photo";
      } else {
        action = "send-message";
      }
    } else if (action === "post-carousel" && inputs.mediaItems?.length) {
      mediaItems = inputs.mediaItems;
    }

    updateNodeData(node.id, { executionStatus: "running", errorMessage: undefined });

    return import("@/lib/api").then(({ socialPublishApi }) =>
      socialPublishApi({
        platform: d.platform,
        action,
        connectionId: d.connectionId,
        mediaUrl,
        mediaItems,
        caption: resolvedCaption,
        title: d.title || undefined,
        description: d.description || undefined,
        tags: d.tags,
        privacy: d.privacy,
        chatId: d.chatId,
      }).then(
        (result) => {
          const prev = ((node.data as SocialPostData).generatedResults ?? []) as readonly GeneratedResult[];
          updateNodeData(node.id, {
            executionStatus: "completed",
            currentJobId: result.jobId,
            platformPostId: result.platformPostId,
            platformPostUrl: result.platformPostUrl,
            generatedResults: [{
              jobId: result.jobId,
              url: result.platformPostUrl ?? "",
              timestamp: new Date().toISOString(),
            }, ...prev],
          });
          return result.platformPostUrl ?? "";
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

  // Save to Storage — upload upstream media to R2
  if (node.type === "save-to-storage") {
    const { updateNodeData } = useWorkflowStore.getState();
    const d = node.data as SaveToStorageData;
    const mediaUrl = overrideMediaUrl ?? inputs.videoUrl ?? inputs.imageUrl ?? inputs.audioUrl;
    const mediaType =
      mediaUrl === inputs.videoUrl ? "video"
      : mediaUrl === inputs.imageUrl ? "image"
      : mediaUrl === inputs.audioUrl ? "audio"
      : inputs.videoUrl ? "video"
      : inputs.imageUrl ? "image"
      : inputs.audioUrl ? "audio"
      : undefined;

    if (!mediaUrl) {
      updateNodeData(node.id, { executionStatus: "failed", errorMessage: "No media input connected" });
      return Promise.resolve("");
    }

    updateNodeData(node.id, { executionStatus: "running", errorMessage: undefined });

    return saveToStorageApi({
      mediaUrl,
      filename: d.filename || undefined,
      mediaType,
    }).then(
      (result) => {
        const prev = ((node.data as SaveToStorageData).generatedResults ?? []) as readonly GeneratedResult[];
        updateNodeData(node.id, {
          executionStatus: "completed",
          currentJobId: result.jobId,
          savedUrl: result.url,
          generatedResults: [{
            jobId: result.jobId,
            url: result.url,
            timestamp: new Date().toISOString(),
          }, ...prev],
        });
        return result.url ?? "";
      },
      (err) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err instanceof Error ? err.message : "Save to storage failed",
        });
        return "";
      },
    );
  }

  // QA Check — evaluate content quality via AI
  if (node.type === "qa-check") {
    const { updateNodeData } = useWorkflowStore.getState();
    const d = node.data as QACheckData;
    const content = overridePrompt ?? inputs.prompt ?? "";

    if (!content) {
      updateNodeData(node.id, { executionStatus: "failed", errorMessage: "No content input connected" });
      return Promise.resolve("");
    }

    updateNodeData(node.id, { executionStatus: "running", errorMessage: undefined });

    return qaCheckApi({
      content,
      checkType: d.checkType || "content",
      provider: d.provider || "claude",
      threshold: d.threshold ?? 0.7,
      llmModel: d.llmModel,
    }).then(
      (result) => {
        updateNodeData(node.id, {
          executionStatus: "completed",
          currentJobId: result.jobId,
          score: result.score,
          approved: result.approved,
          reason: result.reason,
        });
        return result.reason ?? "";
      },
      (err) => {
        updateNodeData(node.id, {
          executionStatus: "failed",
          errorMessage: err instanceof Error ? err.message : "QA check failed",
        });
        return "";
      },
    );
  }

  // Component — delegates to the component executor (runs published app via backend)
  if (node.type === "component") {
    return import("./component-executor").then(({ executeComponent }) =>
      executeComponent(node, inputs, ctx),
    )
  }

  // Sub-Workflow — delegates to the sub-workflow executor
  if (node.type === "sub-workflow") {
    return import("./sub-workflow-executor").then(({ executeSubWorkflow }) =>
      executeSubWorkflow(node, ctx).then(() => ""),
    )
  }

  return Promise.resolve("");
}
