import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { buildScenePrompt } from "@/lib/prompt-builder";
import { collectAncestorRefs as sharedCollectAncestorRefs } from "@nodaro-shared/ancestor-refs";
import { isExpandedClone } from "@nodaro-shared/clone-utils";
import type {
  WorkflowNode,
  WorkflowEdge,
  GeneratedResult,
  GeneratedScript,
  GeneratedScriptResult,
  SceneNodeDataType,
  LoopNodeData,
  WebScrapeNodeData,
} from "@/types/nodes";

export function buildExecutionLevels(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[][] {
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  const nodeMap = new Map<string, WorkflowNode>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    inDegree.set(node.id, 0);
    children.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    children.get(edge.source)?.push(edge.target);
  }

  const levels: WorkflowNode[][] = [];
  let currentLevel = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);

  while (currentLevel.length > 0) {
    levels.push(currentLevel);
    const nextLevel: WorkflowNode[] = [];
    const seen = new Set<string>();

    for (const node of currentLevel) {
      for (const childId of children.get(node.id) ?? []) {
        const newDeg = (inDegree.get(childId) ?? 1) - 1;
        inDegree.set(childId, newDeg);
        if (newDeg === 0 && !seen.has(childId)) {
          seen.add(childId);
          const childNode = nodeMap.get(childId);
          if (childNode) nextLevel.push(childNode);
        }
      }
    }

    currentLevel = nextLevel;
  }

  return levels;
}

export function getEffectivelySkippedIds(
  nodes: WorkflowNode[],
  _edges: WorkflowEdge[],
): Set<string> {
  return new Set(
    nodes
      .filter((n) => !!(n.data as Record<string, unknown>).skipped)
      .map((n) => n.id),
  );
}

export function extractNodeOutput(node: WorkflowNode, sourceHandle?: string): string | undefined {
  const data = node.data as Record<string, unknown>;
  const type = node.type;

  if (type === "list") {
    // New format: columns + rows (same as loop)
    const loopData = data as LoopNodeData;
    if (loopData.columns) {
      if (sourceHandle) {
        const colIndex = (loopData.columns ?? []).findIndex(
          (c: { handleId: string }) => c.handleId === sourceHandle,
        );
        if (colIndex >= 0) return loopData.rows?.[0]?.[colIndex]?.trim() || "";
      }
      return loopData.rows?.[0]?.[0]?.trim() || "";
    }
    // Legacy format: items string
    const items = (data.items as string | undefined) || "";
    const lines = items.split("\n").filter((l: string) => l.trim().length > 0);
    return lines[0]?.trim();
  }
  if (type === "loop") {
    const loopData = data as LoopNodeData;
    if (sourceHandle) {
      const colIndex = (loopData.columns ?? []).findIndex(
        (c: { handleId: string }) => c.handleId === sourceHandle,
      );
      if (colIndex >= 0) {
        return loopData.rows?.[0]?.[colIndex]?.trim() || "";
      }
    }
    return loopData.rows?.[0]?.[0]?.trim() || "";
  }
  if (type === "text-prompt") {
    return (data.text as string | undefined)?.trim();
  }
  if (type === "upload-image") {
    const results = (data.generatedResults as GeneratedResult[] | undefined) ?? []
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0
    const directUrl = (data.url as string | undefined)?.trim()
    return directUrl || results[activeIndex]?.url
  }
  if (type === "upload-video") {
    return (data.url as string | undefined)?.trim();
  }
  if (type === "youtube-video") {
    return (
      (data.downloadedVideoUrl as string | undefined)?.trim() ||
      (data.youtubeUrl as string | undefined)?.trim()
    );
  }
  if (type === "upload-audio") {
    return (
      (data.r2Url as string | undefined)?.trim() ||
      (data.url as string | undefined)?.trim()
    );
  }
  if (type === "webhook-trigger") {
    // Return param value by sourceHandle, or first param value, or legacy prompt
    const params = data.params as Array<{ id: string; name: string; type: string }> | undefined;
    const triggerData = data.__triggerData as Record<string, unknown> | undefined;
    if (params && params.length > 0 && triggerData) {
      // If sourceHandle specifies a param, return that param's value
      if (sourceHandle) {
        const param = params.find((p) => p.id === sourceHandle);
        if (param) {
          const val = triggerData[param.name];
          if (val != null) return String(val);
        }
      }
      // Fallback: return first available param value
      for (const p of params) {
        const val = triggerData[p.name];
        if (val != null) return String(val);
      }
    }
    return (data.text as string | undefined)?.trim();
  }
  if (type === "schedule-trigger") {
    return (data.text as string | undefined)?.trim();
  }
  if (type === "telegram-trigger") {
    const triggerData = data.__triggerData as Record<string, unknown> | undefined;
    const fields: Record<string, string> = {
      text: String((triggerData?.text ?? data.text) || ""),
      imageUrl: String((triggerData?.imageUrl ?? data.imageUrl) || ""),
      videoUrl: String((triggerData?.videoUrl ?? data.videoUrl) || ""),
      audioUrl: String((triggerData?.audioUrl ?? data.audioUrl) || ""),
      chatId: String((triggerData?.chatId ?? data.chatId) || ""),
      messageId: String((triggerData?.messageId ?? data.messageId) || ""),
    };
    if (sourceHandle && fields[sourceHandle] !== undefined) {
      return fields[sourceHandle] || undefined;
    }
    // Fallback: return text as primary output
    return fields.text || undefined;
  }
  if (type === "extract-frame") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedImageUrl as string | undefined)
    );
  }
  if (type === "generate-image") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedImageUrl as string | undefined) ??
      (data.url as string | undefined)
    );
  }
  if ((type as string) === "edit-image" || (type as string) === "image-to-image") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedImageUrl as string | undefined)
    );
  }
  if (type === "modify-image" || type === "upscale-image" || type === "remove-background") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedImageUrl as string | undefined)
    );
  }
  if (type === "combine-videos") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedVideoUrl as string | undefined)
    );
  }
  if (
    type === "image-to-video" ||
    type === "video-to-video" ||
    type === "text-to-video" ||
    type === "lip-sync" ||
    type === "speech-to-video" ||
    type === "motion-transfer" ||
    type === "video-upscale" ||
    type === "extend-video" ||
    type === "suno-music-video" ||
    type === "render-video"
  ) {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedVideoUrl as string | undefined)
    );
  }
  // Suno-separate: support stem routing via sourceHandle (matches backend)
  if (type === "suno-separate") {
    if (sourceHandle === "vocal") {
      return (data.vocalUrl as string | undefined) ??
        (data.generatedAudioUrl as string | undefined);
    }
    if (sourceHandle === "instrumental") {
      return (data.instrumentalUrl as string | undefined) ??
        (data.generatedAudioUrl as string | undefined);
    }
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedAudioUrl as string | undefined)
    );
  }
  // Voice-design: support voiceId routing via sourceHandle (matches backend)
  if (type === "voice-design") {
    if (sourceHandle === "voiceId") {
      return data.generatedVoiceId as string | undefined;
    }
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedAudioUrl as string | undefined)
    );
  }
  if (
    type === "text-to-speech" ||
    type === "generate-music" ||
    type === "text-to-audio" ||
    type === "suno-generate" ||
    type === "suno-cover" ||
    type === "suno-extend" ||
    type === "text-to-dialogue" ||
    type === "voice-changer" ||
    type === "dubbing" ||
    type === "voice-remix" ||
    type === "audio-isolation" ||
    type === "suno-mashup" ||
    type === "suno-replace-section" ||
    type === "suno-add-instrumental" ||
    type === "suno-add-vocals" ||
    type === "suno-convert-wav" ||
    type === "suno-upload-extend"
  ) {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedAudioUrl as string | undefined)
    );
  }
  if (type === "suno-lyrics" || type === "suno-style-boost") {
    return data.generatedText as string | undefined;
  }
  if (type === "transcribe") {
    const tResults =
      (data.generatedResults as Array<{ text: string }> | undefined) ?? [];
    const tActiveIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      tResults[tActiveIndex]?.text ??
      (data.generatedText as string | undefined)
    );
  }
  if (type === "image-to-text") {
    const itResults =
      (data.generatedResults as Array<{ text: string }> | undefined) ?? [];
    const itActiveIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      itResults[itActiveIndex]?.text ??
      (data.generatedText as string | undefined)
    );
  }
  if (type === "generate-script") {
    const scriptResults =
      (data.generatedResults as GeneratedScriptResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    const activeScript =
      scriptResults[activeIndex]?.script ??
      (data.generatedScript as GeneratedScript | undefined);
    if (activeScript && activeScript.scenes.length > 0) {
      return activeScript.scenes[0].imagePrompt;
    }
  }
  if (type === "social-media-format") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedVideoUrl as string | undefined) ??
      (data.generatedImageUrl as string | undefined)
    );
  }
  if (
    type === "merge-video-audio" ||
    type === "add-captions" ||
    type === "resize-video" ||
    type === "trim-video" ||
    type === "speed-ramp" ||
    type === "loop-video" ||
    type === "fade-video" ||
    type === "manual-edit" ||
    type === "transcode-video"
  ) {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedVideoUrl as string | undefined)
    );
  }
  if (type === "split-media") {
    // Return first video or audio chunk URL based on sourceHandle
    const videoUrls = (data.generatedVideoUrls as string[] | undefined) ?? [];
    const audioUrls = (data.generatedAudioUrls as string[] | undefined) ?? [];
    if (sourceHandle === "audio-out") return audioUrls[0];
    return videoUrls[0] ?? audioUrls[0];
  }
  if (type === "trim-audio" || type === "mix-audio" || type === "combine-audio") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedAudioUrl as string | undefined)
    );
  }
  if (type === "adjust-volume") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    const lastInputType =
      (data.lastInputType as string | undefined) ?? "audio";
    const fallbackUrl =
      lastInputType === "video"
        ? (data.generatedVideoUrl as string | undefined)
        : (data.generatedAudioUrl as string | undefined);
    return results[activeIndex]?.url ?? fallbackUrl;
  }
  if (type === "reference-audio") {
    return (data.extractedAudioUrl as string | undefined)?.trim();
  }
  if (type === "character") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ?? (data.sourceImageUrl as string | undefined)
    );
  }
  if (type === "face") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ?? (data.sourceImageUrl as string | undefined)
    );
  }
  if (type === "object") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ?? (data.sourceImageUrl as string | undefined)
    );
  }
  if (type === "location") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ?? (data.sourceImageUrl as string | undefined)
    );
  }
  if (type === "scene") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    const imageUrl =
      results[activeIndex]?.url ??
      (data.generatedImageUrl as string | undefined);
    if (imageUrl) return imageUrl;
    const sceneData = data as unknown as SceneNodeDataType;
    const { characterDefinitions } = useWorkflowStore.getState();
    return buildScenePrompt(sceneData, characterDefinitions);
  }
  if (type === "forced-alignment") {
    const alignment = data.alignmentResults as Array<{ word: string; start: number; end: number }> | undefined;
    if (alignment && alignment.length > 0) {
      return JSON.stringify(alignment);
    }
    return undefined;
  }
  if (type === "qa-check") {
    if (data.approved == null) return undefined;
    const qaApproved = data.approved as boolean;
    const qaReason = (data.reason as string | undefined) ?? (qaApproved ? "approved" : "rejected");
    if (sourceHandle === "approved" && qaApproved) return qaReason;
    if (sourceHandle === "rejected" && !qaApproved) return qaReason;
    if (!sourceHandle) return qaReason;
    return undefined;
  }
  if (type === "save-to-storage") {
    return (data.savedUrl as string) || undefined;
  }

  if (type === "webhook-output") {
    return (data.webhookResponseBody as string) || undefined;
  }

  if (type === "ai-writer" || type === "llm-chat") {
    return data.generatedText as string | undefined;
  }
  if (type === "web-scrape") {
    const d = node.data as WebScrapeNodeData;
    // Single json handle — stringify for text consumers; Extract Field reads
    // d.generatedJson directly (bypasses extractNodeOutput).
    if (sourceHandle === "json" || !sourceHandle) {
      return d.generatedJson === undefined ? undefined : JSON.stringify(d.generatedJson);
    }
    return undefined;
  }
  if (type === "combine-text") {
    return data.combinedText as string | undefined;
  }
  if (type === "extract-field") {
    return data.extractedText as string | undefined;
  }
  if (type === "json-process") {
    const result = (data as { processedResult?: unknown }).processedResult;
    if (result === undefined || result === null) return undefined;
    if (Array.isArray(result)) {
      if (result.length === 0) return undefined;
      return typeof result[0] === "string" ? result[0] : JSON.stringify(result[0]);
    }
    return typeof result === "string" ? result : JSON.stringify(result);
  }
  if (type === "preview") {
    // Pass through the first visible upstream value
    const items = (data.previewItems as Array<{ value: string; visible: boolean }> | undefined) ?? [];
    const first = items.find((item) => item.visible !== false);
    return first?.value;
  }
  if (type === "split-text") {
    const splitResults = (data.splitResults as string[] | undefined) ?? [];
    return splitResults.length > 0 ? splitResults[0] : undefined;
  }
  if (type === "after-effects") {
    return (data.effectPlan as Record<string, unknown> | undefined)
      ? "plan-ready"
      : undefined;
  }
  if (type === "lottie-overlay") {
    return (data.overlayPlan as Record<string, unknown> | undefined)
      ? "plan-ready"
      : undefined;
  }
  if (type === "3d-title") {
    return (data.titlePlan as Record<string, unknown> | undefined)
      ? "plan-ready"
      : undefined;
  }
  if (type === "motion-graphics") {
    return (data.motionPlan as Record<string, unknown> | undefined)
      ? "plan-ready"
      : undefined;
  }
  if (type === "composite") {
    return (data.compositePlan as Record<string, unknown> | undefined)
      ? "plan-ready"
      : undefined;
  }
  if (type === "video-composer") {
    return (data.sceneGraph as Record<string, unknown> | undefined)
      ? "plan-ready"
      : undefined;
  }
  // Sub-workflow: return the output for a specific port (via sourceHandle) or visible output
  if (type === "sub-workflow") {
    const outputResults = data.outputResults as Record<string, string> | undefined;
    if (!outputResults) return undefined;
    // If sourceHandle specifies a port (format: "out_<portId>"), return that port's value
    if (sourceHandle) {
      const portId = sourceHandle.replace(/^out_/, "");
      if (outputResults[portId]) return outputResults[portId];
    }
    // Fall back to visible output or first result
    const visiblePortId = (data.routeSnapshot as Record<string, unknown> | undefined)?.visibleOutputPortId as string | undefined;
    if (visiblePortId && outputResults[visiblePortId]) return outputResults[visiblePortId];
    const values = Object.values(outputResults);
    return values.length > 0 ? values[0] : undefined;
  }
  // Component: return the output for a specific port (via sourceHandle) or mediaPreview output
  if (type === "component") {
    const outputResults = data.outputResults as Record<string, string> | undefined;
    if (!outputResults) return undefined;
    // If sourceHandle specifies a port (format: "out_<handleId>"), return that port's value
    if (sourceHandle) {
      const handleId = sourceHandle.replace(/^out_/, "");
      if (outputResults[handleId]) return outputResults[handleId];
    }
    // Fallback: mediaPreview output
    const metadata = data.componentMetadata as { outputs?: Array<{ id: string; mediaPreview?: boolean }> } | undefined;
    if (metadata?.outputs) {
      const previewHandle = metadata.outputs.find((o) => o.mediaPreview);
      if (previewHandle && outputResults[previewHandle.id]) return outputResults[previewHandle.id];
    }
    // Fallback: first available
    const values = Object.values(outputResults);
    return values.length > 0 ? values[0] : undefined;
  }
  // Sub-workflow-input: return injected port value (used inside namespaced execution)
  if (type === "sub-workflow-input") {
    const injected = data.__injectedPortValues as Record<string, string> | undefined;
    if (!injected) return undefined;
    // If sourceHandle specifies a port, return that port's value
    if (sourceHandle && injected[sourceHandle]) return injected[sourceHandle];
    const values = Object.values(injected);
    return values.length > 0 ? values[0] : undefined;
  }
  if (type === "teleport-send" || type === "teleport-receive") {
    const result = data.result as string | undefined
    if (result) return result
    // Follow the teleport chain when result isn't populated (single-node runs)
    const { nodes, edges } = useWorkflowStore.getState()
    const inEdges = edges.filter((e) => e.target === node.id)
    for (const edge of inEdges) {
      const src = nodes.find((n) => n.id === edge.source)
      if (!src) continue
      const upstream = extractNodeOutput(src, edge.sourceHandle ?? undefined)
      if (upstream) return upstream
    }
    return undefined
  }
  if (type === "router") {
    if (!sourceHandle) return (data.result as string | undefined)
    return (data.routeOutputs as Record<string, string | undefined> | undefined)?.[sourceHandle]
  }
  return undefined;
}

/** Collapse expanded clones back to their hidden parent nodes.
 *  Removes clones + clone edges, unhides originals, persists to store.
 *  Returns cleaned { nodes, edges } for the caller to operate on. */
export function collapseExpandedClones(): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
} {
  const { nodes: rawNodes, edges: rawEdges } = useWorkflowStore.getState();
  const hasClones = rawNodes.some((n) => isExpandedClone(n));
  if (!hasClones) return { nodes: rawNodes, edges: rawEdges };

  const cloneIds = new Set(rawNodes.filter((n) => isExpandedClone(n)).map((n) => n.id));
  let nodes = rawNodes.filter((n) => !cloneIds.has(n.id));
  const edges = rawEdges.filter((e) => !cloneIds.has(e.source) && !cloneIds.has(e.target));

  nodes = nodes.map((n) => {
    if (!n.hidden) return n;
    // Don't unhide sub-workflow namespaced nodes — they are cleaned up separately
    if (n.id.startsWith("__sub_")) return n;
    return { ...n, hidden: false };
  });

  useWorkflowStore.setState({ nodes, edges, isDirty: true });
  return { nodes, edges };
}

export const IMAGE_SOURCE_TYPES = new Set([
  "generate-image",
  "upload-image",
  "edit-image",
  "image-to-image",
  "modify-image",
  "upscale-image",
  "remove-background",
  "extract-frame",
  "character",
  "face",
  "object",
  "location",
  "scene",
]);
export const VIDEO_SOURCE_TYPES_FOR_RENDER = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "upload-video",
  "youtube-video",
  "combine-videos",
  "lip-sync",
  "speech-to-video",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  "suno-music-video",
  "merge-video-audio",
  "add-captions",
  "resize-video",
  "social-media-format",
  "trim-video",
  "render-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "transcode-video",
  "manual-edit",
]);
export const AUDIO_SOURCE_TYPES = new Set([
  "text-to-speech",
  "text-to-audio",
  "generate-music",
  "upload-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-separate",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-convert-wav",
  "suno-upload-extend",
  "trim-audio",
  "mix-audio",
  "combine-audio",
  "adjust-volume",
  "reference-audio",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "voice-design",
  "audio-isolation",
]);

export const IMAGE_URL_RE = /^https?:\/\/.*\.(png|jpe?g|gif|webp|svg|bmp)/i
export const VIDEO_URL_RE = /^https?:\/\/.*\.(mp4|mov|webm|avi|mkv)/i
export const AUDIO_URL_RE = /^https?:\/\/.*\.(mp3|wav|ogg|aac|flac|m4a)/i

/** Determine the preview item type from a node type and/or its output URL. */
export function detectPreviewItemType(
  nodeType: string,
  value?: string,
): "image" | "video" | "audio" | "data" | "text" {
  if (IMAGE_SOURCE_TYPES.has(nodeType)) return "image"
  if (VIDEO_SOURCE_TYPES_FOR_RENDER.has(nodeType)) return "video"
  if (AUDIO_SOURCE_TYPES.has(nodeType)) return "audio"
  if (nodeType === "forced-alignment") return "data"
  if (value) {
    if (IMAGE_URL_RE.test(value)) return "image"
    if (VIDEO_URL_RE.test(value)) return "video"
    if (AUDIO_URL_RE.test(value)) return "audio"
  }
  return "text"
}

export function collectMediaAssets(
  node: WorkflowNode,
  allEdges: WorkflowEdge[],
  allNodes: WorkflowNode[],
): Array<{
  id: string;
  type: "image" | "video" | "audio";
  url: string;
  label?: string;
  thumbnailUrl?: string;
}> {
  const assetMap = new Map<
    string,
    {
      id: string;
      type: "image" | "video" | "audio";
      url: string;
      label?: string;
      thumbnailUrl?: string;
    }
  >();
  const incomingEdges = allEdges.filter((e) => e.target === node.id);
  for (const edge of incomingEdges) {
    const sourceNode = allNodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;
    const output = extractNodeOutput(sourceNode);
    if (!output) continue;
    const srcType = sourceNode.type ?? "";
    const srcData = sourceNode.data as Record<string, unknown>;
    const label = srcData.label as string | undefined;
    // Extract thumbnail: for images use the output URL itself, for videos check generatedResults or thumbnailUrl
    let thumbnailUrl: string | undefined;
    if (IMAGE_SOURCE_TYPES.has(srcType)) {
      thumbnailUrl = output;
    } else {
      const results = (srcData.generatedResults as Array<{ url?: string; thumbnailUrl?: string }> | undefined) ?? [];
      const activeIdx = (srcData.activeResultIndex as number | undefined) ?? 0;
      thumbnailUrl = results[activeIdx]?.thumbnailUrl ?? (srcData.thumbnailUrl as string | undefined);
    }
    if (IMAGE_SOURCE_TYPES.has(srcType)) {
      assetMap.set(sourceNode.id, {
        id: sourceNode.id,
        type: "image",
        url: output,
        label,
        thumbnailUrl,
      });
    } else if (VIDEO_SOURCE_TYPES_FOR_RENDER.has(srcType)) {
      assetMap.set(sourceNode.id, {
        id: sourceNode.id,
        type: "video",
        url: output,
        label,
        thumbnailUrl,
      });
    } else if (AUDIO_SOURCE_TYPES.has(srcType)) {
      assetMap.set(sourceNode.id, {
        id: sourceNode.id,
        type: "audio",
        url: output,
        label,
      });
    }
  }
  const nodeData = node.data as Record<string, unknown>;
  const assetOrder = (nodeData.assetOrder as string[]) ?? [];
  const orderedIds = [
    ...assetOrder.filter((id) => assetMap.has(id)),
    ...[...assetMap.keys()].filter((id) => !assetOrder.includes(id)),
  ];
  return orderedIds.map((id) => assetMap.get(id)!).filter(Boolean);
}

// Re-export shared constant for local use and external imports
import { ASPECT_RATIO_DIMENSIONS } from "@nodaro-shared/model-constants";
export { ASPECT_RATIO_DIMENSIONS };

export function buildAutoComposition(
  assets: Array<{
    id: string;
    type: "image" | "video" | "audio";
    url: string;
  }>,
  fps: number,
  totalDuration: number,
  aspectRatio: string,
  backgroundColor: string,
): Record<string, unknown> {
  const visualAssets = assets.filter((a) => a.type !== "audio");
  const audioAssets = assets.filter((a) => a.type === "audio");

  const perAssetDuration =
    visualAssets.length > 0 ? totalDuration / visualAssets.length : totalDuration;
  const perAssetFrames = Math.round(perAssetDuration * fps);
  const transitionFrames = 15;
  const lastIndex = Math.max(visualAssets.length - 1, 0);

  const tracks: unknown[] = [];

  if (visualAssets.length > 0) {
    const mediaSegments = visualAssets.map((asset, i) => ({
      id: `seg_${i}`,
      src: asset.url,
      mediaType: asset.type as "image" | "video",
      startFrame: i * perAssetFrames,
      durationInFrames: perAssetFrames,
      layout: { mode: "fullscreen" as const },
      transitionIn:
        i > 0
          ? { type: "fade", durationFrames: transitionFrames }
          : undefined,
      transitionOut:
        i < lastIndex
          ? { type: "fade", durationFrames: transitionFrames }
          : undefined,
      effects:
        asset.type === "image"
          ? [{ type: "ken-burns", startValue: 1.0, endValue: 1.1 }]
          : [],
    }));
    tracks.push({
      id: "track_media",
      type: "media",
      zIndex: 0,
      segments: mediaSegments,
    });
  }

  audioAssets.forEach((audio, i) => {
    tracks.push({
      id: `track_audio_${i}`,
      type: "audio",
      src: audio.url,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      startFrame: 0,
    });
  });

  const dimensions =
    ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? ASPECT_RATIO_DIMENSIONS["16:9"];

  return {
    fps,
    width: dimensions.width,
    height: dimensions.height,
    durationInFrames: Math.round(totalDuration * fps),
    backgroundColor,
    tracks,
  };
}

export function collectAncestorRefs(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  visited = new Set<string>(),
): string[] {
  return sharedCollectAncestorRefs(
    nodeId,
    nodes,
    edges,
    (src) => extractNodeOutput(src),
    visited,
  );
}
