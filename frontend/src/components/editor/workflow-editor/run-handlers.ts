import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { getJobStatus, getUserCredits, getWorkflowExecution, runWorkflow, streamWorkflowExecution, WorkflowAlreadyRunningError, withDedupRaceRetry } from "@/lib/api";
import { generateIdempotencyKey } from "@/lib/idempotency-key";
import { createClient } from "@/lib/supabase";
import { hasCredits } from "@/lib/edition";
import { setSkipUndoCapture } from "@/hooks/undo-flags";
import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import { getCachedCredits } from "@/ee/hooks/use-model-credits";
import { getModelIdentifier } from "@/components/editor/config-panels/helpers";
import type { GeneratedResult, WorkflowNode } from "@/types/nodes";
import {
  NODE_CREDIT_COSTS,
  MAX_CONSECUTIVE_POLL_FAILURES,
  isExecutableNode,
  getFanOutMultiplier,
  type ExecutionContext,
} from "./types";
import { COMPOSER_PLAN_MAP } from "@nodaro/shared";
import { expandItemsWithRepeat } from "@nodaro/shared";
import { collapseExpandedClones } from "./execution-graph";
import { getListInputForNode } from "./node-input-resolver";
import { executeNode, rejectAllManualEdits } from "./execute-node";
import { executeNodeForList } from "./list-execution";
import { cascadeAutoExecute } from "./auto-execute";
import { buildVariantResults } from "./variant-results";

function warnUnderMinRows(nodes: WorkflowNode[]): void {
  const underMin = nodes.filter((n) => {
    if (n.type !== "loop" && n.type !== "list") return false
    const data = n.data as Record<string, unknown>
    const minRows = (data.minRows as number) ?? 0
    if (minRows === 0) return false
    const rows = (data.rows as string[][]) ?? []
    return rows.length < minRows
  })
  if (underMin.length === 0) return
  const names = underMin.map((n) => {
    const label = (n.data as Record<string, unknown>).label as string || "Table"
    const minRows = ((n.data as Record<string, unknown>).minRows as number) ?? 0
    return `${label} (needs ${minRows}+ rows)`
  })
  toast.warning(`Under minimum rows: ${names.join(", ")}`)
}

/**
 * Reset persisted `rows` on list/loop nodes whose columns are driven by
 * upstream connections, so each execution starts from a clean slate and
 * doesn't display rows left over from a previous run.
 *
 * Only clears nodes where at least one column has `connectedSourceId` —
 * fully-manual tables keep their user-entered rows untouched. Within a
 * connected node we also preserve cell values in any column that was still
 * manual (no `connectedSourceId`) so mixed tables don't lose unrelated data.
 *
 * This is the persistence-side complement to the live `connectedRows` memo
 * used for display: without clearing, a saved workflow would carry stale
 * cells in connected columns across runs and show them briefly (or durably,
 * if the upstream disconnects) as leftover data.
 */
type ListLoopColumn = {
  handleId: string
  connectedSourceId?: string
  [key: string]: unknown
}

/**
 * Fields that accumulate output across runs. `syncNodeStatesToStore` and
 * `applyRestoredJobCompletion` both prepend new results to `generatedResults`
 * (`[...newResults, ...prev]`) — fine for a single node's history browser,
 * but downstream list/loop/preview consumers read via
 * `extractAllGeneratedResults` and see every prior run's items too. Without
 * clearing at run start, running the same workflow twice makes the list
 * display grow: 3 items after run 1, 6 after run 2, 9 after run 3…
 *
 * `listResults` / `__listResults` are replaced (not appended) by the fan-out
 * and inline executors, but clearing them pre-run prevents a stale flash
 * while the new run is still populating. `activeResultIndex` is reset to 0
 * to stay consistent with the emptied `generatedResults`.
 */
const HISTORY_FIELDS: ReadonlyArray<string> = [
  "generatedResults",
  "activeResultIndex",
]

const LIST_STATE_FIELDS: ReadonlyArray<string> = [
  "__listResults",
  "__listTotal",
  "__listCompleted",
  "__listInputs",
  "listResults",
]

const ACCUMULATION_FIELDS_TO_CLEAR: ReadonlyArray<string> = [
  ...HISTORY_FIELDS,
  ...LIST_STATE_FIELDS,
]

/**
 * Reset per-run output state on every executable node in `nodes`. Source
 * nodes (text-prompt, upload-*, triggers, list, loop) are skipped via the
 * `isExecutableNode` filter — their data is user-provided and must persist.
 *
 * Each cleared field is only patched when present, so fresh nodes with no
 * prior state don't take a pointless store write (and don't register as
 * dirty for the auto-save).
 *
 * `options.preserveHistory` keeps `generatedResults` and `activeResultIndex`
 * intact — used by single-node re-runs so the node's own history browser
 * accumulates new takes instead of wiping prior results. Transient list-state
 * fields are still cleared to avoid stale list badges.
 */
export function resetNodeAccumulation(
  nodes: ReadonlyArray<WorkflowNode>,
  options: { preserveHistory?: boolean } = {},
): void {
  const { updateNodeData } = useWorkflowStore.getState()
  const fields = options.preserveHistory ? LIST_STATE_FIELDS : ACCUMULATION_FIELDS_TO_CLEAR
  for (const node of nodes) {
    if (!isExecutableNode(node)) continue
    const data = node.data as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const key of fields) {
      if (data[key] === undefined) continue
      if (key === "generatedResults") {
        if (Array.isArray(data[key]) && (data[key] as unknown[]).length === 0) continue
        patch[key] = []
      } else if (key === "activeResultIndex") {
        if (data[key] === 0) continue
        patch[key] = 0
      } else {
        patch[key] = undefined
      }
    }
    if (Object.keys(patch).length > 0) {
      updateNodeData(node.id, patch)
    }
  }
}

export function clearConnectedListRows(nodes: WorkflowNode[]): void {
  const { updateNodeData } = useWorkflowStore.getState()
  for (const node of nodes) {
    if (node.type !== "list" && node.type !== "loop") continue
    const data = node.data as Record<string, unknown>
    const columns = (data.columns as ListLoopColumn[] | undefined) ?? []
    if (columns.length === 0) continue
    const connectedIdxs = columns
      .map((c, i) => (c.connectedSourceId ? i : -1))
      .filter((i) => i >= 0)
    if (connectedIdxs.length === 0) continue

    const existingRows = (data.rows as string[][] | undefined) ?? []
    const connectedSet = new Set(connectedIdxs)
    // Reset only connected cells; leave manual columns alone so mixed tables
    // don't lose user input when a sibling column is wired to upstream.
    const clearedRows = existingRows.map((row) =>
      row.map((cell, ci) => (connectedSet.has(ci) ? "" : cell)),
    )
    // If every column is connected, collapse to a single empty row so the
    // live upstream resolver drives row count from scratch.
    const allConnected = connectedIdxs.length === columns.length
    const nextRows = allConnected ? [columns.map(() => "")] : clearedRows
    updateNodeData(node.id, { rows: nextRows })
  }
}

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
  warnUnderMinRows(nodes);
  clearConnectedListRows(nodes);

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

  // Reset accumulated output so downstream list/preview nodes reflect only
  // this run — mirrors the per-run clear the backend orchestrator applies
  // via list-execution.ts:42.
  resetNodeAccumulation(executableNodes);

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
    // One key per click of the Run button. Reused across any retries of
    // THIS click; a fresh key is generated next time the user clicks. The
    // backend's DB UNIQUE constraint on (user_id, idempotency_key) ensures
    // React StrictMode / network retry can't create a duplicate execution.
    const idempotencyKey = generateIdempotencyKey();
    const result = await withDedupRaceRetry(() => runWorkflow(workflowId, undefined, idempotencyKey));
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

  clearConnectedListRows(nodes);
  resetNodeAccumulation([node], { preserveHistory: true });

  if (projectId) {
    await save(projectId);
  }

  setIsRunning(true);
  const { nodes: currentNodes, edges: currentEdges } =
    useWorkflowStore.getState();
  const listItems = getListInputForNode(node, currentNodes, currentEdges);
  const expanded = expandItemsWithRepeat(listItems, node.type ?? "", node.data as Record<string, unknown>);

  // One key per click of Run-on-this-node. Reused by all retries inside
  // this execution (network-level retry, browser fetch retry); fan-out
  // iterations add a per-index suffix in iterationIdempotencyKey() so
  // each iteration is its own row. Mutates `ctx` deliberately — every
  // run* wrapper down the tree reads ctx.idempotencyKey.
  ctx.idempotencyKey = generateIdempotencyKey();

  const execution = expanded
    ? executeNodeForList(node, expanded, ctx)
    : executeNode(node, ctx);

  execution
    .then(() => {
      // Cascade to downstream auto-execute nodes (combine-text, split-text, extract-field)
      cascadeAutoExecute(nodeId);
    })
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

let _runFromHereLock = false;

export async function handleRunFromHere(
  nodeId: string,
  ctx: ExecutionContext,
  projectId: string | undefined,
  save: (pid: string) => Promise<unknown>,
  setIsRunning: (v: boolean) => void,
  onExecutionStarted?: (id: string) => void,
  onExecutionEnded?: () => void,
): Promise<void> {
  if (_runFromHereLock) return;
  _runFromHereLock = true;

  try {
  rejectAllManualEdits();
  const { nodes, edges } = collapseExpandedClones();
  const startNode = nodes.find((n) => n.id === nodeId);
  if (!startNode) return;

  clearConnectedListRows(nodes);

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

  warnUnderMinRows(nodes.filter((n) => downstream.has(n.id)));

  const executableNodes = nodes.filter(
    (n) => downstream.has(n.id) && isExecutableNode(n),
  );
  if (executableNodes.length === 0) {
    toast.error("No executable nodes found downstream.");
    return;
  }

  // Only clear the scope that's actually re-running — upstream/out-of-subset
  // nodes keep their saved output so the backend orchestrator can still
  // resolve inputs from them via extractSavedNodeOutput.
  // preserveHistory keeps `generatedResults` so the new run prepends to the
  // existing list instead of replacing it (matches single-node Run behavior).
  resetNodeAccumulation(executableNodes, { preserveHistory: true });

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
    const idempotencyKey = generateIdempotencyKey();
    const result = await withDedupRaceRetry(() => runWorkflow(workflowId, [...downstream], idempotencyKey));
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
  } finally {
    _runFromHereLock = false;
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

  // Clear stale upstream-driven rows across the whole graph — even selected-run
  // can drive downstream list nodes that weren't themselves in the selection.
  clearConnectedListRows(nodes);

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
  warnUnderMinRows(selectedNodes);

  const selectedIds = selectedNodes.map((n) => n.id);

  resetNodeAccumulation(executableNodes);

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
    const idempotencyKey = generateIdempotencyKey();
    const result = await withDedupRaceRetry(() => runWorkflow(workflowId, selectedIds, idempotencyKey));
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
      onCompleted: async () => {
        if (finished) return;
        // Defensive final fetch: SSE's in-memory nodeStates can lag behind the
        // DB snapshot (race between the last node:updated event and the
        // execution:completed event) and leave the UI stuck showing "running"
        // on the last node. Pull the canonical state from the DB and re-sync
        // before cleaning up so the user doesn't have to refresh.
        try {
          const exec = await getWorkflowExecution(executionId);
          const finalStates = (exec.nodeStates ?? {}) as Record<string, NodeExecutionState>;
          syncNodeStatesToStore(finalStates);
        } catch {
          // Non-critical — SSE already applied what it had.
        }
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
    /** Multi-variant arrays from a single job. Mirrors backend NodeOutput. */
    imageUrls?: readonly string[];
    audioUrls?: readonly string[];
    text?: string;
    script?: unknown;
    generatedVoiceId?: string;
    alignment?: unknown;
    vocalUrl?: string;
    instrumentalUrl?: string;
    splitResults?: string[];
    combinedText?: string;
    listResults?: string[];
    plan?: Record<string, unknown>;
    sunoTrackId?: string;
    sunoTaskId?: string;
    kieTaskId?: string;
    thumbnailUrl?: string;
    paramOutputs?: Record<string, string>;
    previewItems?: Array<{
      type: string;
      value: string;
      itemKey?: string;
      sourceNodeId: string;
      sourceHandle?: string;
      sourceNodeLabel: string;
    }>;
    _outputResults?: Record<string, string>;
  };
  error?: string;
  jobId?: string;
  /** Per-iteration job IDs for fan-out runs (list / loop iterations). */
  jobIds?: string[];
  nodeType?: string;
  progress?: number;
}

/**
 * Sync a nodeStates snapshot from the backend into the Zustand store.
 * Batches all node updates into a single setState call (O(N) instead of
 * O(updates * N)) to avoid triggering N separate React re-renders during
 * the polling loop that runs every 3 seconds.
 */
function syncNodeStatesToStore(
  nodeStates: Record<string, NodeExecutionState>,
): void {
  const { nodes } = useWorkflowStore.getState();

  // Build per-node update patches in one pass
  const patchMap = new Map<string, Record<string, unknown>>();

  for (const node of nodes) {
    const state = nodeStates[node.id];
    if (!state) continue;

    const data = node.data as Record<string, unknown>;
    const currentStatus = data.executionStatus as string | undefined;

    // Re-sync results when node is already completed but generatedResults
    // is empty/missing (polling caught status before output was persisted).
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
          updates.vocalUrl = state.output.vocalUrl;
        if (state.output.instrumentalUrl)
          updates.instrumentalUrl = state.output.instrumentalUrl;
        if (state.output.alignment)
          updates.alignmentResults = state.output.alignment;
        if (state.output.combinedText) {
          updates.combinedText = state.output.combinedText;
          updates.generatedText = state.output.combinedText;
        }
        if (state.output.text && !state.output.combinedText) {
          updates.generatedText = state.output.text;
          const prevTextResults = (data.generatedResults ?? []) as Array<{ text?: string; jobId?: string }>;
          const alreadyHas = prevTextResults.some((r) => r.text === state.output!.text);
          if (!alreadyHas) {
            updates.generatedResults = [
              { text: state.output.text, jobId: state.jobId ?? `exec-${node.id}`, timestamp: new Date().toISOString() },
              ...prevTextResults,
            ];
            updates.activeResultIndex = 0;
          }
        }
        if (state.output.splitResults)
          updates.splitResults = state.output.splitResults;
        if (state.output.plan) {
          const mapping = COMPOSER_PLAN_MAP[node.type ?? ""];
          if (mapping) {
            updates[mapping.planField] = state.output.plan;
            if (node.type === "video-composer") updates.sceneGraph = state.output.plan;
          }
        }
        if (state.output.sunoTrackId)
          updates.sunoTrackId = state.output.sunoTrackId;
        if (state.output.sunoTaskId)
          updates.sunoTaskId = state.output.sunoTaskId;
        if (state.output.kieTaskId)
          updates.kieTaskId = state.output.kieTaskId;
        if (state.output.previewItems)
          updates.previewItems = state.output.previewItems;
        if (state.output.paramOutputs)
          updates.__triggerData = state.output.paramOutputs;

        // Component node: map _outputResults to outputResults + extract preview URL
        if (state.output._outputResults && node.type === "component") {
          const outputResults = state.output._outputResults as Record<string, string>;
          updates.outputResults = outputResults;
          // Find the first output URL for generatedResults / preview
          const firstUrl = Object.values(outputResults).find((v) => typeof v === "string" && v.startsWith("http"));
          if (firstUrl) {
            // Determine media type from URL for legacy field mapping
            if (/\.(png|jpg|jpeg|webp|gif|svg)/i.test(firstUrl)) {
              updates.generatedImageUrl = firstUrl;
            } else if (/\.(mp4|mov|webm)/i.test(firstUrl)) {
              updates.generatedVideoUrl = firstUrl;
            } else if (/\.(mp3|wav|ogg|m4a)/i.test(firstUrl)) {
              updates.generatedAudioUrl = firstUrl;
            }
          }
        }
        if (state.output.thumbnailUrl)
          updates.thumbnailUrl = state.output.thumbnailUrl;
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

        // List/loop fan-out: one URL per iteration, each with its own jobId.
        if (listResultUrls.length > 1) {
          const newResults = listResultUrls
            .filter((url) => !existingUrls.has(url))
            .map((url, i) => ({
              url,
              timestamp: new Date().toISOString(),
              jobId: state.jobIds?.[i] ?? `exec-${node.id}-${i}`,
            }));
          if (newResults.length > 0) {
            updates.generatedResults = [...newResults, ...prev];
            updates.activeResultIndex = 0;
          }
        }
        // Multi-variant from a single job (Grok 6 images, Suno 2 tracks).
        // Same shape as poll-job.ts so single-node and orchestrator paths
        // produce identical generatedResults for the same job.
        else {
          const variantUrls = state.output.imageUrls ?? state.output.audioUrls;
          if (variantUrls && variantUrls.length > 1) {
            const newResults = buildVariantResults(
              variantUrls, state.jobId ?? `exec-${node.id}`, { existingUrls },
            );
            if (newResults.length > 0) {
              updates.generatedResults = [...newResults, ...prev];
              updates.activeResultIndex = 0;
            }
          } else {
            const outputUrl =
              state.output.imageUrl ?? state.output.videoUrl ?? state.output.audioUrl;
            if (outputUrl && !existingUrls.has(outputUrl)) {
              updates.generatedResults = [
                {
                  url: outputUrl,
                  timestamp: new Date().toISOString(),
                  jobId: state.jobId ?? `exec-${node.id}`,
                },
                ...prev,
              ];
              updates.activeResultIndex = 0;
            }
          }
        }
      }
      patchMap.set(node.id, updates);
    } else if (state.status === "running") {
      // Always update running nodes (may have progress changes). Progress is
      // propagated for ALL running nodes, not just components — the backend
      // orchestrator now surfaces per-job progress via onJobProgress so
      // Run-from-here runs can show the progress bar too.
      const runPatch: Record<string, unknown> = { executionStatus: "running" }
      if (typeof state.progress === "number") {
        runPatch.currentJobProgress = state.progress
      }
      if (currentStatus !== "running" || runPatch.currentJobProgress !== undefined) {
        patchMap.set(node.id, runPatch)
      }
    } else if (
      state.status === "pending" &&
      currentStatus !== "pending" &&
      currentStatus !== "running" &&
      currentStatus !== "completed"
    ) {
      patchMap.set(node.id, { executionStatus: "pending" });
    } else if (state.status === "failed" && currentStatus !== "failed") {
      patchMap.set(node.id, {
        executionStatus: "failed",
        errorMessage: state.error ?? "Node failed",
      });
    } else if (state.status === "skipped" && currentStatus !== "completed") {
      // Router-gated node: mark as idle (not stuck in "pending")
      patchMap.set(node.id, { executionStatus: "idle" });
    }
  }

  if (patchMap.size === 0) return;

  // Apply all patches in a single store update (one React re-render).
  // All updates are execution-only so we skip undo capture.
  setSkipUndoCapture(true);
  useWorkflowStore.setState((prev) => ({
    nodes: prev.nodes.map((n) => {
      const patch = patchMap.get(n.id);
      if (!patch) return n;
      return { ...n, data: { ...n.data, ...patch } };
    }),
    isDirty: true,
  }));
  setSkipUndoCapture(false);
}
