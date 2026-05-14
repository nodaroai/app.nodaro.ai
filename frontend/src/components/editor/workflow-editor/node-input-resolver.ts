import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { buildScenePrompt } from "@/lib/prompt-builder";
import { buildNodeRefMap, resolveTextRefs } from "@/lib/node-refs";
import type {
  WorkflowNode,
  WorkflowEdge,
  GenerateImageData,
  AdjustVolumeData,
  SceneNodeDataType,
  GeneratedResult,
  LoopNodeData,
} from "@/types/nodes";
import { loopColInputHandle } from "@/types/nodes";
import { extractNodeOutput, IMAGE_URL_RE, VIDEO_URL_RE, AUDIO_URL_RE } from "./execution-graph";
import { PARAMETER_NODE_TYPES } from "@nodaro/shared";
import { resolveIndex, selectListItems, type SelectorFields } from "@nodaro/shared";
import { splitByLoopDelimiter } from "@nodaro/shared";
import { extractAllGeneratedResults, extractGeneratedJsonAsList } from "@nodaro/shared";
import { SOCIAL_POST_NODE_TYPES } from "@nodaro/shared";
import { resolveSourceThroughConnectedList } from "@nodaro/shared";
import { VARIABLES_HANDLE_ID } from "@nodaro/shared";
export { resolveSourceThroughConnectedList };

/** Follow teleport chain to find the original non-teleport source node. */
function resolveTeleportOrigin(node: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode {
  let current = node
  const visited = new Set<string>()
  while ((current.type === "teleport-send" || current.type === "teleport-receive") && !visited.has(current.id)) {
    visited.add(current.id)
    const inEdge = edges.find((e) => e.target === current.id)
    if (!inEdge) break
    const upstream = nodes.find((n) => n.id === inEdge.source)
    if (!upstream) break
    current = upstream
  }
  return current
}

type EdgeLike = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: unknown };
type NodeLike = { id: string; type?: string; data: Record<string, unknown> };
type SplitColumns = ReadonlyArray<{ id: string; handleId: string; type?: string; splitDelimiter?: string }> | undefined;

/** Extract-field emits structured __listResults only when configured as "list". */
function isExtractFieldListMode(node: { type?: string; data: Record<string, unknown> }): boolean {
  return node.type === "extract-field" && (node.data.outputType ?? "text") === "list"
}

/** Node types whose output is already a structured list — downstream consumers
 *  must NOT re-split items by their own delimiter. Includes the manual rows
 *  of loop/list (which materialise per-row) and split-text / list-transform
 *  variants (which materialise via __listResults). */
const STRUCTURED_LIST_TYPES = new Set([
  "loop",
  "list",
  "split-text",
  "json-process",
  "filter-list",
  "deduplicate",
  "merge-lists",
  "sort-list",
])

function isStructuredListNode(node: { type?: string; data: Record<string, unknown> }): boolean {
  return STRUCTURED_LIST_TYPES.has(node.type ?? "") || isExtractFieldListMode(node)
}

/**
 * Resolve values flowing through `edge` for a loop/list table UI cell. Honors
 * the edge's outputMode AND selector (range/list). Returns a single-item array
 * for item/last modes, a filtered list for each/all, or a delimiter split when
 * upstream is a single text. Used by loop-node and table config panels so they
 * stay in sync with runtime resolution.
 */
export function resolveEdgeValuesForTableColumn(
  edge: EdgeLike,
  upstream: NodeLike,
  edges: ReadonlyArray<EdgeLike>,
  nodes: ReadonlyArray<NodeLike>,
  columns: SplitColumns,
): string[] | null {
  const ed = edge.data as Record<string, unknown> | undefined;
  const selector = ed as SelectorFields | undefined;
  const outputMode = (ed?.outputMode as string | undefined) ?? "each";

  const allOutputs = (upstream.type === "loop" || upstream.type === "list")
    ? resolveLoopColumnValues(upstream, edge.sourceHandle ?? undefined, edges, nodes)
    : (extractNodeOutputAsList(upstream as WorkflowNode) ?? []);

  // Already-structured upstreams (loop/list/split-text/json-process/etc.) emit
  // logical items — downstream consumers must NOT re-chop them by the target
  // column's delimiter. Plain text upstreams DO get split.
  const isStructured = isStructuredListNode(upstream)
  const splitOrPassthrough = (single: string): string[] =>
    isStructured ? [single] : splitByLoopDelimiter(single, columns)

  if (outputMode === "item") {
    const itemIndex = ed?.itemIndex as string | undefined;
    if (allOutputs.length > 0) {
      const idx = resolveIndex(itemIndex ?? "1", allOutputs.length);
      return splitOrPassthrough(allOutputs[idx] ?? allOutputs[0]);
    }
    const single = extractNodeOutput(upstream as WorkflowNode, edge.sourceHandle ?? undefined);
    return single ? splitOrPassthrough(single) : null;
  }
  if (outputMode.startsWith("item:")) {
    const idx = parseInt(outputMode.split(":")[1], 10);
    if (allOutputs.length > 0) return splitOrPassthrough(allOutputs[idx] ?? allOutputs[0]);
    const single = extractNodeOutput(upstream as WorkflowNode, edge.sourceHandle ?? undefined);
    return single ? splitOrPassthrough(single) : null;
  }
  if (outputMode === "last") {
    // "last" here = the source's currently *selected* result (activeResultIndex),
    // NOT the array tail. The word "last" inside range/list expressions DOES mean
    // the final array index — handled separately by resolveIndex/selectListItems.
    const single = extractNodeOutput(upstream as WorkflowNode, edge.sourceHandle ?? undefined);
    return single ? splitOrPassthrough(single) : null;
  }
  if (outputMode === "each" || outputMode === "all") {
    const items = isStructured
      ? allOutputs
      : (allOutputs.length > 0
          ? allOutputs.flatMap((item) => splitByLoopDelimiter(item, columns))
          : ((): string[] => {
              const single = extractNodeOutput(upstream as WorkflowNode, edge.sourceHandle ?? undefined);
              return single ? splitByLoopDelimiter(single, columns) : [];
            })());
    if (items.length > 0) return selectListItems(items, selector);
    return null;
  }
  const single = extractNodeOutput(upstream as WorkflowNode, edge.sourceHandle ?? undefined);
  if (!single) return null;
  return splitByLoopDelimiter(single, columns);
}

/**
 * Resolve a list of values flowing through `edge` from `upstreamNode`, applying
 * the edge's selector filter. Recurses into upstream loop/list so chained
 * filters compose. Falls back to delimiter-split when upstream has no list.
 */
function resolveUpstreamWithEdgeFilter(
  upstreamNode: WorkflowNode,
  edge: { sourceHandle?: string | null; data?: unknown },
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: unknown }>,
  nodes: ReadonlyArray<{ id: string; type?: string; data: Record<string, unknown> }>,
  splitColumns: ReadonlyArray<{ id: string; handleId: string; type?: string; splitDelimiter?: string }> | undefined,
): string[] | undefined {
  const edgeData = edge.data as Record<string, unknown> | undefined;
  const selector = edgeData as SelectorFields | undefined;
  const outputMode = edgeData?.outputMode as string | undefined;

  // Single-value edge modes short-circuit before list expansion so chained
  // list/loop columns don't silently fan back out. "last" = "Selected" (reads
  // activeResultIndex), "item" = pick a specific index. The word "last" inside
  // range/list expressions is handled separately by resolveIndex below.
  if (outputMode === "last") {
    const single = extractNodeOutput(upstreamNode, edge.sourceHandle ?? undefined);
    return single ? [single.trim()] : undefined;
  }
  if (outputMode === "item" || outputMode?.startsWith("item:")) {
    const raw = upstreamNode.type === "loop" || upstreamNode.type === "list"
      ? resolveLoopColumnValues(
          { id: upstreamNode.id, data: upstreamNode.data as Record<string, unknown> },
          edge.sourceHandle ?? undefined,
          edges,
          nodes,
        )
      : (extractNodeOutputAsList(upstreamNode) ?? []);
    if (raw.length === 0) {
      const single = extractNodeOutput(upstreamNode, edge.sourceHandle ?? undefined);
      return single ? [single.trim()] : undefined;
    }
    let idx = 0;
    if (outputMode === "item") {
      const itemIndex = edgeData?.itemIndex as string | undefined;
      idx = resolveIndex(itemIndex ?? "1", raw.length);
    } else {
      idx = parseInt(outputMode.split(":")[1], 10);
    }
    const picked = raw[idx] ?? raw[0];
    return picked ? [picked.trim()] : undefined;
  }

  let upstreamVals: string[] | undefined;
  if (upstreamNode.type === "loop" || upstreamNode.type === "list") {
    upstreamVals = resolveLoopColumnValues(
      { id: upstreamNode.id, data: upstreamNode.data as Record<string, unknown> },
      edge.sourceHandle ?? undefined,
      edges,
      nodes,
    );
  } else {
    const raw = extractNodeOutputAsList(upstreamNode);
    // Already-structured sources produce logical items — preserve them even
    // when there's a single item, so downstream doesn't re-split by newline.
    // Matches resolveEdgeValuesForTableColumn.
    const isAlreadyStructured = isStructuredListNode(upstreamNode)
    if (raw && (isAlreadyStructured || raw.length > 1)) upstreamVals = raw;
  }

  if (upstreamVals && upstreamVals.length > 0) {
    const filtered = selectListItems(upstreamVals, selector);
    if (filtered.length > 0) return filtered.map((v) => v.trim());
  }

  const upstreamOutput = extractNodeOutput(upstreamNode, edge.sourceHandle ?? undefined);
  if (upstreamOutput) {
    return splitByLoopDelimiter(upstreamOutput, splitColumns).map((v) => v.trim());
  }
  return undefined;
}

/** Resolve raw values for a loop column: per-column connected edge -> legacy "in" edge -> manual rows. */
export function resolveLoopColumnValues(
  loopNode: { id: string; data: Record<string, unknown> },
  sourceHandle: string | undefined,
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: unknown }>,
  nodes: ReadonlyArray<{ id: string; type?: string; data: Record<string, unknown> }>,
): string[] {
  const loopData = loopNode.data as LoopNodeData;
  const cols = loopData.columns ?? [];
  const colIndex = cols.findIndex((c) => c.handleId === sourceHandle);
  const col = colIndex >= 0 ? cols[colIndex] : undefined;

  // 1. Per-column connected edge
  if (col) {
    const targetHandle = loopColInputHandle(col.handleId);
    const colInEdge = edges.find(
      (e) => e.target === loopNode.id && e.targetHandle === targetHandle,
    );
    if (colInEdge) {
      const upstreamNode = nodes.find((n) => n.id === colInEdge.source);
      if (upstreamNode) {
        const result = resolveUpstreamWithEdgeFilter(
          upstreamNode as WorkflowNode,
          colInEdge,
          edges,
          nodes,
          loopData.columns,
        );
        if (result) return result;
      }
    }
  }

  // 2. Legacy "in" handle
  const loopInEdges = edges.filter(
    (e) => e.target === loopNode.id && e.targetHandle === "in",
  );
  if (loopInEdges.length > 0) {
    const upstreamNode = nodes.find((n) => n.id === loopInEdges[0].source);
    if (upstreamNode) {
      const result = resolveUpstreamWithEdgeFilter(
        upstreamNode as WorkflowNode,
        loopInEdges[0],
        edges,
        nodes,
        loopData.columns,
      );
      if (result) return result;
    }
  }

  // 3. Manual rows (only when a column was matched)
  if (colIndex >= 0) {
    return (loopData.rows ?? []).map((row) => row[colIndex]).filter((v) => v?.trim());
  }

  return [];
}

/** Node types whose edges default to "each" output mode (fan-out) */
const DEFAULT_EACH_TYPES = new Set(["list", "loop", "split-text", "filter-list", "deduplicate", "merge-lists", "sort-list"]);

/** Node types that accept multiple audio inputs (accumulate to audioUrls array) */
const MULTI_AUDIO_INPUT_TYPES = new Set(["mix-audio", "combine-audio"]);

const REFERENCE_HANDLE_MAP: Record<string, "referenceImageUrls" | "referenceVideoUrls" | "referenceAudioUrls"> = {
  "references": "referenceImageUrls",
  "reference-videos": "referenceVideoUrls",
  "reference-audio": "referenceAudioUrls",
};

/** VIDEO_OUTPUT_NODE_TYPES — used for kieTaskId passthrough */
const VIDEO_OUTPUT_NODE_TYPES = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "lip-sync",
  "speech-to-video",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  "face-swap",
  "suno-music-video",
  "combine-videos",
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

/** Resolved inputs from upstream node outputs — shared return type for resolveNodeInputs */
export interface FrontendResolvedInputs {
  prompt?: string;
  imageUrl?: string;
  videoUrl?: string;
  faceImageUrl?: string;
  videoUrls?: string[];
  videoUrlsWithSourceIds?: Array<{ nodeId: string; url: string }>;
  audioUrl?: string;
  audioUrl2?: string;
  audioUrls?: string[];
  audioUrlsWithSourceIds?: Array<{ nodeId: string; url: string }>;
  audioSources?: {
    url: string;
    sourceNodeId: string;
    sourceType?: "audio" | "video";
  }[];
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  /** Multi-media payload for social carousel posts — accumulated by
   *  resolveNodeInputs when target.data.action === "post-carousel". */
  mediaItems?: Array<{ type: "photo" | "video"; url: string }>;
  scriptData?: unknown;
  dialogueLines?: Array<{ speaker: string; text: string; emotion?: string }>;
  scriptCharacters?: Array<{ name: string; description: string; mood?: string; action?: string; position?: string }>;
  scriptLocations?: Array<{ name: string; description: string; timeOfDay: string; weather?: string; lighting?: string }>;
  sunoTrackId?: string;
  sunoTaskId?: string;
  uploadUrl?: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  maskUrl?: string;
  kieTaskId?: string;
  componentInputMap?: Record<string, string>;
  systemPrompt?: string;
  inputAssets?: Array<{ nodeId: string; url: string; type: "video" | "image" | "audio" }>;
  /** When a character upstream has injectIdentityInPrompts enabled AND has a
   *  characterDbId, the resolver sets this to true. The downstream executor
   *  (execute-node.ts) then forwards injectCharacterContext + attachToCharacterId
   *  on the API call, and the backend route appends canonical_description to
   *  the prompt. Only meaningful for generate-image / image-to-image /
   *  image-to-video targets. */
  injectCharacterContext?: boolean;
  attachToCharacterId?: string;
}

/** Append an asset to the manual-edit inputAssets accumulator. */
function appendManualEditAsset(inputs: FrontendResolvedInputs, nodeId: string, url: string, type: "video" | "image" | "audio"): void {
  inputs.inputAssets = [...(inputs.inputAssets ?? []), { nodeId, url, type }]
}

/** Route audio to suno-mashup's dual-input fields (audioUrl + audioUrl2). */
function routeSunoMashupAudio(inputs: FrontendResolvedInputs, output: string): void {
  if (!inputs.audioUrl) {
    inputs.audioUrl = output;
  } else {
    inputs.audioUrl2 = output;
  }
}

/** Node types that produce a Suno track/task ID for downstream passthrough */
const SUNO_TRACK_NODE_TYPES = new Set([
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
  "suno-convert-wav",
  "suno-upload-extend",
  "suno-separate",
]);

/** Node types whose primary output is an image URL — used to route media into
 *  llm-chat reference arrays. Names must match SceneNodeType in types/nodes.ts. */
const LLM_REF_IMAGE_NODE_TYPES = new Set<string>([
  "generate-image", "modify-image", "upscale-image", "remove-background",
  "upload-image", "extract-frame", "generate-mask",
]);
/** Node types whose primary output is a video URL. (Disjoint from
 *  VIDEO_OUTPUT_NODE_TYPES above, which is also used for kieTaskId routing —
 *  this set is purposefully scoped to llm-chat reference routing.) */
const LLM_REF_VIDEO_NODE_TYPES = new Set<string>([
  "image-to-video", "text-to-video", "video-to-video",
  "extend-video", "face-swap", "trim-video", "combine-videos", "upload-video",
  "render-video", "after-effects", "motion-graphics", "lip-sync",
  "motion-transfer", "suno-music-video", "speech-to-video",
  "video-upscale", "video-composer", "merge-video-audio",
  "resize-video", "social-media-format", "speed-ramp", "loop-video",
  "fade-video", "transcode-video", "add-captions", "manual-edit",
]);
/** Node types whose primary output is an audio URL. */
const LLM_REF_AUDIO_NODE_TYPES = new Set<string>([
  "generate-music", "text-to-speech", "text-to-audio",
  "voice-changer", "voice-design", "voice-remix", "dubbing",
  "trim-audio", "combine-audio", "mix-audio", "audio-isolation",
  "text-to-dialogue",
  "suno-generate", "suno-cover", "suno-extend", "suno-separate",
  "suno-mashup", "suno-replace-section", "suno-add-instrumental",
  "suno-add-vocals", "suno-convert-wav", "suno-upload-extend",
  "upload-audio",
]);

function nodeOutputKind(nodeType: string | undefined): "image" | "video" | "audio" | null {
  if (!nodeType) return null;
  if (LLM_REF_IMAGE_NODE_TYPES.has(nodeType)) return "image";
  if (LLM_REF_VIDEO_NODE_TYPES.has(nodeType)) return "video";
  if (LLM_REF_AUDIO_NODE_TYPES.has(nodeType)) return "audio";
  return null;
}

export function extractNodeOutputAsList(
  node: WorkflowNode,
): string[] | undefined {
  const data = node.data as Record<string, unknown>;
  if (node.type === "split-text") {
    const splitResults = data.splitResults as string[] | undefined;
    if (splitResults && splitResults.length > 0) return splitResults;
  }
  if (node.type === "list") {
    // New format: columns + rows (same as loop)
    const cols = data.columns as Array<{ handleId: string }> | undefined;
    if (cols) {
      const rows = (data.rows as string[][] | undefined) ?? [];
      const values = rows.map((r) => r[0]?.trim()).filter((v) => v && v.length > 0);
      return values.length > 0 ? values : undefined;
    }
    // Legacy format: items string
    const items = (data.items as string | undefined) || "";
    const lines = items.split("\n").filter((l: string) => l.trim().length > 0).map((l: string) => l.trim());
    return lines.length > 0 ? lines : undefined;
  }
  // JSON array output (e.g. web-scrape generatedJson) — each element is one list item.
  const jsonItems = extractGeneratedJsonAsList(data);
  if (jsonItems) return jsonItems;
  // Prefer the node's accumulated generatedResults (persistent, ordered).
  const accumulated = extractAllGeneratedResults(data);
  if (accumulated) return accumulated;
  // Fall back to in-flight listResults (current fan-out batch, mid-execution).
  const listResults = data.__listResults as string[] | undefined;
  if (listResults && listResults.length > 0) return listResults;
  return undefined;
}

/**
 * Check if a node receives list input from any "each" source.
 *
 * Returns a placeholder array whose length = MAX across all "each" sources.
 * During fan-out, resolveNodeInputs(listIterationIndex) resolves each source
 * independently using modulo-wrap for shorter sources.
 *
 * The placeholder values (REPEAT_PLACEHOLDER) signal executeNodeForList to
 * skip overridePrompt/overrideMediaUrl and rely on resolveNodeInputs.
 */
export function getListInputForNode(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] | undefined {
  const incomingEdges = edges.filter((e) => e.target === node.id && e.targetHandle !== VARIABLES_HANDLE_ID);
  let maxLen = 0;
  /** The longest concrete item list (used when only one source contributes). */
  let longestItems: string[] | undefined;

  for (const edge of incomingEdges) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;

    // generate-script "images" handle → list of imagePrompts
    if (sourceNode.type === "generate-script" && edge.sourceHandle === "images") {
      const sd = sourceNode.data as Record<string, unknown>;
      const activeScript = getActiveScriptFromData(sd);
      const scenesList = (activeScript?.scenes as Array<Record<string, unknown>>) ?? [];
      if (scenesList.length > 1) {
        const items = scenesList.map((s) => (s.imagePrompt as string) ?? "");
        if (items.length > maxLen) { maxLen = items.length; longestItems = items; }
        continue;
      }
    }

    if (sourceNode.type === "loop" || sourceNode.type === "list") {
      const edgeData = edge.data as Record<string, unknown> | undefined;
      const loopEdgeMode = edgeData?.outputMode as string | undefined;
      // Only fan-out for "each" mode (default for loop) — item/last/all produce single values
      if (loopEdgeMode === "item" || loopEdgeMode === "last" || loopEdgeMode?.startsWith("item:")) {
        continue;
      }
      const raw = resolveLoopColumnValues(sourceNode, edge.sourceHandle ?? undefined, edges, nodes);
      const items = selectListItems(raw, edgeData as SelectorFields | undefined);
      if (items.length > 1) {
        if (items.length > maxLen) { maxLen = items.length; longestItems = items; }
      }
      continue;
    }

    // Check outputMode from edge data — only fan-out if mode is "each"
    const edgeOutputMode = (edge.data as Record<string, unknown> | undefined)?.outputMode as string | undefined;
    const outputMode = edgeOutputMode ?? (DEFAULT_EACH_TYPES.has(sourceNode.type ?? "") ? "each" : "last");
    if (outputMode !== "each") continue;

    const edgeData = edge.data as Record<string, unknown> | undefined;
    const rawList = extractNodeOutputAsList(sourceNode);
    if (!rawList || rawList.length < 1) continue;
    const listOutput = selectListItems(rawList, edgeData as SelectorFields | undefined);
    if (listOutput.length > 1) {
      if (listOutput.length > maxLen) { maxLen = listOutput.length; longestItems = listOutput; }
    }
  }

  if (maxLen > 1 && longestItems) {
    // If only one source matched, return its items for backward compat
    // If multiple sources matched, return REPEAT placeholders so each
    // iteration resolves all inputs via resolveNodeInputs(i)
    return longestItems;
  }

  // Transitive fan-out: text-prompt whose upstream is a list-like node
  for (const edge of incomingEdges) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (!sourceNode || sourceNode.type !== "text-prompt") continue;

    const sourceIncoming = edges.filter((e) => e.target === sourceNode.id);
    for (const srcEdge of sourceIncoming) {
      const listNode = nodes.find((n) => n.id === srcEdge.source);
      if (!listNode || !DEFAULT_EACH_TYPES.has(listNode.type ?? "")) continue;

      const gpEdgeMode = (srcEdge.data as Record<string, unknown> | undefined)
        ?.outputMode as string | undefined;
      if ((gpEdgeMode ?? "each") !== "each") continue;

      const rawItems = extractNodeOutputAsList(listNode);
      if (!rawItems || rawItems.length < 1) continue;
      const gpEdgeData = srcEdge.data as Record<string, unknown> | undefined;
      const listItems = selectListItems(rawItems, gpEdgeData as SelectorFields | undefined);
      if (listItems.length <= 1) continue;

      const refMap = buildNodeRefMap(sourceNode.id, nodes, edges);
      const listData = listNode.data as Record<string, unknown>;
      const listLabel =
        (listData.label as string) || listNode.type || listNode.id;
      const sourceText =
        ((sourceNode.data as Record<string, unknown>).text as string) || "";

      const resolvedItems: string[] = [];
      for (const item of listItems) {
        const itemMap = new Map(refMap);
        itemMap.set(listLabel, item);
        resolvedItems.push(resolveTextRefs(sourceText, itemMap) || sourceText);
      }
      if (resolvedItems.length > maxLen) { maxLen = resolvedItems.length; longestItems = resolvedItems; }
    }
  }

  return maxLen > 1 && longestItems ? longestItems : undefined;
}

/** Extract the active GeneratedScript from generate-script node data. */
function getActiveScriptFromData(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const results = data.generatedResults as Array<{ script: unknown }> | undefined;
  const activeIndex = (data.activeResultIndex as number | undefined) ?? 0;
  return (results?.[activeIndex]?.script ?? data.generatedScript) as Record<string, unknown> | undefined;
}

/** Deduplicate characters by lowercase name, first occurrence wins. Handles string[] fallback. */
function deduplicateCharacters(scenes: Array<Record<string, unknown>>): Array<{ name: string; description: string; mood?: string; action?: string; position?: string }> {
  const seen = new Map<string, { name: string; description: string; mood?: string; action?: string; position?: string }>();
  for (const scene of scenes) {
    const chars = scene.characters as Array<string | Record<string, unknown>> | undefined;
    if (!chars) continue;
    for (const c of chars) {
      if (typeof c === "string") {
        const key = c.toLowerCase();
        if (!seen.has(key)) seen.set(key, { name: c, description: "" });
      } else {
        const name = (c.name as string) ?? "";
        const key = name.toLowerCase();
        if (!seen.has(key)) seen.set(key, {
          name,
          description: (c.description as string) ?? "",
          mood: (c.mood as string) ?? undefined,
          action: (c.action as string) ?? undefined,
          position: (c.position as string) ?? undefined,
        });
      }
    }
  }
  return Array.from(seen.values());
}

/** Deduplicate locations by lowercase name, first occurrence wins. */
function deduplicateLocations(scenes: Array<Record<string, unknown>>): Array<{ name: string; description: string; timeOfDay: string; weather?: string; lighting?: string }> {
  const seen = new Map<string, { name: string; description: string; timeOfDay: string; weather?: string; lighting?: string }>();
  for (const scene of scenes) {
    const loc = scene.location as Record<string, unknown> | undefined;
    if (!loc) continue;
    const name = (loc.name as string) ?? "";
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, {
      name,
      description: (loc.description as string) ?? "",
      timeOfDay: (loc.timeOfDay as string) ?? "",
      weather: (loc.weather as string) ?? undefined,
      lighting: (loc.lighting as string) ?? undefined,
    });
  }
  return Array.from(seen.values());
}

export function resolveNodeInputs(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  listIterationIndex?: number,
): FrontendResolvedInputs {
  const incomingEdges = edges.filter((e) => e.target === node.id);
  const inputs: FrontendResolvedInputs = {};

  for (const srcEdge of incomingEdges) {
    let src = nodes.find((n) => n.id === srcEdge.source);
    if (!src) continue;

    // Teleport transparency: resolve through the chain to the original source
    if (src.type === "teleport-send" || src.type === "teleport-receive") {
      src = resolveTeleportOrigin(src, nodes, edges)
    }

    const edgeMode = (srcEdge.data as Record<string, unknown> | undefined)
      ?.outputMode as string | undefined;
    const srcData = src.data as Record<string, unknown>;
    // split-media uses outputChunkIndex routing, skip __listResults
    const srcListResults = src.type === "split-media"
      ? undefined
      : ((srcData.__listResults as string[] | undefined) ?? extractAllGeneratedResults(srcData));
    let output: string | undefined;
    if (edgeMode && srcListResults && srcListResults.length > 0) {
      if (edgeMode === "item") {
        // Structured item mode: use resolveIndex on itemIndex expression
        const itemIndex = (srcEdge.data as Record<string, unknown> | undefined)
          ?.itemIndex as string | undefined;
        const idx = resolveIndex(itemIndex ?? "1", srcListResults.length);
        output = srcListResults[idx] ?? srcListResults[0];
      } else if (edgeMode.startsWith("item:")) {
        const idx = parseInt(edgeMode.split(":")[1], 10);
        output = srcListResults[idx] ?? srcListResults[0];
      } else if (edgeMode === "last") {
        // "last" = "Selected" in the UI — leave output undefined so we fall
        // through to extractNodeOutput below, which reads activeResultIndex
        // (the result the user picked via the carousel). This is DIFFERENT
        // from the word "last" inside range/list expressions, where it means
        // the final array index.
      } else if (edgeMode === "all") {
        const edgeData = srcEdge.data as Record<string, unknown> | undefined;
        const filteredSrc = selectListItems(srcListResults, edgeData as SelectorFields | undefined);
        // For array-accumulating targets, spread items individually
        if (node.type === "combine-videos") {
          for (const item of filteredSrc) {
            if (item) {
              inputs.videoUrls = [...(inputs.videoUrls ?? []), item];
              inputs.videoUrlsWithSourceIds = [
                ...((inputs.videoUrlsWithSourceIds as Array<{ nodeId: string; url: string }>) ?? []),
                { nodeId: src.id, url: item },
              ];
            }
          }
          continue;
        }
        if (node.type === "manual-edit") {
          for (const item of filteredSrc) {
            if (item) {
              appendManualEditAsset(inputs, src.id, item, "video");
            }
          }
          continue;
        }
        if (MULTI_AUDIO_INPUT_TYPES.has(node.type!)) {
          for (const item of filteredSrc) {
            if (item) {
              inputs.audioUrls = [...(inputs.audioUrls ?? []), item];
              inputs.audioUrlsWithSourceIds = [
                ...(inputs.audioUrlsWithSourceIds ?? []),
                { nodeId: src.id, url: item },
              ];
            }
          }
          continue;
        }
        const targetAction = (node.data as Record<string, unknown> | undefined)?.action as string | undefined;
        if (SOCIAL_POST_NODE_TYPES.has(node.type ?? "") && targetAction === "post-carousel") {
          for (const item of filteredSrc) {
            if (!item) continue;
            const type = VIDEO_URL_RE.test(item) ? "video" : "photo";
            inputs.mediaItems = [...(inputs.mediaItems ?? []), { type, url: item }];
          }
          continue;
        }
        output = filteredSrc.join(", ");
      } else if (edgeMode === "each" && listIterationIndex !== undefined) {
        const edgeData = srcEdge.data as Record<string, unknown> | undefined;
        const filteredSrc = selectListItems(srcListResults, edgeData as SelectorFields | undefined);
        if (filteredSrc.length > 0) {
          output = filteredSrc[listIterationIndex % filteredSrc.length];
        }
      }
    }
    if (!output && (src.type === "loop" || src.type === "list")) {
      const raw = resolveLoopColumnValues(src, srcEdge.sourceHandle ?? undefined, edges, nodes);
      const edgeData = srcEdge.data as Record<string, unknown> | undefined;
      const ranged = selectListItems(raw, edgeData as SelectorFields | undefined);
      if (ranged.length > 0) {
        const loopEdgeMode = edgeData?.outputMode as string | undefined;
        let picked: string | undefined;
        if (loopEdgeMode === "item") {
          const itemIndex = edgeData?.itemIndex as string | undefined;
          picked = ranged[resolveIndex(itemIndex ?? "1", ranged.length)];
        } else if (loopEdgeMode?.startsWith("item:")) {
          const idx = parseInt(loopEdgeMode.split(":")[1], 10);
          picked = ranged[idx] ?? ranged[0];
        } else if (loopEdgeMode === "last") {
          picked = ranged[ranged.length - 1];
        } else if (listIterationIndex !== undefined) {
          picked = ranged[listIterationIndex % ranged.length];
        } else {
          picked = ranged[0];
        }
        if (picked) output = picked.trim();
      }
    }

    // During fan-out: resolve per-iteration values from non-loop list sources
    if (!output && listIterationIndex != null) {
      if (srcListResults && srcListResults.length > 0) {
        const effectiveMode = edgeMode ?? (DEFAULT_EACH_TYPES.has(src.type ?? "") ? "each" : "last");
        if (effectiveMode === "each") {
          const edgeData = srcEdge.data as Record<string, unknown> | undefined;
          const filtered = selectListItems(srcListResults, edgeData as SelectorFields | undefined);
          output = filtered.length > 0 ? filtered[listIterationIndex % filtered.length] : undefined;
        }
      }
    }

    if (!output) {
      output = extractNodeOutput(src, srcEdge.sourceHandle ?? undefined);
    }
    if (!output) continue;

    // Component-specific target routing — route by handle ID, not media type.
    // This MUST come before generic handle routing so each component input
    // gets its own distinct value even when multiple inputs share the same type.
    if (node.type === "component" && srcEdge.targetHandle?.startsWith("in_")) {
      const handleId = srcEdge.targetHandle.replace(/^in_/, "")
      if (!inputs.componentInputMap) inputs.componentInputMap = {}
      inputs.componentInputMap[handleId] = output
      continue
    }

    // --- Handle-specific routing takes priority (matches backend) ---
    if (node.type === "face-swap") {
      if (srcEdge.targetHandle === "face") {
        inputs.faceImageUrl = output;
        continue;
      }
      // "in" handle → videoUrl (fall through to normal video routing below)
    }
    if (srcEdge.targetHandle === "startFrame") {
      inputs.startFrameUrl = output;
      continue;
    }
    if (srcEdge.targetHandle === "endFrame") {
      inputs.endFrameUrl = output;
      continue;
    }
    if (srcEdge.targetHandle === "mask") {
      inputs.maskUrl = output;
      continue;
    }
    const refHandleKey = REFERENCE_HANDLE_MAP[srcEdge.targetHandle ?? ""];
    if (refHandleKey) {
      inputs[refHandleKey] = [...((inputs[refHandleKey] as string[] | undefined) ?? []), output];
      continue;
    }
    if (srcEdge.targetHandle === "system-prompt") {
      inputs.systemPrompt = output;
      continue;
    }
    if (srcEdge.targetHandle === "audio") {
      if (MULTI_AUDIO_INPUT_TYPES.has(node.type!)) {
        inputs.audioUrls = [...(inputs.audioUrls ?? []), output];
        inputs.audioUrlsWithSourceIds = [
          ...(inputs.audioUrlsWithSourceIds ?? []),
          { nodeId: src.id, url: output },
        ];
      } else if (node.type === "merge-video-audio") {
        inputs.audioSources = [
          ...(inputs.audioSources ?? []),
          { url: output, sourceNodeId: src.id },
        ];
      } else if (node.type === "suno-mashup") {
        routeSunoMashupAudio(inputs, output);
      } else {
        inputs.audioUrl = output;
      }
      continue;
    }

    // Split media output — route selected chunk by outputChunkIndex
    if (src.type === "split-media") {
      const liveNode = useWorkflowStore.getState().nodes.find(n => n.id === src!.id);
      const srcData = (liveNode?.data ?? src.data) as Record<string, unknown>;
      const chunkIndex = (srcData.outputChunkIndex as number | undefined) ?? 0;
      const audioUrls = (srcData.generatedAudioUrls as string[] | undefined) ?? [];
      const videoUrls = (srcData.generatedVideoUrls as string[] | undefined) ?? [];
      console.log('[resolver] split-media: chunkIndex=', chunkIndex, 'audioUrls=', audioUrls.length, 'sourceHandle=', srcEdge.sourceHandle);
      if (audioUrls.length > 0) {
        const selectedUrl = audioUrls[chunkIndex];
        if (selectedUrl) inputs.audioUrl = selectedUrl;
      }
      if (videoUrls.length > 0) {
        const selectedUrl = videoUrls[chunkIndex];
        if (selectedUrl) inputs.videoUrl = selectedUrl;
      }
      continue;
    }

    // LLM Chat target: route upstream image/video/audio outputs to the
    // corresponding reference array. This MUST come before the per-source
    // chain below so generate-image / image-to-video / generate-music / etc.
    // don't set imageUrl/videoUrl/audioUrl (which the llm-chat route ignores).
    // Non-media upstream sources (text-prompt, ai-writer, combine-text, …)
    // fall through to the existing prompt-routing branches and land on
    // `inputs.prompt`, so the LLM can receive both refs and text via sibling
    // edges.
    if (node.type === "llm-chat" && typeof output === "string" && output) {
      const kind = nodeOutputKind(src.type);
      if (kind === "image") {
        inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output];
        continue;
      }
      if (kind === "video") {
        inputs.referenceVideoUrls = [...(inputs.referenceVideoUrls ?? []), output];
        continue;
      }
      if (kind === "audio") {
        inputs.referenceAudioUrls = [...(inputs.referenceAudioUrls ?? []), output];
        continue;
      }
      // Non-media upstream — fall through to existing chain.
    }

    if (src.type === "component") {
      // Component output routing — determine media type from the output handle metadata.
      const compMeta = (src.data as Record<string, unknown>).componentMetadata as
        { outputs?: Array<{ id: string; type: string }> } | undefined
      const handleId = srcEdge.sourceHandle?.replace(/^out_/, "")
      const handleType = compMeta?.outputs?.find((o) => o.id === handleId)?.type

      if (handleType === "image") {
        if (node.type === "generate-image" || (node.type as string) === "edit-image" || (node.type as string) === "image-to-image" || node.type === "modify-image") {
          inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output]
        } else if (node.type === "manual-edit") {
          appendManualEditAsset(inputs, src.id, output, "image")
        } else {
          inputs.imageUrl = output
        }
      } else if (handleType === "video") {
        if (node.type === "combine-videos") {
          inputs.videoUrls = [...(inputs.videoUrls ?? []), output]
          inputs.videoUrlsWithSourceIds = [
            ...((inputs.videoUrlsWithSourceIds as Array<{ nodeId: string; url: string }>) ?? []),
            { nodeId: src.id, url: output },
          ]
        } else if (node.type === "manual-edit") {
          appendManualEditAsset(inputs, src.id, output, "video")
        } else {
          inputs.videoUrl = output
        }
      } else if (handleType === "audio") {
        if (MULTI_AUDIO_INPUT_TYPES.has(node.type!)) {
          inputs.audioUrls = [...(inputs.audioUrls ?? []), output]
          inputs.audioUrlsWithSourceIds = [
            ...(inputs.audioUrlsWithSourceIds ?? []),
            { nodeId: src.id, url: output },
          ]
        } else if (node.type === "merge-video-audio") {
          inputs.audioSources = [...(inputs.audioSources ?? []), { url: output, sourceNodeId: src.id }]
        } else if (node.type === "manual-edit") {
          appendManualEditAsset(inputs, src.id, output, "audio")
        } else {
          inputs.audioUrl = output
        }
      } else {
        inputs.prompt = output
      }
    } else if (src.type === "router") {
      // Router passthrough — detect media type from URL
      if (IMAGE_URL_RE.test(output)) {
        inputs.imageUrl = output
      } else if (VIDEO_URL_RE.test(output)) {
        inputs.videoUrl = output
      } else if (AUDIO_URL_RE.test(output)) {
        inputs.audioUrl = output
      } else if (output === "gate") {
        // Gate mode — no data, just execution control
        inputs.prompt = ""
      } else {
        inputs.prompt = output
      }
    } else if (src.type === "text-prompt") {
      inputs.prompt = output;
    } else if (src.type && PARAMETER_NODE_TYPES.has(src.type)) {
      // Parameter nodes (framing, camera-motion, person, mood, pose, styling,
      // setting, style, etc.) are additive enhancements — they append to the
      // manual prompt via `collectCinematographyHints` in the executor, so we
      // don't overwrite `inputs.prompt` here. Without this guard, wiring a
      // parameter into a node's prompt handle silently erased the user's
      // manual text.
    } else if (src.type === "list" && !(src.data as Record<string, unknown>).columns) {
      // Legacy list format — newline-separated items string, text-only routing.
      // Modern list nodes with columns fall through to the column-typed branch
      // below so image/video/audio columns route to the right input (e.g.
      // list → generate-image reference image needs referenceImageUrls, not prompt).
      const edgeMode = (srcEdge?.data as Record<string, unknown> | undefined)?.outputMode as string | undefined;
      const outputMode = edgeMode ?? "each"; // list edges default to "each"
      const items = ((src.data as Record<string, unknown>).items as string || "")
        .split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0);
      if (outputMode === "all") {
        inputs.prompt = items.join(", ") || output;
      } else if (outputMode === "last") {
        // List sources have no user-selection concept, so "Selected" falls back
        // to the final row. This overlaps with the other meaning of "last" —
        // the final index in a range/list expression — but only because lists
        // don't support the Selected semantic that generic nodes use.
        inputs.prompt = items[items.length - 1] || output;
      } else if (outputMode === "item") {
        const itemIndex = (srcEdge.data as Record<string, unknown> | undefined)
          ?.itemIndex as string | undefined;
        const idx = resolveIndex(itemIndex ?? "1", items.length);
        inputs.prompt = items[idx] ?? items[0] ?? output;
      } else if (outputMode.startsWith("item:")) {
        const idx = parseInt(outputMode.split(":")[1], 10);
        inputs.prompt = items[idx] ?? items[0] ?? output;
      } else {
        // "each" mode — output first item; fan-out handled separately
        inputs.prompt = output;
      }
    } else if (src.type === "loop" || src.type === "list") {
      // output already resolved per-iteration by loop handler above — route by column type
      const loopCols = ((src.data as LoopNodeData).columns ?? []);
      let loopCol = loopCols.find((c) => c.handleId === (srcEdge.sourceHandle ?? ""));
      // List nodes use a fixed "list" output handle (not per-column handles like
      // loop nodes), so the handleId lookup above won't match any column.  Fall
      // back to the first column so the user's column-type setting is honoured.
      if (!loopCol && src.type === "list" && loopCols.length > 0) {
        loopCol = loopCols[0];
      }
      const colType = loopCol?.type ?? "text";
      const targetAction = (node.data as Record<string, unknown> | undefined)?.action as string | undefined;
      const isCarouselTarget = node.type === "instagram-post" && targetAction === "post-carousel";
      if (colType === "image-url") {
        if (isCarouselTarget) {
          inputs.mediaItems = [...(inputs.mediaItems ?? []), { type: "photo", url: output }];
        } else if (node.type === "generate-image" || (node.type as string) === "edit-image" || (node.type as string) === "image-to-image" || node.type === "modify-image") {
          inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output];
        } else if (node.type === "manual-edit") {
          appendManualEditAsset(inputs, src.id, output, "image");
        } else {
          inputs.imageUrl = output;
        }
      } else if (colType === "video-url") {
        if (isCarouselTarget) {
          inputs.mediaItems = [...(inputs.mediaItems ?? []), { type: "video", url: output }];
        } else if (node.type === "combine-videos") {
          inputs.videoUrls = [...(inputs.videoUrls ?? []), output];
          inputs.videoUrlsWithSourceIds = [...((inputs.videoUrlsWithSourceIds as Array<{ nodeId: string; url: string }>) ?? []), { nodeId: src.id, url: output }];
        } else if (node.type === "manual-edit") {
          appendManualEditAsset(inputs, src.id, output, "video");
        } else {
          inputs.videoUrl = output;
        }
      } else if (colType === "audio-url") {
        if (MULTI_AUDIO_INPUT_TYPES.has(node.type!)) {
          inputs.audioUrls = [...(inputs.audioUrls ?? []), output];
          inputs.audioUrlsWithSourceIds = [...(inputs.audioUrlsWithSourceIds ?? []), { nodeId: src.id, url: output }];
        } else if (node.type === "manual-edit") {
          appendManualEditAsset(inputs, src.id, output, "audio");
        } else {
          inputs.audioUrl = output;
        }
      } else {
        inputs.prompt = output;
      }
    } else if (src.type === "upload-image") {
      if (node.type === "generate-image" || node.type === "video-to-video") {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "image");
      } else {
        inputs.imageUrl = output;
      }
    } else if (
      src.type === "character" ||
      src.type === "face" ||
      src.type === "object" ||
      src.type === "location"
    ) {
      if (node.type === "lip-sync" || node.type === "speech-to-video") {
        inputs.imageUrl = output;
      } else {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      }
      // Identity injection — when the upstream is a Character with its
      // injectIdentityInPrompts toggle on AND it has a characterDbId,
      // forward the flag + id so the downstream image / video route
      // appends canonical_description to the prompt. Only meaningful for
      // generate-image, image-to-image, modify-image, image-to-video, and
      // text-to-video targets — the executor reads these fields and
      // forwards them only on those API calls.
      if (src.type === "character") {
        const charData = src.data as Record<string, unknown>;
        const inject = charData.injectIdentityInPrompts === true;
        const dbId = typeof charData.characterDbId === "string" ? charData.characterDbId : "";
        if (inject && dbId.length > 0) {
          inputs.injectCharacterContext = true;
          inputs.attachToCharacterId = dbId;
        }
      }
    } else if (src.type === "upload-video" || src.type === "youtube-video") {
      if (node.type === "suno-cover" && src.type === "youtube-video") {
        const srcData = src.data as Record<string, unknown>;
        const audioUrl = (
          srcData.downloadedAudioUrl as string | undefined
        )?.trim();
        inputs.uploadUrl = audioUrl || output;
      } else if (node.type === "combine-videos") {
        inputs.videoUrls = [...(inputs.videoUrls ?? []), output];
        inputs.videoUrlsWithSourceIds = [
          ...((inputs.videoUrlsWithSourceIds as Array<{
            nodeId: string;
            url: string;
          }>) ?? []),
          { nodeId: src.id, url: output },
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "video");
      } else if (node.type === "merge-video-audio") {
        if (!inputs.videoUrl) {
          inputs.videoUrl = output;
        } else {
          inputs.audioSources = [
            ...(inputs.audioSources ?? []),
            {
              url: output,
              sourceNodeId: src.id,
              sourceType: "video" as const,
            },
          ];
        }
      } else {
        inputs.videoUrl = output;
      }
    } else if (src.type === "generate-image") {
      if (node.type === "generate-image" || node.type === "video-to-video") {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      } else if (node.type === "text-to-audio") {
        inputs.prompt = (src.data as GenerateImageData).prompt ?? "";
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "image");
      } else {
        inputs.imageUrl = output;
      }
    } else if (src.type === "generate-mask") {
      // generate-mask emits a dual-handle image output: "image" = passthrough
      // source image, "mask" = generated PNG. The "mask" handle is wired to a
      // downstream "mask" target handle (routed earlier via
      // srcEdge.targetHandle === "mask" → inputs.maskUrl). The "image" handle
      // is a regular image source — route same as generate-image.
      if (
        node.type === "generate-image" ||
        (node.type as string) === "edit-image" ||
        (node.type as string) === "image-to-image" ||
        node.type === "modify-image" ||
        node.type === "video-to-video"
      ) {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "image");
      } else {
        inputs.imageUrl = output;
      }
    } else if ((src.type as string) === "edit-image" || src.type === "modify-image" || src.type === "upscale-image" || src.type === "remove-background") {
      if (
        node.type === "generate-image" ||
        (node.type as string) === "edit-image" ||
        (node.type as string) === "image-to-image" ||
        node.type === "modify-image" ||
        node.type === "video-to-video"
      ) {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "image");
      } else {
        inputs.imageUrl = output;
      }
    } else if ((src.type as string) === "image-to-image") {
      if (
        node.type === "generate-image" ||
        (node.type as string) === "edit-image" ||
        (node.type as string) === "image-to-image" ||
        node.type === "modify-image" ||
        node.type === "video-to-video"
      ) {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "image");
      } else {
        inputs.imageUrl = output;
      }
    } else if (src.type === "extract-frame") {
      if (
        node.type === "generate-image" ||
        (node.type as string) === "edit-image" ||
        (node.type as string) === "image-to-image" ||
        node.type === "modify-image" ||
        node.type === "video-to-video"
      ) {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "image");
      } else {
        inputs.imageUrl = output;
      }
    } else if (VIDEO_OUTPUT_NODE_TYPES.has(src.type!)) {
      if (node.type === "combine-videos") {
        inputs.videoUrls = [...(inputs.videoUrls ?? []), output];
        inputs.videoUrlsWithSourceIds = [
          ...((inputs.videoUrlsWithSourceIds as Array<{
            nodeId: string;
            url: string;
          }>) ?? []),
          { nodeId: src.id, url: output },
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "video");
      } else if (node.type === "merge-video-audio") {
        if (!inputs.videoUrl) {
          inputs.videoUrl = output;
        } else {
          inputs.audioSources = [
            ...(inputs.audioSources ?? []),
            {
              url: output,
              sourceNodeId: src.id,
              sourceType: "video" as const,
            },
          ];
        }
      } else {
        inputs.videoUrl = output;
      }
      // Pass through kieTaskId for VEO/Runway extend and upscale nodes (matches backend)
      if (node.type === "extend-video" || node.type === "video-upscale") {
        const srcData = src.data as Record<string, unknown>;
        if (srcData.kieTaskId) {
          inputs.kieTaskId = srcData.kieTaskId as string;
        }
      }
    } else if (src.type === "reference-audio") {
      if (node.type === "generate-music") {
        inputs.audioUrl = output;
      } else if (node.type === "suno-mashup") {
        routeSunoMashupAudio(inputs, output);
      } else if (MULTI_AUDIO_INPUT_TYPES.has(node.type!)) {
        inputs.audioUrls = [...(inputs.audioUrls ?? []), output];
        inputs.audioUrlsWithSourceIds = [
          ...(inputs.audioUrlsWithSourceIds ?? []),
          { nodeId: src.id, url: output },
        ];
      } else if (node.type === "merge-video-audio") {
        // Route to audioSources for multi-track handling (matches backend)
        inputs.audioSources = [
          ...(inputs.audioSources ?? []),
          { url: output, sourceNodeId: src.id },
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "audio");
      } else {
        inputs.audioUrl = output;
      }
    } else if (src.type === "scene") {
      const sceneData = src.data as unknown as SceneNodeDataType;
      const { characterDefinitions } = useWorkflowStore.getState();
      inputs.prompt = buildScenePrompt(sceneData, characterDefinitions);
      const sceneResults =
        (sceneData.generatedResults as GeneratedResult[] | undefined) ?? [];
      const sceneActiveIdx =
        (sceneData.activeResultIndex as number | undefined) ?? 0;
      const sceneImageUrl =
        sceneResults[sceneActiveIdx]?.url ?? sceneData.generatedImageUrl;
      if (sceneImageUrl) {
        if (node.type === "generate-image" || node.type === "video-to-video") {
          inputs.referenceImageUrls = [
            ...(inputs.referenceImageUrls ?? []),
            sceneImageUrl,
          ];
        } else {
          inputs.imageUrl = sceneImageUrl;
        }
      }
      // Extract video URL from scene video results
      const sceneVideoResults =
        (sceneData.generatedVideoResults as GeneratedResult[] | undefined) ?? [];
      const sceneVideoActiveIdx =
        (sceneData.activeVideoResultIndex as number | undefined) ?? 0;
      const sceneVideoUrl =
        sceneVideoResults[sceneVideoActiveIdx]?.url ?? sceneData.generatedVideoUrl;
      if (sceneVideoUrl) {
        if (node.type === "combine-videos") {
          inputs.videoUrls = [...(inputs.videoUrls ?? []), sceneVideoUrl];
          inputs.videoUrlsWithSourceIds = [
            ...((inputs.videoUrlsWithSourceIds as Array<{ nodeId: string; url: string }>) ?? []),
            { nodeId: src.id, url: sceneVideoUrl },
          ];
        } else if (node.type === "manual-edit") {
          appendManualEditAsset(inputs, src.id, sceneVideoUrl, "video");
        } else if (node.type === "merge-video-audio") {
          if (!inputs.videoUrl) {
            inputs.videoUrl = sceneVideoUrl;
          } else {
            inputs.audioSources = [
              ...(inputs.audioSources ?? []),
              { url: sceneVideoUrl, sourceNodeId: src.id, sourceType: "video" as const },
            ];
          }
        } else {
          inputs.videoUrl = sceneVideoUrl;
        }
      }
      const allAssetIds = [
        ...sceneData.characters.map((c) => c.assetId),
        ...(sceneData.locations ?? []).map((l) => l.assetId),
        ...sceneData.objects.map((o) => o.assetId),
      ];
      for (const assetId of allAssetIds) {
        const asset = characterDefinitions.find((a) => a.id === assetId);
        if (asset?.referenceImageUrl) {
          inputs.referenceImageUrls = [
            ...(inputs.referenceImageUrls ?? []),
            asset.referenceImageUrl,
          ];
        }
      }
    } else if (src.type === "upload-audio") {
      if (node.type === "suno-mashup") {
        routeSunoMashupAudio(inputs, output);
      } else if (MULTI_AUDIO_INPUT_TYPES.has(node.type!)) {
        inputs.audioUrls = [...(inputs.audioUrls ?? []), output];
        inputs.audioUrlsWithSourceIds = [
          ...(inputs.audioUrlsWithSourceIds ?? []),
          { nodeId: src.id, url: output },
        ];
      } else if (node.type === "merge-video-audio") {
        inputs.audioSources = [
          ...(inputs.audioSources ?? []),
          { url: output, sourceNodeId: src.id },
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "audio");
      } else {
        inputs.audioUrl = output;
      }
    } else if (src.type === "adjust-volume") {
      const adjustData = src.data as AdjustVolumeData;
      const lastInputType = adjustData.lastInputType ?? "audio";
      if (lastInputType === "video") {
        inputs.videoUrl = output;
      } else if (node.type === "suno-mashup") {
        routeSunoMashupAudio(inputs, output);
      } else if (MULTI_AUDIO_INPUT_TYPES.has(node.type!)) {
        inputs.audioUrls = [...(inputs.audioUrls ?? []), output];
        inputs.audioUrlsWithSourceIds = [
          ...(inputs.audioUrlsWithSourceIds ?? []),
          { nodeId: src.id, url: output },
        ];
      } else if (node.type === "merge-video-audio") {
        inputs.audioSources = [
          ...(inputs.audioSources ?? []),
          { url: output, sourceNodeId: src.id },
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "audio");
      } else {
        inputs.audioUrl = output;
      }
    } else if (src.type === "suno-separate" && (srcEdge.sourceHandle === "instrumental-out" || srcEdge.sourceHandle === "vocal-out")) {
      const srcData = src.data as Record<string, unknown>;
      if (srcEdge.sourceHandle === "instrumental-out") {
        const instrumentalUrl = srcData.instrumentalUrl as string | undefined;
        if (instrumentalUrl) {
          if (node.type === "merge-video-audio") {
            inputs.audioSources = [...(inputs.audioSources ?? []), { url: instrumentalUrl, sourceNodeId: src.id }];
          } else {
            inputs.audioUrl = instrumentalUrl;
          }
        }
      } else if (srcEdge.sourceHandle === "vocal-out") {
        const vocalUrl = srcData.vocalUrl as string | undefined;
        if (vocalUrl) {
          if (node.type === "merge-video-audio") {
            inputs.audioSources = [...(inputs.audioSources ?? []), { url: vocalUrl, sourceNodeId: src.id }];
          } else {
            inputs.audioUrl = vocalUrl;
          }
        }
      }
    } else if (
      src.type === "text-to-speech" ||
      src.type === "generate-music" ||
      src.type === "text-to-audio" ||
      src.type === "audio-isolation" ||
      src.type === "text-to-dialogue" ||
      src.type === "suno-generate" ||
      src.type === "suno-cover" ||
      src.type === "suno-extend" ||
      src.type === "suno-separate" ||
      src.type === "suno-mashup" ||
      src.type === "suno-replace-section" ||
      src.type === "suno-add-instrumental" ||
      src.type === "suno-add-vocals" ||
      src.type === "suno-convert-wav" ||
      src.type === "suno-upload-extend" ||
      src.type === "trim-audio" ||
      src.type === "mix-audio" ||
      src.type === "combine-audio" ||
      src.type === "voice-changer" ||
      src.type === "dubbing" ||
      src.type === "voice-remix" ||
      src.type === "voice-design"
    ) {
      if (node.type === "suno-mashup") {
        routeSunoMashupAudio(inputs, output);
      } else if (MULTI_AUDIO_INPUT_TYPES.has(node.type!)) {
        inputs.audioUrls = [...(inputs.audioUrls ?? []), output];
        inputs.audioUrlsWithSourceIds = [
          ...(inputs.audioUrlsWithSourceIds ?? []),
          { nodeId: src.id, url: output },
        ];
      } else if (node.type === "merge-video-audio") {
        inputs.audioSources = [
          ...(inputs.audioSources ?? []),
          { url: output, sourceNodeId: src.id },
        ];
      } else if (node.type === "manual-edit") {
        appendManualEditAsset(inputs, src.id, output, "audio");
      } else {
        inputs.audioUrl = output;
      }
      if (SUNO_TRACK_NODE_TYPES.has(src.type!)) {
        const srcData = src.data as Record<string, unknown>;
        const trackId = (srcData.sunoTrackId as string | undefined);
        const taskId = (srcData.sunoTaskId as string | undefined);
        if (trackId) inputs.sunoTrackId = trackId;
        if (taskId) inputs.sunoTaskId = taskId;
        // Fallback: check generatedResults for stored sunoTrackId/sunoTaskId
        if (!trackId || !taskId) {
          const results = srcData.generatedResults as Array<Record<string, unknown>> | undefined;
          const activeIndex = (srcData.activeResultIndex as number | undefined) ?? 0;
          const activeResult = results?.[activeIndex];
          if (activeResult?.sunoTrackId && !trackId) inputs.sunoTrackId = activeResult.sunoTrackId as string;
          if (activeResult?.sunoTaskId && !taskId) inputs.sunoTaskId = activeResult.sunoTaskId as string;
        }
      }
    } else if (src.type === "transcribe" || src.type === "suno-lyrics" || src.type === "suno-style-boost" || src.type === "image-to-text" || src.type === "forced-alignment" || src.type === "qa-check") {
      inputs.prompt = output;
    } else if (src.type === "ai-writer" || src.type === "llm-chat") {
      inputs.prompt = output;
    } else if (src.type === "combine-text") {
      inputs.prompt = output;
    } else if (src.type === "preview") {
      inputs.prompt = output;
    } else if (src.type === "split-text") {
      inputs.prompt = output;
    } else if (src.type === "extract-field") {
      inputs.prompt = output;
    } else if (src.type === "filter-list" || src.type === "deduplicate" || src.type === "merge-lists" || src.type === "sort-list") {
      inputs.prompt = output;
    } else if (src.type === "generate-script") {
      const handle = srcEdge.sourceHandle;
      const scriptNodeData = src.data as Record<string, unknown>;
      const script = getActiveScriptFromData(scriptNodeData);
      const scenes = (script?.scenes as Array<Record<string, unknown>>) ?? [];

      if (handle === "images" && scenes.length > 0) {
        // Pass generated image URLs as referenceImageUrls
        const imageUrls: string[] = [];
        for (const s of scenes) {
          const genImages = s.generatedImages as Array<{ url: string }> | undefined;
          const activeIdx = (s.activeImageIndex as number | undefined) ?? 0;
          const url = genImages?.[activeIdx]?.url;
          if (url) imageUrls.push(url);
        }
        if (imageUrls.length > 0) {
          inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), ...imageUrls];
        }
        // Also pass imagePrompts as text for generate-image list mode
        inputs.prompt = scenes.map((s) => (s.imagePrompt as string) ?? "").join("\n");
      } else if (handle === "dialogue") {
        const lines: Array<{ speaker: string; text: string; emotion?: string }> = [];
        for (const s of scenes) {
          const dlg = s.dialogue as Array<Record<string, unknown>> | undefined;
          if (dlg) {
            for (const d of dlg) {
              lines.push({
                speaker: (d.speaker as string) ?? "",
                text: (d.text as string) ?? "",
                emotion: (d.emotion as string) ?? undefined,
              });
            }
          }
        }
        if (lines.length > 0) inputs.dialogueLines = lines;
      } else if (handle === "music") {
        const moods = new Set<string>();
        for (const s of scenes) {
          const m = s.musicMood as string | undefined;
          if (m?.trim()) moods.add(m.trim());
        }
        if (moods.size > 0) inputs.prompt = Array.from(moods).join(", ");
      } else if (handle === "sfx") {
        const effects: string[] = [];
        for (const s of scenes) {
          const fx = s.soundEffects as string[] | undefined;
          if (fx) effects.push(...fx);
        }
        if (effects.length > 0) inputs.prompt = effects.join(", ");
      } else if (handle === "characters") {
        const chars = deduplicateCharacters(scenes);
        if (chars.length > 0) inputs.scriptCharacters = chars;
      } else if (handle === "locations") {
        const locs = deduplicateLocations(scenes);
        if (locs.length > 0) inputs.scriptLocations = locs;
      } else {
        // Default "scenes" handle or null — existing behavior
        inputs.prompt = output;
      }

    } else if (src.type === "webhook-trigger") {
      // Route by param type using sourceHandle (matches backend)
      const srcData = src.data as Record<string, unknown>;
      const params = srcData.params as Array<{ id: string; name: string; type: string }> | undefined;
      if (params && params.length > 0 && srcEdge.sourceHandle) {
        const param = params.find((p) => p.id === srcEdge.sourceHandle);
        if (param) {
          if (param.type === "imageUrl") {
            inputs.imageUrl = output;
          } else if (param.type === "videoUrl") {
            if (node.type === "combine-videos") {
              inputs.videoUrls = [...(inputs.videoUrls ?? []), output];
              inputs.videoUrlsWithSourceIds = [
                ...(inputs.videoUrlsWithSourceIds ?? []),
                { nodeId: src.id, url: output },
              ];
            } else if (node.type === "manual-edit") {
              appendManualEditAsset(inputs, src.id, output, "video");
            } else {
              inputs.videoUrl = output;
            }
          } else if (param.type === "audioUrl") {
            if (MULTI_AUDIO_INPUT_TYPES.has(node.type!)) {
              inputs.audioUrls = [...(inputs.audioUrls ?? []), output];
              inputs.audioUrlsWithSourceIds = [
                ...(inputs.audioUrlsWithSourceIds ?? []),
                { nodeId: src.id, url: output },
              ];
            } else if (node.type === "manual-edit") {
              appendManualEditAsset(inputs, src.id, output, "audio");
            } else {
              inputs.audioUrl = output;
            }
          } else {
            inputs.prompt = output;
          }
        } else {
          inputs.prompt = output;
        }
      } else {
        inputs.prompt = output;
      }
    } else if (src.type === "schedule-trigger") {
      inputs.prompt = output;
    } else if (src.type === "web-scrape") {
      // json handle output arrives pre-stringified from extractNodeOutput
      inputs.prompt = output;
    } else if (src.type === "sub-workflow" || src.type === "sub-workflow-input") {
      // Route sub-workflow output by the sourceHandle to the correct media type
      const srcData = src!.data as Record<string, unknown>;
      const routeSnapshot = srcData.routeSnapshot as { outputPorts?: Array<{ id: string; mediaType: string }> } | undefined;
      const subEdge = incomingEdges.find((e) => e.source === src!.id);
      const sourceHandle = subEdge?.sourceHandle as string | undefined;

      // Determine media type from the output port (sourceHandle = "out_<portId>")
      let mediaType: string | undefined;
      if (sourceHandle && routeSnapshot?.outputPorts) {
        const portId = sourceHandle.replace(/^out_/, "");
        const port = routeSnapshot.outputPorts.find((p) => p.id === portId);
        mediaType = port?.mediaType;
      }

      // For sub-workflow-input, determine type from __injectedPortValues mapping
      if (src.type === "sub-workflow-input") {
        const ports = srcData.ports as Array<{ id: string; mediaType: string }> | undefined;
        if (sourceHandle && ports) {
          const port = ports.find((p) => p.id === sourceHandle);
          mediaType = port?.mediaType;
        }
      }

      // Route by media type, respecting target node expectations
      if (mediaType === "image") {
        if (node.type === "generate-image" || (node.type as string) === "edit-image" || (node.type as string) === "image-to-image" || node.type === "modify-image") {
          inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output];
        } else if (node.type === "manual-edit") {
          appendManualEditAsset(inputs, src.id, output, "image");
        } else {
          inputs.imageUrl = output;
        }
      } else if (mediaType === "video") {
        if (node.type === "combine-videos") {
          inputs.videoUrls = [...(inputs.videoUrls ?? []), output];
          inputs.videoUrlsWithSourceIds = [
            ...(inputs.videoUrlsWithSourceIds ?? []),
            { nodeId: src.id, url: output },
          ];
        } else if (node.type === "manual-edit") {
          appendManualEditAsset(inputs, src.id, output, "video");
        } else if (node.type === "merge-video-audio") {
          if (!inputs.videoUrl) {
            inputs.videoUrl = output;
          } else {
            inputs.audioSources = [
              ...(inputs.audioSources ?? []),
              { url: output, sourceNodeId: src.id, sourceType: "video" as const },
            ];
          }
        } else {
          inputs.videoUrl = output;
        }
      } else if (mediaType === "audio") {
        if (node.type === "merge-video-audio") {
          inputs.audioSources = [
            ...(inputs.audioSources ?? []),
            { url: output, sourceNodeId: src.id },
          ];
        } else if (MULTI_AUDIO_INPUT_TYPES.has(node.type!)) {
          inputs.audioUrls = [...(inputs.audioUrls ?? []), output];
          inputs.audioUrlsWithSourceIds = [
            ...(inputs.audioUrlsWithSourceIds ?? []),
            { nodeId: src.id, url: output },
          ];
        } else if (node.type === "manual-edit") {
          appendManualEditAsset(inputs, src.id, output, "audio");
        } else {
          inputs.audioUrl = output;
        }
      } else {
        // Default to prompt for text or any
        inputs.prompt = output;
      }
    }
  }

  return inputs;
}
