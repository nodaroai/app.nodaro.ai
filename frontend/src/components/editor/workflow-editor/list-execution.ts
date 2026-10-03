import { useWorkflowStore } from "@/hooks/use-workflow-store";
import type {
  GeneratedResult,
  WorkflowNode,
  SceneNodeDataType,
} from "@/types/nodes";
import { getCachedTier } from "@/hooks/use-auth";
import { TIER_PARALLELISM } from "@/lib/pricing-data";
import { hasCredits } from "@/lib/edition";
import { executeNode } from "./execute-node";
import type { ExecutionContext } from "./types";
import { REPEAT_PLACEHOLDER, decodeProviderItem, settledWithLimit, fanOutTextFeedsPrompt, isFanOutUrlItem, type FanOutPlan } from "@nodaro/shared"
import { setSuppressToasts, RUN_START_RESET } from "./poll-job";

/**
 * What one failed item says, for the node's summary: its error's own words.
 * Nothing for an item stopped because another failed first (the batch
 * cancels the rest), so the summary names the failure that mattered.
 */
function failureReason(reason: unknown): string | undefined {
  const message = reason instanceof Error ? reason.message.trim() : "";
  return message && message !== "Cancelled" && message !== "Execution cancelled" ? message : undefined;
}

/**
 * Execute a node once for each item in the list. Results are accumulated
 * and stored as __listResults on the node for later clone expansion.
 *
 * `fanOut` is the rest of the plan (`planFanOut`): the ROW every iteration
 * reads its inputs on, and the handle the driving list is wired to. A text list
 * that drives through a handle the resolver routes elsewhere (`negative`,
 * `system-prompt`) is NOT a prompt — the per-row resolution already delivered
 * it to its own input, and passing it as the prompt override too generated
 * every image FROM the negative text. Omitted (repeat-only / provider-only /
 * direct callers) = the item is a prompt and the row is the iteration, as before.
 */
export async function executeNodeForList(
  node: WorkflowNode,
  items: string[],
  ctx: ExecutionContext,
  fanOut?: Pick<FanOutPlan, "rows" | "targetHandle">,
): Promise<void> {
  const MAX_PARALLEL_ITERATIONS = hasCredits()
    ? (TIER_PARALLELISM[getCachedTier()] ?? TIER_PARALLELISM.free)
    : 12;

  const { updateNodeData } = useWorkflowStore.getState();
  const runId = crypto.randomUUID();

  // Snapshot prior history before we clear it on the next line; re-appended
  // after the fan-out settles so prior runs aren't lost.
  const priorData = useWorkflowStore.getState().nodes.find((n) => n.id === node.id)
    ?.data as Record<string, unknown> | undefined;
  const preBatchHistory: GeneratedResult[] =
    (priorData?.generatedResults as GeneratedResult[] | undefined) ?? [];

  updateNodeData(node.id, {
    ...RUN_START_RESET,
    generatedResults: [],
    __listTotal: items.length,
    __listCompleted: 0,
    __listResults: [],
    __listInputs: [...items],
    __currentRunId: runId,
    // Signals the abandon-guard that N iterations share this node's single
    // `currentJobId` slot, so the single-job match is meaningless — never
    // abandon mid-fan-out. Cleared in the finally below (even on throw).
    __listRunning: true,
  });

  let completedCount = 0;
  let failedCount = 0;
  const cancelRef = { cancelled: false };

  const tasks = items.map((item, i) => async () => {
    if (ctx.isWorkflowStale() || cancelRef.cancelled) {
      throw new Error("Cancelled");
    }

    const freshNode = useWorkflowStore
      .getState()
      .nodes.find((n) => n.id === node.id);
    if (!freshNode) throw new Error("Node removed");

    const providerOverride = decodeProviderItem(item);
    // An empty driving cell (a row another column keeps alive) overrides nothing.
    const isRepeat = providerOverride !== undefined || item === REPEAT_PLACEHOLDER || item.trim().length === 0;
    const isUrl = !isRepeat && isFanOutUrlItem(item);
    const isPrompt = !isRepeat && !isUrl && (!fanOut || fanOutTextFeedsPrompt(node.type, fanOut.targetHandle));
    const listRowIndex = fanOut?.rows[i];

    // For provider-fanout iterations, swap data.provider for this run only.
    // The clone is shallow on data; the original store node is untouched.
    const iterationNode: WorkflowNode = providerOverride
      ? { ...freshNode, data: { ...freshNode.data, provider: providerOverride } }
      : freshNode;

    // executeNode now returns the output string directly. `i` stays the
    // iteration's identity; the inputs are resolved on the iteration's ROW,
    // passed as its own argument (NOT on ctx — ctx flows into everything the
    // node executes, e.g. the children of a Sub-Workflow, and the row must not).
    // Without a row (repeat-only / provider-only runs, direct callers) the call
    // is exactly what it has always been.
    const prompt = isPrompt ? item : undefined;
    const mediaUrl = isUrl ? item : undefined;
    const result = await (listRowIndex === undefined
      ? executeNode(iterationNode, ctx, prompt, mediaUrl, i, runId)
      : executeNode(iterationNode, ctx, prompt, mediaUrl, i, runId, undefined, listRowIndex));

    completedCount++;
    useWorkflowStore.getState().updateNodeData(node.id, {
      __listCompleted: completedCount + failedCount,
    });

    return { index: i, value: result || "" };
  });

  setSuppressToasts(true);
  try {
    const settled = await settledWithLimit(
      tasks,
      MAX_PARALLEL_ITERATIONS,
      cancelRef,
    );

    // Assemble results in original index order
    const results: string[] = new Array(items.length).fill("");
    // Toasts are muted for the batch, so the node's summary has to say why.
    let firstReason: string | undefined;
    for (const entry of settled) {
      if (entry.status === "fulfilled") {
        results[entry.value.index] = entry.value.value;
      } else {
        failedCount++;
        firstReason ??= failureReason(entry.reason);
        // Cancel remaining on first non-cancellation failure
        if (!cancelRef.cancelled) {
          cancelRef.cancelled = true;
        }
      }
    }

    // poll-job.ts prepends each iteration in completion order during fan-out.
    // The final write below overwrites that with list-index order.
    const batchTimestamp = new Date().toISOString();
    const batchResults: GeneratedResult[] = results
      .map((url, i) =>
        url
          ? {
              url,
              timestamp: batchTimestamp,
              jobId: `iter-${runId}-${i}`,
            }
          : null,
      )
      .filter((r): r is GeneratedResult => r !== null);

    useWorkflowStore.getState().updateNodeData(node.id, {
      executionStatus: failedCount === items.length ? "failed" : "completed",
      __listTotal: items.length,
      __listCompleted: completedCount + failedCount,
      __listResults: results,
      __listInputs: [...items],
      generatedResults: [...batchResults, ...preBatchHistory],
      activeResultIndex: 0,
      // Fan-out window closes atomically with the terminal status write, so the
      // abandon-guard resumes normal single-job matching the moment the batch
      // settles. (The finally below is a defensive backstop for the throw path.)
      __listRunning: false,
      errorMessage:
        failedCount > 0
          ? `${completedCount}/${items.length} succeeded, ${failedCount} failed${firstReason ? ` — ${firstReason}` : ""}`
          : undefined,
    });
  } finally {
    setSuppressToasts(false);
    // Backstop: if the try threw before the terminal write above (e.g. an
    // unexpected error mid-assembly), the fan-out flag could still be `true`.
    // Clear it only in that case so a normal success/fail run doesn't emit a
    // redundant trailing write (which would also displace the terminal-status
    // write as the "last" call other code/tests rely on).
    const stillRunning = (
      useWorkflowStore.getState().nodes.find((n) => n.id === node.id)
        ?.data as Record<string, unknown> | undefined
    )?.__listRunning;
    if (stillRunning) {
      useWorkflowStore.getState().updateNodeData(node.id, { __listRunning: false });
    }
  }
}

// --- Post-execution: expand loop results into separate pipelines ---

const VIDEO_TYPES = new Set([
  "image-to-video",
  "video-to-video",
  "text-to-video",
  "generate-video",
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
  "audio-isolation",
  "text-to-dialogue",
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
  const LIST_SOURCE_TYPES = new Set(["split-text", "list"]);
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
