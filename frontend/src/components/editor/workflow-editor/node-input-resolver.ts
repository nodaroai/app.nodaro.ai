import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { buildScenePrompt } from "@/lib/prompt-builder";
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

    const listOutput = extractNodeOutputAsList(sourceNode);
    if (listOutput && listOutput.length > 1) return listOutput;
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
  const sourceNodes = incomingEdges
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is WorkflowNode => n !== undefined);

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

  for (const src of sourceNodes) {
    const srcEdge = incomingEdges.find((e) => e.source === src.id);
    const output = extractNodeOutput(src, srcEdge?.sourceHandle ?? undefined);
    if (!output) continue;

    if (src.type === "text-prompt") {
      inputs.prompt = output;
    } else if (src.type === "list") {
      inputs.prompt = output;
    } else if (src.type === "loop") {
      const loopEdge = incomingEdges.find((e) => e.source === src.id);
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
          (c) => c.handleId === loopEdge?.sourceHandle,
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
      if (node.type === "lip-sync") {
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
      src.type === "motion-transfer" ||
      src.type === "video-upscale" ||
      src.type === "extend-video" ||
      src.type === "suno-music-video" ||
      src.type === "combine-videos" ||
      src.type === "merge-video-audio" ||
      src.type === "add-captions" ||
      src.type === "resize-video" ||
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
      src.type === "extract-audio" ||
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
    } else if (src.type === "transcribe" || src.type === "suno-lyrics" || src.type === "image-to-text" || src.type === "forced-alignment") {
      inputs.prompt = output;
    } else if (src.type === "ai-writer") {
      inputs.prompt = output;
    } else if (src.type === "combine-text") {
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
