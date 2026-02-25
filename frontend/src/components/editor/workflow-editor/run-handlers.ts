import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { getJobStatus, getUserCredits, getWorkflowExecution } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { hasCredits } from "@/lib/edition";
import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import { getCachedCredits } from "@/hooks/use-model-credits";
import type { WorkflowNode, GeneratedResult } from "@/types/nodes";
import {
  WorkflowStaleError,
  NODE_CREDIT_COSTS,
  isExecutableNode,
  type ExecutionContext,
} from "./types";
import { buildExecutionLevels, getEffectivelySkippedIds, collapseExpandedClones } from "./execution-graph";
import { getListInputForNode } from "./node-input-resolver";
import { executeNode, rejectAllManualEdits } from "./execute-node";
import { executeNodeForList, expandLoopResults } from "./list-execution";

/**
 * Shared level-by-level execution loop. Runs each level in parallel via
 * Promise.allSettled, stopping on real errors or stale-workflow detection.
 *
 * Returns true if any real error occurred, false otherwise.
 */
async function executeLevels(
  levels: WorkflowNode[][],
  skippedIds: Set<string>,
  ctx: ExecutionContext,
): Promise<boolean> {
  let failed = false;
  for (const level of levels) {
    if (failed) break;

    const toRun = level.filter(
      (n) => isExecutableNode(n) && !skippedIds.has(n.id),
    );
    if (toRun.length === 0) continue;

    const results = await Promise.allSettled(
      toRun.map((node) => {
        const { nodes: currentNodes, edges: currentEdges } =
          useWorkflowStore.getState();
        const listItems = getListInputForNode(
          node,
          currentNodes,
          currentEdges,
        );
        if (!listItems || listItems.length <= 1) {
          return executeNode(node, ctx);
        }
        return executeNodeForList(node, listItems, ctx);
      }),
    );

    const hasRealError = results.some(
      (r) =>
        r.status === "rejected" && !(r.reason instanceof WorkflowStaleError),
    );
    const hasStaleError = results.some(
      (r) =>
        r.status === "rejected" && r.reason instanceof WorkflowStaleError,
    );
    if (hasStaleError) break;
    if (hasRealError) {
      failed = true;
    }
  }
  return failed;
}

/**
 * Mark skipped nodes and build execution levels from a subgraph.
 * Returns { levels, skippedIds }.
 */
function prepareExecution(
  nodes: WorkflowNode[],
  edges: ReturnType<typeof useWorkflowStore.getState>["edges"],
): { levels: WorkflowNode[][]; skippedIds: Set<string> } {
  const levels = buildExecutionLevels(nodes, edges);
  const skippedIds = getEffectivelySkippedIds(nodes, edges);

  for (const id of skippedIds) {
    useWorkflowStore
      .getState()
      .updateNodeData(id, { executionStatus: "skipped" });
  }

  return { levels, skippedIds };
}

// ---------------------------------------------------------------------------
// handleRun
// ---------------------------------------------------------------------------

export async function handleRun(
  ctx: ExecutionContext,
  projectId: string | undefined,
  save: (pid: string) => Promise<unknown>,
  setIsRunning: (v: boolean) => void,
  pollIntervalsRef: MutableRefObject<Set<ReturnType<typeof setInterval>>>,
): Promise<void> {
  rejectAllManualEdits();
  const { nodes, edges } = collapseExpandedClones();

  const executableNodes = nodes.filter(isExecutableNode);
  if (executableNodes.length === 0) {
    toast.error(
      "No executable nodes found. Add Generate Image, Image to Video, or Video to Video nodes.",
    );
    return;
  }

  if (projectId) {
    await save(projectId);
  }

  // Credit check (cloud edition only)
  if (hasCredits()) {
    try {
      const supabase = createClient();
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (authUser) {
        const balance = await queryClient.fetchQuery({
          queryKey: queryKeys.credits.balance(authUser.id),
          queryFn: async () => {
            const result = await getUserCredits(authUser.id);
            return (
              result.data ??
              (result as unknown as { total: number; tier: string })
            );
          },
          staleTime: 10_000,
        });
        const estimatedCost = executableNodes.reduce((sum, node) => {
          const data = node.data as Record<string, unknown>;
          const provider = data.provider as string | undefined;
          if (provider) {
            const cached = getCachedCredits(provider);
            if (cached !== undefined) return sum + cached;
          }
          return sum + (NODE_CREDIT_COSTS[node.type ?? ""] ?? 1);
        }, 0);
        if (balance.total < estimatedCost) {
          ctx.setInsufficientCreditsData({
            required: estimatedCost,
            available: balance.total,
            tier: balance.tier,
          });
          ctx.setShowInsufficientCredits(true);
          return;
        }
      }
    } catch {
      // Credit check failed -- proceed anyway
    }
  }

  const { levels, skippedIds } = prepareExecution(nodes, edges);

  setIsRunning(true);
  toast.info("Executing workflow...", {
    description: `${executableNodes.length} node(s) to run`,
  });

  const failed = await executeLevels(levels, skippedIds, ctx);

  if (pollIntervalsRef.current.size === 0) {
    setIsRunning(false);
  }

  if (failed) {
    toast.error("Workflow execution stopped due to errors");
  } else if (!ctx.isWorkflowStale()) {
    toast.success("Workflow execution complete");
    expandLoopResults();
  }
}

// ---------------------------------------------------------------------------
// handleRunSingleNode
// ---------------------------------------------------------------------------

export async function handleRunSingleNode(
  nodeId: string,
  ctx: ExecutionContext,
  projectId: string | undefined,
  save: (pid: string) => Promise<unknown>,
  setIsRunning: (v: boolean) => void,
  pollIntervalsRef: MutableRefObject<Set<ReturnType<typeof setInterval>>>,
): Promise<void> {
  const { nodes, edges } = useWorkflowStore.getState();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;

  if (!isExecutableNode(node)) {
    toast.error("This node type cannot be run individually.");
    return;
  }

  if (projectId) {
    await save(projectId);
  }

  setIsRunning(true);
  const { nodes: currentNodes, edges: currentEdges } =
    useWorkflowStore.getState();
  const listItems = getListInputForNode(node, currentNodes, currentEdges);

  const execution =
    listItems && listItems.length > 1
      ? executeNodeForList(node, listItems, ctx)
      : executeNode(node, ctx);

  execution
    .catch(() => {
      // Error already handled via toast in executeNode
    })
    .finally(() => {
      if (pollIntervalsRef.current.size === 0) {
        setIsRunning(false);
      }
    });
}

// ---------------------------------------------------------------------------
// handleRunFromHere
// ---------------------------------------------------------------------------

export async function handleRunFromHere(
  nodeId: string,
  ctx: ExecutionContext,
  projectId: string | undefined,
  save: (pid: string) => Promise<unknown>,
  setIsRunning: (v: boolean) => void,
  pollIntervalsRef: MutableRefObject<Set<ReturnType<typeof setInterval>>>,
): Promise<void> {
  rejectAllManualEdits();
  const { nodes, edges } = collapseExpandedClones();
  const startNode = nodes.find((n) => n.id === nodeId);
  if (!startNode) return;

  if (projectId) {
    await save(projectId);
  }

  // BFS forward to collect all downstream node IDs
  const downstream = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === current && !downstream.has(edge.target)) {
        downstream.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  const subgraphNodes = nodes.filter((n) => downstream.has(n.id));
  const subgraphEdges = edges.filter(
    (e) => downstream.has(e.source) && downstream.has(e.target),
  );

  const executableCount = subgraphNodes.filter(isExecutableNode).length;
  if (executableCount === 0) {
    toast.error("No executable nodes found downstream.");
    return;
  }

  const { levels, skippedIds } = prepareExecution(subgraphNodes, subgraphEdges);

  setIsRunning(true);
  toast.info("Running from here...", {
    description: `${executableCount} node(s) to run`,
  });

  const failed = await executeLevels(levels, skippedIds, ctx);

  if (pollIntervalsRef.current.size === 0) {
    setIsRunning(false);
  }

  if (failed) {
    toast.error("Run from here stopped due to errors");
  } else if (!ctx.isWorkflowStale()) {
    toast.success("Run from here complete");
    expandLoopResults();
  }
}

// ---------------------------------------------------------------------------
// handleRunSelected
// ---------------------------------------------------------------------------

export async function handleRunSelected(
  ctx: ExecutionContext,
  projectId: string | undefined,
  save: (pid: string) => Promise<unknown>,
  setIsRunning: (v: boolean) => void,
  pollIntervalsRef: MutableRefObject<Set<ReturnType<typeof setInterval>>>,
): Promise<void> {
  rejectAllManualEdits();
  const { nodes, edges } = collapseExpandedClones();
  const selectedNodes = nodes.filter((n) => n.selected);
  if (selectedNodes.length === 0) {
    toast.error("No nodes selected.");
    return;
  }

  if (projectId) {
    await save(projectId);
  }

  const selectedIds = new Set(selectedNodes.map((n) => n.id));
  const subgraphEdges = edges.filter(
    (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
  );

  const executableCount = selectedNodes.filter(isExecutableNode).length;
  if (executableCount === 0) {
    toast.error("No executable nodes in selection.");
    return;
  }

  const { levels, skippedIds } = prepareExecution(selectedNodes, subgraphEdges);

  setIsRunning(true);
  toast.info("Running selected nodes...", {
    description: `${executableCount} node(s) to run`,
  });

  const failed = await executeLevels(levels, skippedIds, ctx);

  if (pollIntervalsRef.current.size === 0) {
    setIsRunning(false);
  }

  if (failed) {
    toast.error("Run selected stopped due to errors");
  } else if (!ctx.isWorkflowStale()) {
    toast.success("Run selected complete");
    expandLoopResults();
  }
}

// ---------------------------------------------------------------------------
// Restore polling for jobs still running on the backend after page refresh
// ---------------------------------------------------------------------------

export function restorePollingForRunningJobs(
  runningJobs: ReadonlyArray<{
    nodeId: string;
    jobId: string;
    nodeType: string;
  }>,
  ctx: ExecutionContext,
  setIsRunning: (v: boolean) => void,
): void {
  if (runningJobs.length === 0) return;

  setIsRunning(true);

  const { updateNodeData } = useWorkflowStore.getState();

  for (const { nodeId, jobId, nodeType } of runningJobs) {
    let pollFailures = 0;
    const poll = ctx.trackInterval(
      setInterval(async () => {
        if (ctx.isWorkflowStale()) {
          ctx.untrackInterval(poll);
          return;
        }

        const node = useWorkflowStore
          .getState()
          .nodes.find((n) => n.id === nodeId);
        if (!node) {
          ctx.untrackInterval(poll);
          return;
        }

        try {
          const job = await getJobStatus(jobId);
          pollFailures = 0;

          if (job.progress != null && job.progress > 0) {
            updateNodeData(nodeId, { currentJobProgress: job.progress });
          }

          if (job.status === "completed") {
            ctx.untrackInterval(poll);
            applyRestoredJobCompletion(nodeId, nodeType, job, jobId);
          } else if (job.status === "failed") {
            ctx.untrackInterval(poll);
            const errMsg = job.error_message ?? "Unknown error";
            updateNodeData(nodeId, {
              executionStatus: "failed",
              errorMessage: errMsg,
              currentJobId: undefined,
              currentJobProgress: undefined,
            });
            toast.error("Job failed", { description: errMsg });
          } else if (job.status === "cancelled") {
            ctx.untrackInterval(poll);
            updateNodeData(nodeId, {
              executionStatus: "idle",
              currentJobId: undefined,
              currentJobProgress: undefined,
            });
          }
        } catch {
          pollFailures++;
          if (pollFailures >= 5) {
            ctx.untrackInterval(poll);
            updateNodeData(nodeId, {
              executionStatus: "failed",
              currentJobId: undefined,
              currentJobProgress: undefined,
            });
          }
        }
      }, 3000),
    );
  }
}

function applyRestoredJobCompletion(
  nodeId: string,
  nodeType: string,
  job: {
    output_data?: {
      imageUrl?: string;
      videoUrl?: string;
      audioUrl?: string;
      script?: unknown;
      [key: string]: unknown;
    };
  },
  jobId: string,
): void {
  const { updateNodeData } = useWorkflowStore.getState();
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
  const existingResults = ((node?.data as Record<string, unknown> | undefined)
    ?.generatedResults ?? []) as GeneratedResult[];

  const outputUrl =
    job.output_data?.imageUrl ??
    job.output_data?.videoUrl ??
    job.output_data?.audioUrl;
  const newResult: GeneratedResult = {
    url: (outputUrl as string) ?? "",
    timestamp: new Date().toISOString(),
    jobId,
  };

  const updates: Record<string, unknown> = {
    executionStatus: "completed",
    generatedResults: [newResult, ...existingResults],
    activeResultIndex: 0,
    currentJobId: undefined,
    currentJobProgress: undefined,
  };

  if (job.output_data?.imageUrl) {
    if (["character", "face", "object", "location"].includes(nodeType)) {
      updates.sourceImageUrl = job.output_data.imageUrl;
    } else {
      updates.generatedImageUrl = job.output_data.imageUrl;
    }
  } else if (job.output_data?.videoUrl) {
    updates.generatedVideoUrl = job.output_data.videoUrl;
  } else if (job.output_data?.audioUrl) {
    updates.generatedAudioUrl = job.output_data.audioUrl;
  } else if (job.output_data?.script) {
    updates.generatedScript = job.output_data.script;
  }

  updateNodeData(nodeId, updates);
  toast.success("Background job completed");
}

// ---------------------------------------------------------------------------
// Poll an active backend orchestrator execution and sync node states
// ---------------------------------------------------------------------------

interface NodeExecutionState {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  output?: {
    imageUrl?: string;
    videoUrl?: string;
    audioUrl?: string;
    text?: string;
    script?: unknown;
    generatedVoiceId?: string;
    alignment?: unknown;
    vocalUrl?: string;
    instrumentalUrl?: string;
    splitResults?: string[];
    combinedText?: string;
  };
  error?: string;
}

export function restorePollingForBackendExecution(
  executionId: string,
  ctx: ExecutionContext,
  setIsRunning: (v: boolean) => void,
): void {
  setIsRunning(true);
  let pollFailures = 0;

  const poll = ctx.trackInterval(
    setInterval(async () => {
      if (ctx.isWorkflowStale()) {
        ctx.untrackInterval(poll);
        return;
      }

      try {
        const exec = await getWorkflowExecution(executionId);
        pollFailures = 0;

        const nodeStates = (exec.nodeStates ?? {}) as Record<
          string,
          NodeExecutionState
        >;
        const { nodes, updateNodeData } = useWorkflowStore.getState();

        // Sync per-node states
        for (const node of nodes) {
          const state = nodeStates[node.id];
          if (!state) continue;

          const data = node.data as Record<string, unknown>;
          const currentStatus = data.executionStatus as string | undefined;

          // Only update if status actually changed
          if (state.status === "completed" && currentStatus !== "completed") {
            const updates: Record<string, unknown> = {
              executionStatus: "completed",
            };
            if (state.output) {
              const nodeType = node.type ?? "";
              if (state.output.imageUrl) {
                if (
                  ["character", "face", "object", "location"].includes(nodeType)
                ) {
                  updates.sourceImageUrl = state.output.imageUrl;
                } else {
                  updates.generatedImageUrl = state.output.imageUrl;
                }
              }
              if (state.output.videoUrl)
                updates.generatedVideoUrl = state.output.videoUrl;
              if (state.output.audioUrl)
                updates.generatedAudioUrl = state.output.audioUrl;
              if (state.output.script)
                updates.generatedScript = state.output.script;
              if (state.output.generatedVoiceId)
                updates.generatedVoiceId = state.output.generatedVoiceId;
              if (state.output.vocalUrl)
                updates.generatedVocalUrl = state.output.vocalUrl;
              if (state.output.instrumentalUrl)
                updates.generatedInstrumentalUrl =
                  state.output.instrumentalUrl;
              if (state.output.alignment)
                updates.generatedAlignment = state.output.alignment;
              if (state.output.combinedText)
                updates.generatedText = state.output.combinedText;
              if (state.output.splitResults)
                updates.generatedSplitResults = state.output.splitResults;

              const outputUrl =
                state.output.imageUrl ??
                state.output.videoUrl ??
                state.output.audioUrl;
              if (outputUrl) {
                const prev = (data.generatedResults ?? []) as GeneratedResult[];
                const alreadyHas = prev.some((r) => r.url === outputUrl);
                if (!alreadyHas) {
                  updates.generatedResults = [
                    {
                      url: outputUrl,
                      timestamp: new Date().toISOString(),
                      jobId: `exec-${node.id}`,
                    },
                    ...prev,
                  ];
                  updates.activeResultIndex = 0;
                }
              }
            }
            updateNodeData(node.id, updates);
          } else if (
            state.status === "running" &&
            currentStatus !== "running"
          ) {
            updateNodeData(node.id, { executionStatus: "running" });
          } else if (
            state.status === "pending" &&
            currentStatus !== "pending" &&
            currentStatus !== "running" &&
            currentStatus !== "completed"
          ) {
            updateNodeData(node.id, { executionStatus: "pending" });
          } else if (
            state.status === "failed" &&
            currentStatus !== "failed"
          ) {
            updateNodeData(node.id, {
              executionStatus: "failed",
              errorMessage: state.error ?? "Node failed",
            });
          }
        }

        // Check if the entire execution is done
        if (
          exec.status === "completed" ||
          exec.status === "failed" ||
          exec.status === "cancelled" ||
          exec.status === "timed_out"
        ) {
          ctx.untrackInterval(poll);
          if (exec.status === "completed") {
            toast.success("Backend execution completed");
          } else if (exec.status === "failed") {
            toast.error("Backend execution failed", {
              description: exec.errorMessage,
            });
          } else if (exec.status === "cancelled") {
            toast.info("Backend execution cancelled");
          } else {
            toast.error("Backend execution timed out");
          }
        }
      } catch {
        pollFailures++;
        if (pollFailures >= 5) {
          ctx.untrackInterval(poll);
          toast.error("Lost connection to backend execution");
        }
      }
    }, 3000),
  );
}
