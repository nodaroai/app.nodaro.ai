import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { getJobStatus, getUserCredits, getWorkflowExecution, runWorkflow, streamWorkflowExecution, WorkflowAlreadyRunningError } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { hasCredits } from "@/lib/edition";
import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import { getCachedCredits } from "@/hooks/use-model-credits";
import { getModelIdentifier } from "@/components/editor/config-panels/helpers";
import type { GeneratedResult } from "@/types/nodes";
import {
  NODE_CREDIT_COSTS,
  MAX_CONSECUTIVE_POLL_FAILURES,
  isExecutableNode,
  getFanOutMultiplier,
  type ExecutionContext,
} from "./types";
import { collapseExpandedClones } from "./execution-graph";
import { getListInputForNode } from "./node-input-resolver";
import { executeNode, rejectAllManualEdits } from "./execute-node";
import { executeNodeForList } from "./list-execution";

// ---------------------------------------------------------------------------
// handleRun
// ---------------------------------------------------------------------------

export async function handleRun(
  ctx: ExecutionContext,
  projectId: string | undefined,
  workflowId: string | null,
  save: (pid: string) => Promise<unknown>,
  setIsRunning: (v: boolean) => void,
  onExecutionStarted?: (id: string) => void,
  onExecutionEnded?: () => void,
): Promise<void> {
  rejectAllManualEdits();
  const { nodes } = collapseExpandedClones();

  const executableNodes = nodes.filter(isExecutableNode);
  if (executableNodes.length === 0) {
    toast.error(
      "No executable nodes found. Add Generate Image, Image to Video, or Video to Video nodes.",
    );
    return;
  }

  if (!workflowId) {
    toast.error("Save the workflow before running.");
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
        const { edges: allEdges } = useWorkflowStore.getState();
        const estimatedCost = executableNodes.reduce((sum, node) => {
          const modelId = getModelIdentifier(node);
          const cached = getCachedCredits(modelId);
          const cost = cached !== undefined ? cached : (NODE_CREDIT_COSTS[node.type ?? ""] ?? 1);
          const multiplier = getFanOutMultiplier(node, nodes, allEdges);
          return sum + cost * multiplier;
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

  // Mark all executable nodes as pending immediately for UI feedback
  const { updateNodeData } = useWorkflowStore.getState();
  for (const node of executableNodes) {
    updateNodeData(node.id, { executionStatus: "pending" });
  }

  setIsRunning(true);
  toast.info("Executing workflow...", {
    description: `${executableNodes.length} node(s) to run`,
  });

  try {
    const result = await runWorkflow(workflowId);
    onExecutionStarted?.(result.executionId);
    streamBackendExecution(result.executionId, ctx, setIsRunning, onExecutionEnded);
  } catch (err: unknown) {
    if (err instanceof WorkflowAlreadyRunningError) {
      toast.info("Workflow is already running — reattaching...");
      onExecutionStarted?.(err.executionId);
      streamBackendExecution(err.executionId, ctx, setIsRunning, onExecutionEnded);
      return;
    }
    setIsRunning(false);
    for (const node of executableNodes) {
      updateNodeData(node.id, { executionStatus: undefined });
    }
    toast.error("Failed to start workflow", {
      description: err instanceof Error ? err.message : "Unknown error",
    });
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
  onExecutionStarted?: (id: string) => void,
  onExecutionEnded?: () => void,
): Promise<void> {
  rejectAllManualEdits();
  const { nodes, edges } = collapseExpandedClones();
  const startNode = nodes.find((n) => n.id === nodeId);
  if (!startNode) return;

  const workflowId = useWorkflowStore.getState().workflowId;
  if (!workflowId) {
    toast.error("Save the workflow before running.");
    return;
  }

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

  const executableNodes = nodes.filter(
    (n) => downstream.has(n.id) && isExecutableNode(n),
  );
  if (executableNodes.length === 0) {
    toast.error("No executable nodes found downstream.");
    return;
  }

  // Mark nodes as pending for immediate UI feedback
  const { updateNodeData } = useWorkflowStore.getState();
  for (const node of executableNodes) {
    updateNodeData(node.id, { executionStatus: "pending" });
  }

  setIsRunning(true);
  toast.info("Running from here...", {
    description: `${executableNodes.length} node(s) to run`,
  });

  try {
    const result = await runWorkflow(workflowId, [...downstream]);
    onExecutionStarted?.(result.executionId);
    streamBackendExecution(result.executionId, ctx, setIsRunning, onExecutionEnded);
  } catch (err: unknown) {
    if (err instanceof WorkflowAlreadyRunningError) {
      toast.info("Workflow is already running — reattaching...");
      onExecutionStarted?.(err.executionId);
      streamBackendExecution(err.executionId, ctx, setIsRunning, onExecutionEnded);
      return;
    }
    setIsRunning(false);
    for (const node of executableNodes) {
      updateNodeData(node.id, { executionStatus: undefined });
    }
    toast.error("Failed to start execution", {
      description: err instanceof Error ? err.message : "Unknown error",
    });
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
  onExecutionStarted?: (id: string) => void,
  onExecutionEnded?: () => void,
): Promise<void> {
  rejectAllManualEdits();
  const { nodes } = collapseExpandedClones();
  const selectedNodes = nodes.filter((n) => n.selected);
  if (selectedNodes.length === 0) {
    toast.error("No nodes selected.");
    return;
  }

  const workflowId = useWorkflowStore.getState().workflowId;
  if (!workflowId) {
    toast.error("Save the workflow before running.");
    return;
  }

  if (projectId) {
    await save(projectId);
  }

  const executableNodes = selectedNodes.filter(isExecutableNode);
  if (executableNodes.length === 0) {
    toast.error("No executable nodes in selection.");
    return;
  }

  const selectedIds = selectedNodes.map((n) => n.id);

  // Mark nodes as pending for immediate UI feedback
  const { updateNodeData } = useWorkflowStore.getState();
  for (const node of executableNodes) {
    updateNodeData(node.id, { executionStatus: "pending" });
  }

  setIsRunning(true);
  toast.info("Running selected nodes...", {
    description: `${executableNodes.length} node(s) to run`,
  });

  try {
    const result = await runWorkflow(workflowId, selectedIds);
    onExecutionStarted?.(result.executionId);
    streamBackendExecution(result.executionId, ctx, setIsRunning, onExecutionEnded);
  } catch (err: unknown) {
    if (err instanceof WorkflowAlreadyRunningError) {
      toast.info("Workflow is already running — reattaching...");
      onExecutionStarted?.(err.executionId);
      streamBackendExecution(err.executionId, ctx, setIsRunning, onExecutionEnded);
      return;
    }
    setIsRunning(false);
    for (const node of executableNodes) {
      updateNodeData(node.id, { executionStatus: undefined });
    }
    toast.error("Failed to start execution", {
      description: err instanceof Error ? err.message : "Unknown error",
    });
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
          if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
            ctx.untrackInterval(poll);
            // Final verification before marking as failed
            try {
              const finalJob = await getJobStatus(jobId);
              if (finalJob.status === "completed") {
                applyRestoredJobCompletion(nodeId, nodeType, finalJob, jobId);
                return;
              }
              if (finalJob.status === "failed") {
                updateNodeData(nodeId, {
                  executionStatus: "failed",
                  errorMessage: finalJob.error_message ?? "Unknown error",
                  currentJobId: undefined,
                  currentJobProgress: undefined,
                });
                return;
              }
            } catch { /* final check also failed */ }
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
// Stream backend execution updates via SSE with parallel polling safety net.
// SSE provides near-real-time updates, but reverse proxies (Caddy, Vite)
// can buffer text/event-stream responses. Polling ensures the UI always
// updates even when SSE is silently buffered.
// ---------------------------------------------------------------------------

export function streamBackendExecution(
  executionId: string,
  ctx: ExecutionContext,
  setIsRunning: (v: boolean) => void,
  onExecutionEnded?: () => void,
): void {
  setIsRunning(true);
  const abortController = new AbortController();
  let finished = false;

  // Track the abort controller so it gets cleaned up on workflow switch
  const staleCheck = ctx.trackInterval(
    setInterval(() => {
      if (ctx.isWorkflowStale()) {
        abortController.abort();
        cleanup();
      }
    }, 5000),
  );

  // --- SSE path (best-effort real-time updates) ---
  streamWorkflowExecution(
    executionId,
    {
      onNodeStatesChanged: (nodeStates, _meta) => {
        syncNodeStatesToStore(nodeStates);
      },
      onCompleted: () => {
        if (finished) return;
        cleanup();
        toast.success("Backend execution completed");
      },
      onFailed: (data) => {
        if (finished) return;
        cleanup();
        toast.error("Backend execution failed", {
          description: (data.errorMessage as string) ?? undefined,
        });
      },
      onCancelled: () => {
        if (finished) return;
        cleanup();
        toast.info("Backend execution cancelled");
      },
    },
    abortController.signal,
  ).catch((err) => {
    if (err instanceof DOMException && err.name === "AbortError") return;
    console.warn("[SSE] Streaming connection lost, polling still active:", err);
  });

  // --- Polling safety net (runs in parallel with SSE) ---
  let pollFailures = 0;
  const pollOnce = async () => {
    if (finished || ctx.isWorkflowStale()) return;

    try {
      const exec = await getWorkflowExecution(executionId);
      pollFailures = 0;

      const nodeStates = (exec.nodeStates ?? {}) as Record<
        string,
        NodeExecutionState
      >;
      syncNodeStatesToStore(nodeStates);

      if (
        exec.status === "completed" ||
        exec.status === "failed" ||
        exec.status === "cancelled" ||
        exec.status === "timed_out"
      ) {
        if (finished) return;
        cleanup();
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
        return;
      }
    } catch {
      pollFailures++;
      if (pollFailures >= MAX_CONSECUTIVE_POLL_FAILURES && !finished) {
        // Final verification before giving up
        try {
          const finalExec = await getWorkflowExecution(executionId);
          const finalStates = (finalExec.nodeStates ?? {}) as Record<string, NodeExecutionState>;
          syncNodeStatesToStore(finalStates);
          if (finalExec.status === "completed") {
            cleanup();
            toast.success("Backend execution completed");
            return;
          }
          if (finalExec.status === "failed") {
            cleanup();
            toast.error("Backend execution failed", { description: finalExec.errorMessage });
            return;
          }
          if (finalExec.status === "cancelled") {
            cleanup();
            toast.info("Backend execution cancelled");
            return;
          }
        } catch { /* final check also failed */ }
        cleanup();
        toast.error("Lost connection to backend execution");
        return;
      }
    }
  };

  // First poll after 1s, then every 3s
  const pollTimeout1 = setTimeout(() => {
    if (finished) return;
    pollOnce();
  }, 1000);
  const pollInterval = ctx.trackInterval(
    setInterval(() => {
      if (!finished) pollOnce();
    }, 3000),
  );

  function cleanup() {
    if (finished) return;
    finished = true;
    abortController.abort();
    clearTimeout(pollTimeout1);
    ctx.untrackInterval(staleCheck);
    ctx.untrackInterval(pollInterval);
    onExecutionEnded?.();
  }
}

// ---------------------------------------------------------------------------
// Poll an active backend orchestrator execution and sync node states
// (kept as fallback when SSE is unavailable)
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
    listResults?: string[];
  };
  error?: string;
}

/** Sync a nodeStates snapshot from the backend into the Zustand store. */
function syncNodeStatesToStore(
  nodeStates: Record<string, NodeExecutionState>,
): void {
  const { nodes, updateNodeData } = useWorkflowStore.getState();

  for (const node of nodes) {
    const state = nodeStates[node.id];
    if (!state) continue;

    const data = node.data as Record<string, unknown>;
    const currentStatus = data.executionStatus as string | undefined;

    // Also re-sync results when node is already completed but generatedResults
    // is empty/missing (e.g. polling caught the completed status before output
    // was persisted, then the full output arrived in a later poll/SSE event).
    const needsResultSync =
      state.status === "completed" &&
      currentStatus === "completed" &&
      state.output?.listResults &&
      state.output.listResults.length > 1 &&
      !((data.generatedResults as GeneratedResult[] | undefined)?.length);

    if (
      (state.status === "completed" && currentStatus !== "completed") ||
      needsResultSync
    ) {
      const updates: Record<string, unknown> = {
        executionStatus: "completed",
      };
      if (state.output) {
        const nodeType = node.type ?? "";
        if (state.output.imageUrl) {
          if (["character", "face", "object", "location"].includes(nodeType)) {
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
          updates.generatedInstrumentalUrl = state.output.instrumentalUrl;
        if (state.output.alignment)
          updates.generatedAlignment = state.output.alignment;
        if (state.output.combinedText)
          updates.generatedText = state.output.combinedText;
        if (state.output.splitResults)
          updates.generatedSplitResults = state.output.splitResults;
        // Sync fan-out list results so frontend resolveNodeInputs can use item:N
        if (state.output.listResults && state.output.listResults.length > 0) {
          updates.__listResults = state.output.listResults;
          updates.__listTotal = state.output.listResults.length;
          updates.__listCompleted = state.output.listResults.length;
        }

        // Add generated results — for fan-out nodes, include ALL list results
        const listResultUrls = (state.output.listResults ?? []).filter(
          (u) => u && u.startsWith("http"),
        );
        const prev = (data.generatedResults ?? []) as GeneratedResult[];
        const existingUrls = new Set(prev.map((r) => r.url));

        if (listResultUrls.length > 1) {
          const newResults = listResultUrls
            .filter((url) => !existingUrls.has(url))
            .map((url, i) => ({
              url,
              timestamp: new Date().toISOString(),
              jobId: `exec-${node.id}-${i}`,
            }));
          if (newResults.length > 0) {
            updates.generatedResults = [...newResults, ...prev];
            updates.activeResultIndex = 0;
          }
        } else {
          const outputUrl =
            state.output.imageUrl ??
            state.output.videoUrl ??
            state.output.audioUrl;
          if (outputUrl && !existingUrls.has(outputUrl)) {
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
    } else if (state.status === "running" && currentStatus !== "running") {
      updateNodeData(node.id, { executionStatus: "running" });
    } else if (
      state.status === "pending" &&
      currentStatus !== "pending" &&
      currentStatus !== "running" &&
      currentStatus !== "completed"
    ) {
      updateNodeData(node.id, { executionStatus: "pending" });
    } else if (state.status === "failed" && currentStatus !== "failed") {
      updateNodeData(node.id, {
        executionStatus: "failed",
        errorMessage: state.error ?? "Node failed",
      });
    }
  }
}

