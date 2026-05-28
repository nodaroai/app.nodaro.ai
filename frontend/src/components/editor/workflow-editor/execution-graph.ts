import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { collectAncestorRefs as sharedCollectAncestorRefs } from "@nodaro/shared";
import { isExpandedClone } from "@nodaro/shared";
import { PARAMETER_NODE_TYPES } from "@nodaro/shared";
import { getParameterPromptHint } from "@nodaro/shared";
import {
  aggregateByType,
  buildChildrenByParent,
  getOutputType,
  isAggregateableType,
  isCollectInEdge,
  parseGroupHandle,
  type AggregationBuckets,
  type Member,
} from "@nodaro/shared";
import type {
  WorkflowNode,
  WorkflowEdge,
  GeneratedResult,
  GeneratedScript,
  GeneratedScriptResult,
  LoopNodeData,
  SelectorNodeData,
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

  // Implicit child → group dependency: a Group's output is computed from its
  // children (computeGroupBuckets), so it must be ordered AFTER all children
  // have executed. Without this, the topological walk could schedule the
  // group on the same level as its children and read stale/undefined output.
  const childrenByGroup = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId) {
      const list = childrenByGroup.get(n.parentId);
      if (list) list.push(n.id);
      else childrenByGroup.set(n.parentId, [n.id]);
    }
  }
  for (const g of nodes) {
    if (g.type !== "group") continue;
    const childIds = childrenByGroup.get(g.id);
    if (!childIds) continue;
    for (const cid of childIds) {
      inDegree.set(g.id, (inDegree.get(g.id) ?? 0) + 1);
      children.get(cid)?.push(g.id);
    }
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

/**
 * Compute Group output buckets by reading children (parentId === group.id),
 * classifying each by getOutputType, and reading scalar values via extractNodeOutput.
 * Skips "data"-typed children (multi-output + parameter pickers).
 * Sort: top-to-bottom by node.position.y so visual order = array order.
 */
export function computeGroupBuckets(
  group: WorkflowNode,
  allNodes: WorkflowNode[],
): AggregationBuckets {
  const children = allNodes
    .filter((n) => n.parentId === group.id)
    .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0));
  const members: Member[] = [];
  for (const child of children) {
    const t = getOutputType(child.type);
    if (!isAggregateableType(t)) continue;
    const value = extractNodeOutput(child);
    if (value === undefined) continue;
    members.push({ nodeId: child.id, type: t, value });
  }
  return aggregateByType(members);
}

/**
 * Compute Collect output buckets by reading upstream connections to the "in" handle,
 * sorted by data.order (with arrival-order fallback for unrecorded entries),
 * classifying each by getOutputType (sourceHandle aware for multi-output upstream),
 * and reading values via extractNodeOutput(src, edge.sourceHandle).
 */
export function computeCollectBuckets(
  collect: WorkflowNode,
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
): AggregationBuckets {
  const incomingEdges = edges.filter(
    (e) => e.target === collect.id && isCollectInEdge(e),
  );
  const order = ((collect.data as { order?: string[] })?.order) ?? [];
  const rank = (sid: string): number => {
    const i = order.indexOf(sid);
    return i === -1 ? Infinity : i;
  };
  const byOrder = (a: WorkflowEdge, b: WorkflowEdge): number =>
    rank(a.source) - rank(b.source);
  const sorted = [...incomingEdges].sort(byOrder);
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  const members: Member[] = [];
  for (const edge of sorted) {
    const src = nodesById.get(edge.source);
    if (!src) continue;
    const t = getOutputType(src.type);
    if (!isAggregateableType(t)) continue;
    const value = extractNodeOutput(src, edge.sourceHandle ?? undefined);
    if (value === undefined) continue;
    members.push({ nodeId: src.id, type: t, value });
  }
  return aggregateByType(members);
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
  if (type === "suno-voice") {
    // Primary output is the KIE voice persona id; downstream Suno music nodes
    // read this as `personaId`. Returns undefined when the user hasn't completed
    // setup, which downstream consumers should treat as "no persona".
    return (data.voiceId as string | undefined)?.trim() || undefined
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
    const scheduleText = (data.text as string | undefined)?.trim();
    if (scheduleText) return scheduleText;
    const triggerData = data.__triggerData as Record<string, unknown> | undefined;
    return (triggerData?.timestamp as string | undefined)?.trim();
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
  // Generate-mask has dual output handles: "image" (passthrough source) +
  // "mask" (the generated PNG). The bespoke per-result shape is
  // { imageUrl, maskUrl } (not GeneratedResult.url) so this case must come
  // BEFORE any generic image-node fallthrough that reads `results[i].url`.
  if (type === "generate-mask") {
    const results =
      (data.generatedResults as Array<{ imageUrl: string; maskUrl: string }> | undefined) ?? [];
    const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
    const active = results[activeIndex];
    if (sourceHandle === "mask") {
      return active?.maskUrl ?? (data.generatedMaskUrl as string | undefined);
    }
    return active?.imageUrl ?? (data.generatedImageUrl as string | undefined);
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
    // Unified video node — dispatches to i2v/t2v worker handlers, which write
    // the same `generatedVideoUrl` / per-result `url` fields back onto node.data.
    // Mirrors backend output-extractor's VIDEO_RESULT_TYPES so "Run from here"
    // / DAG resume hydrates downstream nodes from a previously-executed
    // generate-video without re-running.
    type === "generate-video" ||
    type === "lip-sync" ||
    type === "speech-to-video" ||
    type === "motion-transfer" ||
    type === "video-upscale" ||
    type === "extend-video" ||
    type === "video-retake" ||
    type === "face-swap" ||
    type === "video-sfx" ||
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
  // Suno-separate: support stem routing via sourceHandle (matches backend).
  // The Batch 2 rename normalized vocal-out → vocals and
  // instrumental-out → instrumental; accept both spellings as a safety net
  // for edges that bypass loadWorkflow's migration (MCP-built workflows
  // etc.).
  if (type === "suno-separate") {
    if (sourceHandle === "vocals" || sourceHandle === "vocal" || sourceHandle === "vocal-out") {
      return (data.vocalUrl as string | undefined) ??
        (data.generatedAudioUrl as string | undefined);
    }
    if (sourceHandle === "instrumental" || sourceHandle === "instrumental-out") {
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
    // Phase 1B.2 pipeline-managed SceneNode — outputs are populated by the
    // pipeline orchestrator in Phase 1C, not the workflow worker. Source
    // handles: `video` (composite_video.url), `last_frame` (last_frame.url),
    // `audio_track` (scene_audio_track.url). Defaults to `video` when no
    // handle is specified. Returns undefined when the pipeline hasn't yet
    // produced output (1B.2 ships with all fields null).
    const asAssetRef = (v: unknown): string | undefined => {
      if (!v || typeof v !== "object") return undefined;
      const url = (v as { url?: unknown }).url;
      return typeof url === "string" ? url : undefined;
    };
    if (sourceHandle === "last_frame") return asAssetRef(data.last_frame);
    if (sourceHandle === "audio_track") return asAssetRef(data.scene_audio_track);
    return asAssetRef(data.composite_video);
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
  if (type === "image-critic") {
    if (data.approved == null) return undefined; // not yet executed — downstream waits
    const isApproved = data.approved as boolean;
    const feedback = (data.feedback as string | undefined) ?? ""; // empty string, not placeholder
    if (sourceHandle === "approved" && isApproved) return feedback;
    if (sourceHandle === "rejected" && !isApproved) return feedback;
    if (!sourceHandle) return feedback; // legacy / FieldMappings fallback
    return undefined; // wrong-side edge — downstream doesn't fire
  }
  if (type === "save-to-storage") {
    return (data.savedUrl as string) || undefined;
  }

  if (type === "webhook-output") {
    return (data.webhookResponseBody as string) || undefined;
  }

  if ((type as string) === "ai-writer" || type === "llm-chat") {
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
  if (type === "selector") {
    // Dual-output: pick channel by edge sourceHandle. "rest" emits the unselected
    // remainder; any other handle (typically "picked", or omitted) emits the
    // selected items. Falls back to in-store `pickedResults`/`restResults`
    // snapshots if the runtime mirrors (`__*`) aren't populated yet.
    const selectorData = data as SelectorNodeData;
    const results = sourceHandle === "rest"
      ? (selectorData.__restResults ?? selectorData.restResults)
      : (selectorData.__pickedResults ?? selectorData.pickedResults);
    return results && results.length > 0 ? results[0] : undefined;
  }
  if (type === "filter-list" || type === "deduplicate" || type === "merge-lists" || type === "sort-list") {
    const listResults =
      ((data as { __listResults?: string[] }).__listResults) ??
      ((data as { listResults?: string[] }).listResults);
    return listResults && listResults.length > 0 ? listResults[0] : undefined;
  }
  // Reduce (fan-in) — folds N upstream branch results into a single string.
  // The primary output is `data.result` (set by the reduce executor after the
  // strategy runs). Mirrors backend output-extractor.ts case "reduce".
  if (type === "reduce") {
    return (data as { result?: string }).result;
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
  // Group node — surfaces the FIRST item of the requested type bucket
  // (scalar, matches the string | undefined return type). Multi-item access
  // happens through extractNodeOutputAsList in Task E2.
  if (type === "group") {
    const { nodes } = useWorkflowStore.getState();
    const buckets = computeGroupBuckets(node, nodes);
    const requestedType = parseGroupHandle(sourceHandle);
    return requestedType ? buckets[requestedType][0] : undefined;
  }
  // Collect node — surfaces the FIRST item of the requested type bucket
  // (scalar). Inputs are sorted by data.order. Multi-item access happens
  // through extractNodeOutputAsList in Task E2.
  if (type === "collect") {
    const { nodes, edges } = useWorkflowStore.getState();
    const buckets = computeCollectBuckets(node, nodes, edges);
    const requestedType = parseGroupHandle(sourceHandle);
    return requestedType ? buckets[requestedType][0] : undefined;
  }
  // Generative pipeline — leaf node in Phase 1A. Surfaces the final video URL
  // once the pipeline completes, falling back to the pipeline_id for
  // intermediate states. The actual orchestration runs out-of-band via
  // POST /v1/pipelines (see GenerativePipelineConfig).
  if (type === "generative-pipeline") {
    const finalVideoUrl = (data.final_video_url as string | undefined)?.trim()
    if (finalVideoUrl) return finalVideoUrl
    return (data.pipeline_id as string | undefined)?.trim() || undefined
  }
  // Parameter nodes (framing, camera-motion, person, mood, pose, styling,
  // tone, etc.) carry values directly in data — no execution, no state.
  // Return the FULL prompt hint so consumers feeding the value into a text
  // input (Text Prompt, LLM Chat, Combine Text, AI generation prompt handles)
  // see the rich descriptive clause that the cinematography handle injects.
  // Field-mapping resolution bypasses this in `resolve-field-mappings.ts` to
  // keep getting the bare picker value for non-text mapped fields.
  if (type && PARAMETER_NODE_TYPES.has(type)) {
    const { nodes, edges } = useWorkflowStore.getState();
    const hint = getParameterPromptHint(node, { nodes, edges });
    return hint || undefined;
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
  // Generate Video — unified video node (Task 6.1). Mirrors backend
  // execution-graph's VIDEO_SOURCE_TYPES so detectPreviewItemType /
  // collectMediaAssets treat its output as video.
  "generate-video",
  "upload-video",
  "youtube-video",
  "combine-videos",
  "lip-sync",
  "speech-to-video",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  "video-retake",
  "face-swap",
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
  "video-sfx",
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

export const IMAGE_URL_RE = /^https?:\/\/.*\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|heif)/i
export const VIDEO_URL_RE = /^https?:\/\/.*\.(mp4|mov|webm|avi|mkv)/i
export const AUDIO_URL_RE = /^https?:\/\/.*\.(mp3|wav|ogg|aac|flac|m4a)/i

/** Determine the preview item type from a node type and/or its output URL. */
export function detectPreviewItemType(
  nodeType: string,
  value?: string,
  sourceHandle?: string,
): "image" | "video" | "audio" | "data" | "text" {
  if (nodeType === "voice-design" && sourceHandle === "voiceId") return "text"
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
import { ASPECT_RATIO_DIMENSIONS } from "@nodaro/shared";
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
