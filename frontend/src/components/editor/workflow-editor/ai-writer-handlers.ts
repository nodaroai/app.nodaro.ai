import type { RefObject } from "react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import type {
  WorkflowNode,
  WorkflowEdge,
  AIWriterNodeData,
} from "@/types/nodes";
import { NODE_DEFINITIONS } from "@/types/nodes";
import { executeNode } from "./execute-node";
import type { ExecutionContext } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getImageOutputHandle(nodeType: string): string {
  switch (nodeType) {
    case "generate-image":
    case "upload-image":
      return "image";
    case "character":
      return "characterRef";
    case "object":
      return "objectRef";
    case "location":
      return "locationRef";
    case "face":
      return "faceRef";
    default:
      return "out"; // edit-image, image-to-image
  }
}

// ---------------------------------------------------------------------------
// handleCreateNodesFromWriter
// ---------------------------------------------------------------------------

export function handleCreateNodesFromWriter(writerNodeId: string): void {
  const store = useWorkflowStore.getState();
  const writerNode = store.nodes.find((n) => n.id === writerNodeId);
  if (!writerNode) return;

  const writerData = writerNode.data as AIWriterNodeData;
  const items = writerData.generatedItems;
  if (!items || items.length === 0) {
    toast.error(
      "No generated prompts to create nodes from. Run the AI Agent first.",
    );
    return;
  }

  // Cleanup previously created nodes (if re-generating)
  const oldNodeIds = writerData.createdNodeIds ?? [];
  if (oldNodeIds.length > 0) {
    for (const oldId of oldNodeIds) {
      store.deleteNode(oldId);
    }
  }

  const freshStore = useWorkflowStore.getState();

  // Find Face node on the canvas
  const writerIncomingEdges = freshStore.edges.filter(
    (e) => e.target === writerNodeId,
  );
  const connectedFace = writerIncomingEdges
    .map((e) => freshStore.nodes.find((n) => n.id === e.source))
    .find((n) => n?.type === "face");
  const faceNode =
    connectedFace ?? freshStore.nodes.find((n) => n.type === "face");

  // Find image-producing source nodes connected to AI Writer
  const IMAGE_SOURCE_TYPES = new Set([
    "generate-image",
    "upload-image",
    "edit-image",
    "image-to-image",
    "character",
    "object",
    "location",
  ]);
  const imageSourceNodes = writerIncomingEdges
    .map((e) => freshStore.nodes.find((n) => n.id === e.source))
    .filter(
      (n): n is WorkflowNode =>
        !!n && IMAGE_SOURCE_TYPES.has(n.type ?? "") && n.type !== "face",
    );

  let idCounter =
    store.nodes.reduce((max, n) => {
      const num = parseInt(n.id.replace("node_", ""), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0) + 1;

  function nextId(): string {
    const id = `node_${idCounter}`;
    idCounter += 1;
    return id;
  }

  const imgDef = NODE_DEFINITIONS.find((d) => d.type === "generate-image");
  const imgDefaults = imgDef?.defaultData ?? {};

  const newNodes: WorkflowNode[] = [];
  const newEdges: WorkflowEdge[] = [];
  const createdIds: string[] = [];

  const startX = writerNode.position.x + 400;
  const startY = writerNode.position.y;
  const COL_SPACING = 320;
  const ROW_SPACING = 280;

  for (let i = 0; i < items.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const nodeId = nextId();
    createdIds.push(nodeId);

    newNodes.push({
      id: nodeId,
      type: "generate-image",
      position: {
        x: startX + col * COL_SPACING,
        y: startY + row * ROW_SPACING,
      },
      data: {
        ...imgDefaults,
        label: `Image ${i + 1}`,
        prompt:
          items[i].length > 1500
            ? items[i].substring(0, 1500) + "..."
            : items[i],
      },
    } as WorkflowNode);

    // Edge: AI Writer -> Generate Image
    newEdges.push({
      id: `edge_${Date.now()}_writer_img_${i}`,
      source: writerNodeId,
      sourceHandle: "text",
      target: nodeId,
      targetHandle: "in",
    } as WorkflowEdge);

    // Edge: Face -> Generate Image (if Face node exists)
    if (faceNode) {
      newEdges.push({
        id: `edge_${Date.now()}_face_img_${i}`,
        source: faceNode.id,
        sourceHandle: "faceRef",
        target: nodeId,
        targetHandle: "in",
      } as WorkflowEdge);
    }

    // Edges: Reference Image sources -> Generate Image
    for (const imgSrc of imageSourceNodes) {
      const srcHandle = getImageOutputHandle(imgSrc.type ?? "");
      newEdges.push({
        id: `edge_${Date.now()}_ref_${imgSrc.id}_img_${i}`,
        source: imgSrc.id,
        sourceHandle: srcHandle,
        target: nodeId,
        targetHandle: "in",
      } as WorkflowEdge);
    }
  }

  store.batchAddNodesAndEdges(newNodes, newEdges);
  store.updateNodeData(writerNodeId, { createdNodeIds: createdIds });
  const refInfo = [
    faceNode ? "Face" : "",
    imageSourceNodes.length > 0
      ? `${imageSourceNodes.length} ref image${imageSourceNodes.length !== 1 ? "s" : ""}`
      : "",
  ]
    .filter(Boolean)
    .join(" + ");
  toast.success(
    `Created ${items.length} Generate Image nodes${refInfo ? ` (with ${refInfo})` : ""}`,
  );
}

// ---------------------------------------------------------------------------
// handleRunAllWriterImageNodes
// ---------------------------------------------------------------------------

export async function handleRunAllWriterImageNodes(
  writerNodeId: string,
  ctx: ExecutionContext,
  pollIntervalsRef: RefObject<Set<ReturnType<typeof setInterval>>>,
): Promise<void> {
  const store = useWorkflowStore.getState();
  const writerNode = store.nodes.find((n) => n.id === writerNodeId);
  if (!writerNode) return;

  const writerData = writerNode.data as AIWriterNodeData;
  const nodeIds = writerData.createdNodeIds ?? [];
  if (nodeIds.length === 0) {
    toast.error("No image nodes to run. Create nodes first.");
    return;
  }

  const targetNodes = nodeIds
    .map((id) => store.nodes.find((n) => n.id === id))
    .filter((n): n is WorkflowNode => !!n && n.type === "generate-image");

  if (targetNodes.length === 0) {
    toast.error("Created image nodes no longer exist on canvas.");
    return;
  }

  for (const node of targetNodes) {
    store.updateNodeData(node.id, {
      executionStatus: "idle",
      errorMessage: undefined,
    });
  }

  ctx.setIsRunning(true);

  const CONCURRENCY = 3;
  let completed = 0;
  const total = targetNodes.length;
  const queue = [...targetNodes];

  async function runNext(): Promise<void> {
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) break;
      try {
        await executeNode(node, ctx);
      } catch {
        // Error already handled via toast in executeNode
      }
      completed += 1;
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () =>
    runNext(),
  );
  await Promise.all(workers);

  if (pollIntervalsRef.current.size === 0) {
    ctx.setIsRunning(false);
  }

  const finalNodes = useWorkflowStore.getState().nodes;
  const succeeded = nodeIds.filter((id) => {
    const n = finalNodes.find((node) => node.id === id);
    return (
      (n?.data as Record<string, unknown>)?.executionStatus === "completed"
    );
  }).length;

  toast.success(`Image generation complete: ${succeeded}/${total} succeeded`);
}
