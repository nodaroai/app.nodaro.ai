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
import { extractNodeOutput } from "./execution-graph";

/** Node types whose edges default to "each" output mode (fan-out) */
const DEFAULT_EACH_TYPES = new Set(["list", "loop", "split-text"]);

export function extractNodeOutputAsList(
  node: WorkflowNode,
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
  const listResults = data.__listResults as string[] | undefined;
  if (listResults && listResults.length > 0) return listResults;
  const single = extractNodeOutput(node);
  return single ? [single] : undefined;
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
            const items = upstreamOutput
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            if (items.length > 1) return items;
          }
        }
      } else if (colIndex >= 0) {
        const items = (loopData.rows ?? [])
          .map((row) => row[colIndex])
          .filter((v) => v?.trim());
        if (items.length > 1) return items;
      }
      continue;
    }

    // Check outputMode from edge data — only fan-out if mode is "each"
    // List/loop/split-text edges default to "each"; all other edges default to "last"
    const edgeOutputMode = (edge.data as Record<string, unknown> | undefined)?.outputMode as string | undefined;
    const outputMode = edgeOutputMode ?? (DEFAULT_EACH_TYPES.has(sourceNode.type ?? "") ? "each" : "last");
    if (outputMode !== "each") continue;

    const listOutput = extractNodeOutputAsList(sourceNode);
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

export function resolveNodeInputs(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): {
  prompt?: string;
  imageUrl?: string;
  videoUrl?: string;
  videoUrls?: string[];
  videoUrlsWithSourceIds?: Array<{ nodeId: string; url: string }>;
  audioUrl?: string;
  audioUrls?: string[];
  audioUrlsWithSourceIds?: Array<{ nodeId: string; url: string }>;
  audioSources?: {
    url: string;
    sourceNodeId: string;
    sourceType?: "audio" | "video";
  }[];
  referenceImageUrls?: string[];
  sunoTrackId?: string;
  sunoTaskId?: string;
  uploadUrl?: string;
} {
  const incomingEdges = edges.filter((e) => e.target === node.id);

  const inputs: {
    prompt?: string;
    imageUrl?: string;
    videoUrl?: string;
    videoUrls?: string[];
    videoUrlsWithSourceIds?: Array<{ nodeId: string; url: string }>;
    audioUrl?: string;
    audioUrls?: string[];
    audioUrlsWithSourceIds?: Array<{ nodeId: string; url: string }>;
    audioSources?: {
      url: string;
      sourceNodeId: string;
      sourceType?: "audio" | "video";
    }[];
    referenceImageUrls?: string[];
    sunoTrackId?: string;
    sunoTaskId?: string;
    uploadUrl?: string;
  } = {};

  for (const srcEdge of incomingEdges) {
    const src = nodes.find((n) => n.id === srcEdge.source);
    if (!src) continue;

    // Check for item:N/last/all output mode on nodes with fan-out list results
    const edgeMode = (srcEdge.data as Record<string, unknown> | undefined)
      ?.outputMode as string | undefined;
    const srcListResults = (src.data as Record<string, unknown>)
      .__listResults as string[] | undefined;
    let output: string | undefined;
    if (edgeMode && srcListResults && srcListResults.length > 0) {
      if (edgeMode.startsWith("item:")) {
        const idx = parseInt(edgeMode.split(":")[1], 10);
        output = srcListResults[idx] ?? srcListResults[0];
      } else if (edgeMode === "last") {
        output = srcListResults[srcListResults.length - 1];
      } else if (edgeMode === "all") {
        output = srcListResults.join(", ");
      }
    }
    if (!output) {
      output = extractNodeOutput(src, srcEdge.sourceHandle ?? undefined);
    }
    if (!output) continue;

    if (src.type === "text-prompt") {
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
            const lines = upstreamOutput
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
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
      if (node.type === "generate-image") {
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
      if (node.type === "lip-sync" || node.type === "speech-to-video" || node.type === "sora-storyboard") {
        inputs.imageUrl = output;
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
    } else if (
      src.type === "image-to-video" ||
      src.type === "video-to-video" ||
      src.type === "text-to-video" ||
      src.type === "lip-sync" ||
      src.type === "speech-to-video" ||
      src.type === "sora-storyboard" ||
      src.type === "motion-transfer" ||
      src.type === "video-upscale" ||
      src.type === "extend-video" ||
      src.type === "suno-music-video" ||
      src.type === "combine-videos" ||
      src.type === "merge-video-audio" ||
      src.type === "add-captions" ||
      src.type === "resize-video" ||
      src.type === "social-media-format" ||
      src.type === "trim-video" ||
      src.type === "render-video" ||
      src.type === "speed-ramp" ||
      src.type === "loop-video" ||
      src.type === "fade-video"
    ) {
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
    } else if (src.type === "reference-audio") {
      if (node.type === "generate-music") {
        inputs.audioUrl = output;
      } else if (node.type === "mix-audio") {
        inputs.audioUrls = [...(inputs.audioUrls ?? []), output];
        inputs.audioUrlsWithSourceIds = [
          ...(inputs.audioUrlsWithSourceIds ?? []),
          { nodeId: src.id, url: output },
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
      if (node.type === "mix-audio") {
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
      } else if (node.type === "mix-audio") {
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
      if (node.type === "mix-audio") {
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
      if (
        src.type === "suno-generate" ||
        src.type === "suno-cover" ||
        src.type === "suno-extend"
      ) {
        const srcData = src.data as Record<string, unknown>;
        if (srcData.sunoTrackId) {
          inputs.sunoTrackId = srcData.sunoTrackId as string;
        }
        if (srcData.sunoTaskId) {
          inputs.sunoTaskId = srcData.sunoTaskId as string;
        }
      }
    } else if (src.type === "transcribe" || src.type === "suno-lyrics" || src.type === "suno-style-boost" || src.type === "image-to-text" || src.type === "forced-alignment") {
      inputs.prompt = output;
    } else if (src.type === "ai-writer") {
      inputs.prompt = output;
    } else if (src.type === "combine-text") {
      inputs.prompt = output;
    } else if (src.type === "preview") {
      inputs.prompt = output;
    } else if (src.type === "split-text") {
      inputs.prompt = output;
    } else if (src.type === "sub-workflow" || src.type === "sub-workflow-input") {
      // Route sub-workflow output by the sourceHandle to the correct media type
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
