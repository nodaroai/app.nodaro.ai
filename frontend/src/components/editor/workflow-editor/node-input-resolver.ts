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
import { extractNodeOutput, IMAGE_URL_RE, VIDEO_URL_RE, AUDIO_URL_RE } from "./execution-graph";
import { applyRange, resolveIndex } from "@nodaro-shared/edge-range";
import { splitByLoopDelimiter } from "@nodaro-shared/loop-delimiter";

/** Node types whose edges default to "each" output mode (fan-out) */
const DEFAULT_EACH_TYPES = new Set(["list", "loop", "split-text"]);

/** Node types that accept multiple audio inputs (accumulate to audioUrls array) */
const MULTI_AUDIO_INPUT_TYPES = new Set(["mix-audio"]);

/** VIDEO_OUTPUT_NODE_TYPES — used for kieTaskId passthrough */
const VIDEO_OUTPUT_NODE_TYPES = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "lip-sync",
  "speech-to-video",
  "sora-storyboard",
  "motion-transfer",
  "video-upscale",
  "extend-video",
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
  characterIdList?: string[];
  componentInputMap?: Record<string, string>;
  systemPrompt?: string;
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

export function extractNodeOutputAsList(
  node: WorkflowNode,
  useAllResults = false,
): string[] | undefined {
  const data = node.data as Record<string, unknown>;
  if (node.type === "split-text") {
    const splitResults = (data.splitResults as string[] | undefined) ?? [];
    return splitResults.length > 0 ? splitResults : undefined;
  }
  if (node.type === "list") {
    const items = (data.items as string | undefined) || "";
    const lines = items
      .split("\n")
      .filter((l: string) => l.trim().length > 0)
      .map((l: string) => l.trim());
    return lines.length > 0 ? lines : undefined;
  }
  if (useAllResults) {
    // Prefer generatedResults (full history), fall back to __listResults
    const allResults = extractAllGeneratedResults(data, true);
    if (allResults) return allResults;
  }
  const listResults = data.__listResults as string[] | undefined;
  if (listResults && listResults.length > 0) return listResults;
  // Fall back to accumulated generatedResults (multiple manual runs)
  const allResults = extractAllGeneratedResults(data);
  if (allResults) return allResults;
  const single = extractNodeOutput(node);
  return single ? [single] : undefined;
}

/**
 * Extract all output values from a node's accumulated generatedResults.
 * When skipLengthGuard is true (useAllResults mode), returns even single-element arrays.
 * When false (default), requires 2+ results for fan-out benefit.
 */
function extractAllGeneratedResults(
  data: Record<string, unknown>,
  skipLengthGuard = false,
): string[] | undefined {
  const results = data.generatedResults as
    | Array<{ url?: string; text?: string }>
    | undefined;
  if (!results || results.length === 0) return undefined;

  const outputs = results
    .map((r) => r.url || r.text || "")
    .filter((v) => v.length > 0);
  if (outputs.length === 0) return undefined;

  // Default: require 2+ outputs for fan-out benefit
  // useAllResults: return even a single result since user explicitly opted in
  if (!skipLengthGuard && outputs.length <= 1) return undefined;
  return outputs;
}

/**
 * Check if a node receives list input from any source.
 * Returns the list items if found, undefined otherwise.
 */
export function getListInputForNode(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] | undefined {
  const incomingEdges = edges.filter((e) => e.target === node.id);
  for (const edge of incomingEdges) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (!sourceNode) continue;

    // generate-script "images" handle → list of imagePrompts
    if (sourceNode.type === "generate-script" && edge.sourceHandle === "images") {
      const sd = sourceNode.data as Record<string, unknown>;
      const activeScript = getActiveScriptFromData(sd);
      const scenesList = (activeScript?.scenes as Array<Record<string, unknown>>) ?? [];
      if (scenesList.length > 1) {
        return scenesList.map((s) => (s.imagePrompt as string) ?? "");
      }
    }

    if (sourceNode.type === "loop") {
      const loopData = sourceNode.data as LoopNodeData;
      const colIndex = (loopData.columns ?? []).findIndex(
        (c) => c.handleId === edge.sourceHandle,
      );

      const loopIncomingEdges = edges.filter(
        (e) => e.target === sourceNode.id && e.targetHandle === "in",
      );
      if (loopIncomingEdges.length > 0) {
        const upstreamEdge = loopIncomingEdges[0];
        const upstreamNode = nodes.find((n) => n.id === upstreamEdge.source);
        if (upstreamNode) {
          const upstreamOutput = extractNodeOutput(upstreamNode);
          if (upstreamOutput) {
            const raw = splitByLoopDelimiter(upstreamOutput, loopData.columns);
            const edgeData = edge.data as Record<string, unknown> | undefined;
            const items = applyRange(
              raw,
              edgeData?.rangeFrom as string | undefined,
              edgeData?.rangeTo as string | undefined,
              edgeData?.rangeStep as number | undefined,
            );
            if (items.length > 1) return items;
          }
        }
      } else if (colIndex >= 0) {
        const raw = (loopData.rows ?? [])
          .map((row) => row[colIndex])
          .filter((v) => v?.trim());
        const edgeData = edge.data as Record<string, unknown> | undefined;
        const items = applyRange(
          raw,
          edgeData?.rangeFrom as string | undefined,
          edgeData?.rangeTo as string | undefined,
          edgeData?.rangeStep as number | undefined,
        );
        if (items.length > 1) return items;
      }
      continue;
    }

    // Check outputMode from edge data — only fan-out if mode is "each"
    // List/loop/split-text edges default to "each"; all other edges default to "last"
    const edgeOutputMode = (edge.data as Record<string, unknown> | undefined)?.outputMode as string | undefined;
    const outputMode = edgeOutputMode ?? (DEFAULT_EACH_TYPES.has(sourceNode.type ?? "") ? "each" : "last");
    if (outputMode !== "each") continue;

    const edgeUseAll = !!(edge.data as Record<string, unknown> | undefined)?.useAllResults;
    const listOutput = extractNodeOutputAsList(sourceNode, edgeUseAll);
    if (listOutput && listOutput.length > 1) return listOutput;
  }

  // Transitive fan-out: if a direct parent is a text-prompt whose own upstream
  // is a list-like node with "each" mode, resolve the text template per item.
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

      const listItems = extractNodeOutputAsList(listNode);
      if (!listItems || listItems.length <= 1) continue;

      // Build ref map for the text-prompt to resolve nested refs
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
      if (resolvedItems.length > 1) return resolvedItems;
    }
  }

  return undefined;
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
    const src = nodes.find((n) => n.id === srcEdge.source);
    if (!src) continue;

    // Check for item:N/last/all output mode on nodes with fan-out list results
    // or accumulated generatedResults from multiple manual runs
    const edgeMode = (srcEdge.data as Record<string, unknown> | undefined)
      ?.outputMode as string | undefined;
    const edgeUseAll = (srcEdge.data as Record<string, unknown> | undefined)
      ?.useAllResults as boolean | undefined;
    const srcData = src.data as Record<string, unknown>;
    // split-media uses outputChunkIndex routing, skip __listResults
    const srcListResults = src.type === "split-media" ? undefined : (edgeUseAll
      ? (extractAllGeneratedResults(srcData, true) ?? (srcData.__listResults as string[] | undefined))
      : ((srcData.__listResults as string[] | undefined) ?? extractAllGeneratedResults(srcData)));
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
        output = srcListResults[srcListResults.length - 1];
      } else if (edgeMode === "all") {
        // For array-accumulating targets, spread items individually
        if (node.type === "combine-videos") {
          for (const item of srcListResults) {
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
        if (node.type === "mix-audio") {
          for (const item of srcListResults) {
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
        output = srcListResults.join(", ");
      } else if (edgeMode === "each" && listIterationIndex !== undefined) {
        // During list fan-out, index into the i-th result from each "each" source
        output = srcListResults[listIterationIndex] ?? srcListResults[srcListResults.length - 1];
      }
    }
    if (!output && src.type === "loop" && listIterationIndex !== undefined) {
      // Per-iteration resolution for correlated loop columns during fan-out
      const loopData = src.data as LoopNodeData;
      const colIndex = (loopData.columns ?? []).findIndex(
        (c) => c.handleId === srcEdge.sourceHandle,
      );
      if (colIndex >= 0) {
        const loopInEdges = edges.filter(
          (e) => e.target === src.id && e.targetHandle === "in",
        );
        let raw: string[];
        if (loopInEdges.length > 0) {
          const upstreamNode = nodes.find((n) => n.id === loopInEdges[0].source);
          const upstreamText = upstreamNode ? extractNodeOutput(upstreamNode) : undefined;
          raw = upstreamText
            ? splitByLoopDelimiter(upstreamText, (src.data as LoopNodeData).columns)
            : [];
        } else {
          raw = (loopData.rows ?? [])
            .map((row) => row[colIndex])
            .filter((v) => v?.trim());
        }
        const edgeData = srcEdge.data as Record<string, unknown> | undefined;
        const ranged = applyRange(
          raw,
          edgeData?.rangeFrom as string | undefined,
          edgeData?.rangeTo as string | undefined,
          edgeData?.rangeStep as number | undefined,
        );
        output = ranged[listIterationIndex] ?? "";
      }
    }

    // During fan-out: resolve per-iteration values from loop columns and list sources
    if (!output && listIterationIndex != null) {
      if (src.type === "loop") {
        const loopData = src.data as LoopNodeData;
        const colIndex = (loopData.columns ?? []).findIndex(
          (c) => c.handleId === srcEdge.sourceHandle,
        );
        if (colIndex >= 0) {
          const loopIncomingEdges = edges.filter(
            (e) => e.target === src.id && e.targetHandle === "in",
          );
          if (loopIncomingEdges.length > 0) {
            const upstreamEdge = loopIncomingEdges[0];
            const upstreamNode = nodes.find((n) => n.id === upstreamEdge.source);
            if (upstreamNode) {
              const upstreamOutput = extractNodeOutput(upstreamNode);
              if (upstreamOutput) {
                const lines = splitByLoopDelimiter(upstreamOutput, (src.data as LoopNodeData).columns);
                const edgeData = srcEdge.data as Record<string, unknown> | undefined;
                const rf = edgeData?.rangeFrom as string | undefined;
                const rt = edgeData?.rangeTo as string | undefined;
                const rs = edgeData?.rangeStep as number | undefined;
                const filtered = applyRange(lines, rf, rt, rs);
                output = filtered[listIterationIndex];
              }
            }
          } else {
            const items = (loopData.rows ?? [])
              .map((row) => row[colIndex])
              .filter((v) => v?.trim());
            const edgeData = srcEdge.data as Record<string, unknown> | undefined;
            const rf = edgeData?.rangeFrom as string | undefined;
            const rt = edgeData?.rangeTo as string | undefined;
            const rs = edgeData?.rangeStep as number | undefined;
            const filtered = applyRange(items, rf, rt, rs);
            output = filtered[listIterationIndex];
          }
        }
      } else if (srcListResults && srcListResults.length > 0) {
        // Non-loop source with listResults: advance per iteration for "each" mode
        const effectiveMode = edgeMode ?? (DEFAULT_EACH_TYPES.has(src.type ?? "") ? "each" : "last");
        if (effectiveMode === "each") {
          const edgeData = srcEdge.data as Record<string, unknown> | undefined;
          const rf = edgeData?.rangeFrom as string | undefined;
          const rt = edgeData?.rangeTo as string | undefined;
          const rs = edgeData?.rangeStep as number | undefined;
          const filtered = applyRange(srcListResults, rf, rt, rs);
          output = filtered[listIterationIndex];
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
    if (srcEdge.targetHandle === "characters") {
      // Aggregate character IDs from sora-character nodes into characterIdList
      const srcData = src.data as Record<string, unknown>;
      const characterId = (srcData.generatedCharacterId as string | undefined);
      if (characterId) {
        inputs.characterIdList = [...(inputs.characterIdList ?? []), characterId];
      }
      continue;
    }
    if (srcEdge.targetHandle === "references") {
      inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output];
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

    // Silent video output from trim-video node
    if (src.type === "trim-video" && srcEdge.sourceHandle === "silent-video") {
      const srcData = src.data as Record<string, unknown>;
      const silentUrl = srcData.generatedSilentVideoUrl as string | undefined;
      if (silentUrl) {
        inputs.videoUrl = silentUrl;
      }
      continue;
    }

    // Split media output — route selected chunk by outputChunkIndex
    if (src.type === "split-media") {
      const liveNode = useWorkflowStore.getState().nodes.find(n => n.id === src.id);
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

    if (src.type === "teleport-send" || src.type === "teleport-receive") {
      // Teleporter passthrough — detect media type from URL
      if (IMAGE_URL_RE.test(output)) {
        inputs.imageUrl = output
      } else if (VIDEO_URL_RE.test(output)) {
        inputs.videoUrl = output
      } else if (AUDIO_URL_RE.test(output)) {
        inputs.audioUrl = output
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
    } else if (src.type === "list") {
      // Read output mode from the edge, not the node
      const edgeMode = (srcEdge?.data as Record<string, unknown> | undefined)?.outputMode as string | undefined;
      const outputMode = edgeMode ?? "each"; // list edges default to "each"
      const items = ((src.data as Record<string, unknown>).items as string || "")
        .split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0);
      if (outputMode === "all") {
        inputs.prompt = items.join(", ") || output;
      } else if (outputMode === "last") {
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
    } else if (src.type === "loop") {
      const loopData = src.data as LoopNodeData;

      const loopIncomingEdges = edges.filter(
        (e) => e.target === src.id && e.targetHandle === "in",
      );
      if (loopIncomingEdges.length > 0) {
        const upstreamEdge = loopIncomingEdges[0];
        const upstreamNode = nodes.find((n) => n.id === upstreamEdge.source);
        if (upstreamNode) {
          const upstreamOutput = extractNodeOutput(upstreamNode);
          if (upstreamOutput) {
            const lines = splitByLoopDelimiter(upstreamOutput, loopData.columns);
            inputs.prompt = lines[0] || "";
          }
        }
      } else {
        const colIndex = (loopData.columns ?? []).findIndex(
          (c) => c.handleId === srcEdge.sourceHandle,
        );
        if (colIndex >= 0) {
          inputs.prompt = loopData.rows?.[0]?.[colIndex]?.trim() || "";
        }
      }
    } else if (src.type === "upload-image") {
      if (node.type === "generate-image" || node.type === "sora-storyboard") {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
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
      } else if (node.type === "sora-storyboard") {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      } else {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
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
      if (node.type === "generate-image") {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      } else if (node.type === "text-to-audio") {
        inputs.prompt = (src.data as GenerateImageData).prompt ?? "";
      } else {
        inputs.imageUrl = output;
      }
    } else if (src.type === "edit-image") {
      if (
        node.type === "generate-image" ||
        node.type === "edit-image" ||
        node.type === "image-to-image"
      ) {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      } else {
        inputs.imageUrl = output;
      }
    } else if (src.type === "image-to-image") {
      if (
        node.type === "generate-image" ||
        node.type === "edit-image" ||
        node.type === "image-to-image"
      ) {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
      } else {
        inputs.imageUrl = output;
      }
    } else if (src.type === "extract-frame") {
      if (
        node.type === "generate-image" ||
        node.type === "edit-image" ||
        node.type === "image-to-image"
      ) {
        inputs.referenceImageUrls = [
          ...(inputs.referenceImageUrls ?? []),
          output,
        ];
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
      // Pass through kieTaskId for VEO/Runway extend, upscale, and sora-character nodes (matches backend)
      if (node.type === "extend-video" || node.type === "video-upscale" || node.type === "sora-character") {
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
        if (node.type === "generate-image") {
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
    } else if (src.type === "generate-script") {
      const handle = srcEdge.sourceHandle;
      const scriptNodeData = src.data as Record<string, unknown>;
      const script = getActiveScriptFromData(scriptNodeData);
      const scenes = (script?.scenes as Array<Record<string, unknown>>) ?? [];

      if (handle === "images" && scenes.length > 0) {
        // Pass generated image URLs as referenceImageUrls (for sora-storyboard, etc.)
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

      // Always pass scriptData for sora-storyboard regardless of handle
      if (node.type === "sora-storyboard" && script) {
        inputs.scriptData = script;
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
    } else if (src.type === "sub-workflow" || src.type === "sub-workflow-input" || src.type === "component") {
      // Route sub-workflow/component output by the sourceHandle to the correct media type
      const srcData = src.data as Record<string, unknown>;
      const routeSnapshot = srcData.routeSnapshot as { outputPorts?: Array<{ id: string; mediaType: string }> } | undefined;
      const subEdge = incomingEdges.find((e) => e.source === src.id);
      const sourceHandle = subEdge?.sourceHandle as string | undefined;

      // Determine media type from the output port (sourceHandle = "out_<portId>")
      let mediaType: string | undefined;
      if (sourceHandle && routeSnapshot?.outputPorts) {
        const portId = sourceHandle.replace(/^out_/, "");
        const port = routeSnapshot.outputPorts.find((p) => p.id === portId);
        mediaType = port?.mediaType;
      }

      // For component nodes, determine type from componentMetadata outputs
      if (src.type === "component" && !mediaType) {
        const metadata = srcData.componentMetadata as { outputs?: Array<{ id: string; mediaType: string }> } | undefined;
        if (sourceHandle && metadata?.outputs) {
          const handleId = sourceHandle.replace(/^out_/, "");
          const port = metadata.outputs.find((o) => o.id === handleId);
          mediaType = port?.mediaType;
        }
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
        if (node.type === "generate-image" || node.type === "edit-image" || node.type === "image-to-image") {
          inputs.referenceImageUrls = [...(inputs.referenceImageUrls ?? []), output];
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
        } else if (node.type === "mix-audio") {
          inputs.audioUrls = [...(inputs.audioUrls ?? []), output];
          inputs.audioUrlsWithSourceIds = [
            ...(inputs.audioUrlsWithSourceIds ?? []),
            { nodeId: src.id, url: output },
          ];
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
