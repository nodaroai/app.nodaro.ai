import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { buildScenePrompt } from "@/lib/prompt-builder";
import type {
  WorkflowNode,
  WorkflowEdge,
  GeneratedResult,
  GeneratedScript,
  GeneratedScriptResult,
  SceneNodeDataType,
  LoopNodeData,
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
  edges: WorkflowEdge[],
): Set<string> {
  const directlySkipped = new Set(
    nodes
      .filter((n) => !!(n.data as Record<string, unknown>).skipped)
      .map((n) => n.id),
  );
  const effectivelySkipped = new Set(directlySkipped);

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (effectivelySkipped.has(node.id)) continue;

      const parentIds = edges
        .filter((e) => e.target === node.id)
        .map((e) => e.source);

      if (
        parentIds.length > 0 &&
        parentIds.every((pid) => effectivelySkipped.has(pid))
      ) {
        effectivelySkipped.add(node.id);
        changed = true;
      }
    }
  }

  return effectivelySkipped;
}

export function extractNodeOutput(node: WorkflowNode): string | undefined {
  const data = node.data as Record<string, unknown>;
  const type = node.type;

  if (type === "list") {
    const items = (data.items as string | undefined) || "";
    const lines = items
      .split("\n")
      .filter((l: string) => l.trim().length > 0);
    return lines[0]?.trim();
  }
  if (type === "loop") {
    const loopData = data as LoopNodeData;
    return loopData.rows?.[0]?.[0]?.trim() || "";
  }
  if (type === "text-prompt") {
    return (data.text as string | undefined)?.trim();
  }
  if (type === "upload-image") {
    return (data.url as string | undefined)?.trim();
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
  if (type === "edit-image") {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedImageUrl as string | undefined)
    );
  }
  if (type === "image-to-image") {
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
    type === "motion-transfer" ||
    type === "video-upscale" ||
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
  if (
    type === "text-to-speech" ||
    type === "generate-music" ||
    type === "text-to-audio" ||
    type === "suno-generate" ||
    type === "suno-cover" ||
    type === "suno-extend" ||
    type === "suno-separate" ||
    type === "text-to-dialogue"
  ) {
    const results =
      (data.generatedResults as GeneratedResult[] | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    return (
      results[activeIndex]?.url ??
      (data.generatedAudioUrl as string | undefined)
    );
  }
  if (type === "suno-lyrics") {
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
  if (type === "extract-audio" || type === "mix-audio") {
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
  if (type === "ai-writer") {
    return data.generatedText as string | undefined;
  }
  if (type === "combine-text") {
    return data.combinedText as string | undefined;
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
  return undefined;
}

/** Collapse expanded clones back to their hidden parent nodes.
 *  Removes clones + clone edges, unhides originals, persists to store.
 *  Returns cleaned { nodes, edges } for the caller to operate on. */
export function collapseExpandedClones(): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
} {
  let { nodes, edges } = useWorkflowStore.getState();
  const iterPattern = /_iter_\d+$/;
  const cloneIds = new Set(
    nodes
      .filter(
        (n) =>
          !!(n.data as Record<string, unknown>).__expandedClone ||
          iterPattern.test(n.id),
      )
      .map((n) => n.id),
  );
  if (cloneIds.size === 0) return { nodes, edges };

  nodes = nodes.filter((n) => !cloneIds.has(n.id));
  edges = edges.filter(
    (e) => !cloneIds.has(e.source) && !cloneIds.has(e.target),
  );

  nodes = nodes.map((n) => {
    if (!n.hidden) return n;
    return { ...n, hidden: false };
  });

  useWorkflowStore.setState({ nodes, edges, isDirty: true });
  return { nodes, edges };
}

const IMAGE_SOURCE_TYPES = new Set([
  "generate-image",
  "upload-image",
  "edit-image",
  "image-to-image",
]);
const VIDEO_SOURCE_TYPES_FOR_RENDER = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "upload-video",
  "youtube-video",
  "combine-videos",
  "lip-sync",
  "motion-transfer",
  "video-upscale",
  "suno-music-video",
  "merge-video-audio",
  "add-captions",
  "resize-video",
  "trim-video",
]);
const AUDIO_SOURCE_TYPES = new Set([
  "text-to-speech",
  "text-to-audio",
  "generate-music",
  "upload-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-separate",
  "extract-audio",
  "mix-audio",
  "adjust-volume",
  "reference-audio",
]);

export function collectMediaAssets(
  node: WorkflowNode,
  allEdges: WorkflowEdge[],
  allNodes: WorkflowNode[],
): Array<{
  id: string;
  type: "image" | "video" | "audio";
  url: string;
  label?: string;
}> {
  const assetMap = new Map<
    string,
    {
      id: string;
      type: "image" | "video" | "audio";
      url: string;
      label?: string;
    }
  >();
  const incomingEdges = allEdges.filter((e) => e.target === node.id);
  for (const edge of incomingEdges) {
    const sourceNode = allNodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;
    const output = extractNodeOutput(sourceNode);
    if (!output) continue;
    const srcType = sourceNode.type ?? "";
    const label = (sourceNode.data as Record<string, unknown>).label as
      | string
      | undefined;
    if (IMAGE_SOURCE_TYPES.has(srcType)) {
      assetMap.set(sourceNode.id, {
        id: sourceNode.id,
        type: "image",
        url: output,
        label,
      });
    } else if (VIDEO_SOURCE_TYPES_FOR_RENDER.has(srcType)) {
      assetMap.set(sourceNode.id, {
        id: sourceNode.id,
        type: "video",
        url: output,
        label,
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

const ASPECT_RATIO_DIMENSIONS: Record<
  string,
  { width: number; height: number }
> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

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

const IMAGE_REF_TYPES = new Set([
  "upload-image",
  "face",
  "character",
  "object",
  "location",
  "generate-image",
  "edit-image",
  "image-to-image",
]);
const PASSTHROUGH_TYPES = new Set([
  "ai-writer",
  "split-text",
  "combine-text",
  "text-prompt",
  "loop",
  "list",
]);

export function collectAncestorRefs(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  visited = new Set<string>(),
): string[] {
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);
  const refs: string[] = [];
  const incoming = edges.filter((e) => e.target === nodeId);
  for (const edge of incoming) {
    const src = nodes.find((n) => n.id === edge.source);
    if (!src) continue;
    if (IMAGE_REF_TYPES.has(src.type ?? "")) {
      const url = extractNodeOutput(src);
      if (url?.trim()) refs.push(url.trim());
    }
    if (PASSTHROUGH_TYPES.has(src.type ?? "")) {
      refs.push(...collectAncestorRefs(src.id, nodes, edges, visited));
    }
  }
  return refs;
}
