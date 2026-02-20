import { useWorkflowStore } from "@/hooks/use-workflow-store";
import type { WorkflowNode, SceneNodeDataType } from "@/types/nodes";
import { extractNodeOutput } from "./execution-graph";
import { executeNode } from "./execute-node";
import type { ExecutionContext } from "./types";

/**
 * Execute a node once for each item in the list. Results are accumulated
 * and stored as __listResults on the node for later clone expansion.
 */
export async function executeNodeForList(
  node: WorkflowNode,
  items: string[],
  ctx: ExecutionContext,
): Promise<void> {
  const { updateNodeData } = useWorkflowStore.getState();

  updateNodeData(node.id, {
    executionStatus: "running",
    errorMessage: undefined,
    generatedResults: [],
    __listTotal: items.length,
    __listCompleted: 0,
    __listResults: [],
    __listInputs: [...items],
  });

  const results: string[] = [];
  let completedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < items.length; i++) {
    if (ctx.isWorkflowStale()) break;

    const item = items[i];
    const isUrl =
      item.startsWith("http") ||
      /\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|ogg)(\?|$)/i.test(item);

    try {
      const freshNode = useWorkflowStore
        .getState()
        .nodes.find((n) => n.id === node.id);
      if (!freshNode) break;

      await executeNode(
        freshNode,
        ctx,
        isUrl ? undefined : item,
        isUrl ? item : undefined,
      );

      const afterNode = useWorkflowStore
        .getState()
        .nodes.find((n) => n.id === node.id);
      if (afterNode) {
        if (node.type === "ai-writer") {
          const afterData = afterNode.data as Record<string, unknown>;
          results.push((afterData?.generatedText as string) || "");
        } else {
          results.push(extractNodeOutput(afterNode) || "");
        }
      } else {
        results.push("");
      }
      completedCount++;
    } catch {
      failedCount++;
      results.push("");
    }

    useWorkflowStore.getState().updateNodeData(node.id, {
      __listCompleted: completedCount + failedCount,
      __listResults: [...results],
    });
  }

  useWorkflowStore.getState().updateNodeData(node.id, {
    executionStatus: failedCount === items.length ? "failed" : "completed",
    __listTotal: items.length,
    __listCompleted: completedCount + failedCount,
    __listResults: results,
    __listInputs: [...items],
    errorMessage:
      failedCount > 0
        ? `${completedCount}/${items.length} succeeded, ${failedCount} failed`
        : undefined,
  });
}

// --- Post-execution: expand loop results into separate pipelines ---

const VIDEO_TYPES = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "video-upscale",
  "motion-transfer",
  "lip-sync",
  "suno-music-video",
  "combine-videos",
  "render-video",
]);

const AUDIO_TYPES = new Set([
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-separate",
]);

function getOutputUrlField(nodeType: string): string {
  if (VIDEO_TYPES.has(nodeType)) return "generatedVideoUrl";
  if (AUDIO_TYPES.has(nodeType)) return "generatedAudioUrl";
  return "generatedImageUrl";
}

/**
 * After list execution, expand multi-result pipeline nodes into separate
 * visual clones so each iteration has its own node on the canvas.
 */
export function expandLoopResults(): void {
  const { nodes, edges } = useWorkflowStore.getState();

  const multiResultNodes = nodes.filter((n) => {
    const d = n.data as Record<string, unknown>;
    const results = d.__listResults as string[] | undefined;
    return results && results.length > 1;
  });
  if (multiResultNodes.length === 0) return;

  // Build adjacency: source -> [target edges]
  const downstreamEdges = new Map<string, typeof edges>();
  for (const edge of edges) {
    const list = downstreamEdges.get(edge.source) ?? [];
    list.push(edge);
    downstreamEdges.set(edge.source, list);
  }

  // Walk downstream from each multi-result node to find the full pipeline chain.
  const multiResultIds = new Set(multiResultNodes.map((n) => n.id));
  const visited = new Set<string>();
  const chains: WorkflowNode[][] = [];

  for (const startNode of multiResultNodes) {
    if (visited.has(startNode.id)) continue;
    const chain: WorkflowNode[] = [];
    const queue = [startNode];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      chain.push(current);
      for (const edge of downstreamEdges.get(current.id) ?? []) {
        if (multiResultIds.has(edge.target) && !visited.has(edge.target)) {
          const targetNode = nodes.find((n) => n.id === edge.target);
          if (targetNode) queue.push(targetNode);
        }
      }
    }
    if (chain.length > 0) chains.push(chain);
  }

  if (chains.length === 0) return;

  // List source types should NOT be cloned or removed
  const LIST_SOURCE_TYPES = new Set(["loop", "split-text", "list"]);
  const cloneableNodeIds = new Set(
    chains
      .flat()
      .filter((n) => !LIST_SOURCE_TYPES.has(n.type as string))
      .map((n) => n.id),
  );
  const resultCount = (chains[0][0].data as Record<string, unknown>)
    .__listResults as string[];
  if (!resultCount) return;

  const newNodes: WorkflowNode[] = [];
  const newEdges: typeof edges = [];

  for (const chain of chains) {
    const iterCount = (
      (chain[0].data as Record<string, unknown>).__listResults as string[]
    ).length;

    for (let i = 0; i < iterCount; i++) {
      for (const node of chain) {
        if (LIST_SOURCE_TYPES.has(node.type as string)) continue;
        const d = node.data as Record<string, unknown>;
        const listResults = (d.__listResults as string[]) ?? [];
        const listInputs = (d.__listInputs as string[]) ?? [];
        const resultUrl = listResults[i] ?? "";
        const inputText = listInputs[i] ?? "";
        const outputField = getOutputUrlField(node.type as string);

        const cloneData: Record<string, unknown> = { ...d };
        if (resultUrl) {
          cloneData.generatedResults = [
            {
              url: resultUrl,
              timestamp: new Date().toISOString(),
              jobId: "",
            },
          ];
          cloneData[outputField] = resultUrl;
          cloneData.activeResultIndex = 0;
        }
        if (inputText && !inputText.startsWith("http")) {
          cloneData.prompt = inputText;
        }
        const baseLabel = (d.label as string) || (node.type as string);
        cloneData.label = `${baseLabel} #${i + 1}`;
        cloneData.executionStatus = resultUrl ? "completed" : "failed";
        cloneData.__expandedClone = true;
        cloneData.__expandedFrom = node.id;
        delete cloneData.__listResults;
        delete cloneData.__listInputs;
        delete cloneData.__listTotal;
        delete cloneData.__listCompleted;

        newNodes.push({
          ...node,
          id: `${node.id}_iter_${i}`,
          position: { x: node.position.x, y: node.position.y + i * 220 },
          data: cloneData as SceneNodeDataType,
        });
      }
    }
  }

  // Recreate edges between cloned pipeline nodes
  for (const edge of edges) {
    const sourceCloneable = cloneableNodeIds.has(edge.source);
    const targetCloneable = cloneableNodeIds.has(edge.target);

    if (sourceCloneable && targetCloneable) {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const iterCount = sourceNode
        ? ((
            (sourceNode.data as Record<string, unknown>).__listResults as
              | string[]
              | undefined
          )?.length ?? 0)
        : 0;
      for (let i = 0; i < iterCount; i++) {
        newEdges.push({
          ...edge,
          id: `${edge.id}_iter_${i}`,
          source: `${edge.source}_iter_${i}`,
          target: `${edge.target}_iter_${i}`,
        });
      }
    } else if (!sourceCloneable && targetCloneable) {
      const targetNode = nodes.find((n) => n.id === edge.target);
      const iterCount = targetNode
        ? ((
            (targetNode.data as Record<string, unknown>).__listResults as
              | string[]
              | undefined
          )?.length ?? 0)
        : 0;
      for (let i = 0; i < iterCount; i++) {
        newEdges.push({
          ...edge,
          id: `${edge.id}_iter_${i}`,
          target: `${edge.target}_iter_${i}`,
        });
      }
    }
  }

  // Hide original pipeline nodes
  const finalNodes = nodes.map((n) => {
    if (!cloneableNodeIds.has(n.id)) return n;
    return { ...n, hidden: true };
  });

  useWorkflowStore.setState({
    nodes: [...finalNodes, ...newNodes],
    edges: [...edges, ...newEdges],
    isDirty: true,
  });
}
