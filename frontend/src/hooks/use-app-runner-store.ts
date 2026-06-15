/**
 * Zustand store for the Published App runner (consumer flow).
 * Pattern mirrors usePresentationStore but adds run history and app metadata.
 */

import { create } from "zustand"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import {
  getPublishedApp,
  runPublishedApp,
  getAppRuns,
  getAppExecutionStatus,
  deleteAppRun,
  cancelWorkflowExecution,
  InsufficientCreditsError,
  type PublishedApp,
  type AppRun,
  batchExecutionEstimates,
} from "@/lib/api"
import { buildProgressSegments, calculateCombinedProgress, type ProgressSegment, CATEGORY_DURATION_DEFAULTS } from "@nodaro/shared"
import { getOutputNodes } from "@nodaro/shared"
import { migrateListLoopNodes } from "@/lib/list-loop-migration"
import { composeLottieSlotOverrides, collectSlotExposedNodeIds } from "@/lib/lottie-slot-overrides"
import { resolveInputItems } from "@/components/presentation/helpers"
import type { PresentationSettings } from "@/hooks/use-workflow-store"

export type AppRunnerStatus = "idle" | "loading" | "running" | "completed" | "failed"

interface NodeState {
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  output?: Record<string, unknown>
  error?: string
}

/**
 * Per-run execution state. Multiple runs of the same app can be in flight at
 * once (chat mode), so every execution-scoped field is keyed by runId here
 * rather than held as a single top-level value. `combinedProgress` is keyed by
 * output-node-id, which collides across concurrent same-app runs unless it
 * lives per-run — that collision is the core reason this map exists.
 */
export interface RunRuntime {
  executionId: string | null
  status: AppRunnerStatus
  nodeStates: Record<string, NodeState>
  completedNodes: number
  totalNodes: number
  errorMessage: string | null
  insufficientCredits: boolean
  progressSegments: Record<string, ProgressSegment[]>
  combinedProgress: Record<string, number>
}

const EMPTY_RUNTIME: RunRuntime = {
  executionId: null,
  status: "idle",
  nodeStates: {},
  completedNodes: 0,
  totalNodes: 0,
  errorMessage: null,
  insufficientCredits: false,
  progressSegments: {},
  combinedProgress: {},
}

interface AppRunnerState {
  // App data
  app: PublishedApp | null
  slug: string | null
  loading: boolean

  // Versioning
  selectedVersion: number | null // null = latest

  // Run history
  runs: AppRun[]
  runsLoading: boolean
  activeRunId: string | null

  // Per-run execution state (concurrent runs). Read live status for a specific
  // run via getRunState(runId); the flat fields below mirror runtimes[activeRunId].
  runtimes: Record<string, RunRuntime>

  // Active-execution mirror (back-compat: a projection of runtimes[activeRunId]
  // maintained centrally by patchRuntime). Non-chat consumers read these.
  executionId: string | null
  executionStatus: AppRunnerStatus
  nodeStates: Record<string, NodeState>
  inputValues: Record<string, Record<string, unknown>>
  completedNodes: number
  totalNodes: number
  errorMessage: string | null
  insufficientCredits: boolean
  progressSegments: Record<string, ProgressSegment[]>
  combinedProgress: Record<string, number>

  // Actions
  loadApp: (slug: string) => Promise<void>
  loadRuns: () => Promise<void>
  selectRun: (runId: string) => void
  newRun: () => void
  run: (runId?: string) => Promise<void>
  cancel: (runId?: string) => Promise<void>
  deleteRun: (runId: string) => Promise<void>
  updateInputValue: (nodeId: string, key: string, value: unknown) => void
  resumeExecution: (executionId: string, runId?: string) => void
  setSelectedVersion: (version: number | null) => void
  getRunState: (runId: string) => RunRuntime
  reset: () => void
}

// One poller per in-flight execution, keyed by executionId so concurrent runs
// don't clobber each other's timeouts (the single-timeout model could only ever
// poll one run at a time).
const pollers = new Map<string, ReturnType<typeof setTimeout>>()

function clearPoller(executionId: string | null | undefined) {
  if (!executionId) return
  const t = pollers.get(executionId)
  if (t !== undefined) {
    clearTimeout(t)
    pollers.delete(executionId)
  }
}

function clearAllPollers() {
  for (const t of pollers.values()) clearTimeout(t)
  pollers.clear()
}

/** Project a runtime onto the flat active-mirror fields. */
function runtimeToFlat(r: RunRuntime): Partial<AppRunnerState> {
  return {
    executionId: r.executionId,
    executionStatus: r.status,
    nodeStates: r.nodeStates,
    completedNodes: r.completedNodes,
    totalNodes: r.totalNodes,
    errorMessage: r.errorMessage,
    insufficientCredits: r.insufficientCredits,
    progressSegments: r.progressSegments,
    combinedProgress: r.combinedProgress,
  }
}

/**
 * Single writer for per-run execution state: merges `patch` into
 * `runtimes[runId]` and, when that run is the active one, mirrors it onto the
 * flat fields. Centralising the projection here is what keeps the mirror from
 * drifting out of sync with the runtimes map.
 */
function patchRuntime(
  set: (partial: Partial<AppRunnerState>) => void,
  get: () => AppRunnerState,
  runId: string,
  patch: Partial<RunRuntime>,
) {
  const { runtimes, activeRunId } = get()
  const next: RunRuntime = { ...(runtimes[runId] ?? EMPTY_RUNTIME), ...patch }
  set({
    runtimes: { ...runtimes, [runId]: next },
    ...(runId === activeRunId ? runtimeToFlat(next) : {}),
  })
}

export const useAppRunnerStore = create<AppRunnerState>((set, get) => ({
  app: null,
  slug: null,
  loading: false,
  selectedVersion: null,
  runs: [],
  runsLoading: false,
  activeRunId: null,
  runtimes: {},
  executionId: null,
  executionStatus: "idle",
  nodeStates: {},
  inputValues: {},
  completedNodes: 0,
  totalNodes: 0,
  errorMessage: null,
  insufficientCredits: false,
  progressSegments: {},
  combinedProgress: {},

  getRunState: (runId: string) => get().runtimes[runId] ?? EMPTY_RUNTIME,

  loadApp: async (slug: string) => {
    if (get().loading) return
    // Clear stale app from previous navigation to prevent flash of old data
    set({ loading: true, slug, errorMessage: null, app: null })
    try {
      const app = await getPublishedApp(slug)
      // Guard: discard response if slug changed during fetch (navigation race)
      if (get().slug !== slug) { set({ loading: false }); return }
      // Migrate legacy `loop` ("Table") nodes to canonical `list` at this single
      // ingest boundary, so EVERY downstream consumer of app.snapshotNodes
      // (presentation-store seeding in app-runner-page/embed-page, useRunSlots'
      // input/output derivation, computeProgressSegments, MobileAppShell, remix)
      // sees `list`. Published-app snapshots are served raw (no editor/
      // orchestrator normalization). Edges are untouched (shared handle ids).
      const migratedApp = migrateAppSnapshot(app)
      set({ app: migratedApp, loading: false })
    } catch (err) {
      if (get().slug !== slug) { set({ loading: false }); return }
      set({
        loading: false,
        errorMessage: err instanceof Error ? err.message : "Failed to load app",
      })
    }
  },

  loadRuns: async () => {
    const { slug } = get()
    if (!slug) return
    set({ runsLoading: true })
    try {
      const { data } = await getAppRuns(slug)
      set({ runs: data, runsLoading: false })
    } catch {
      set({ runsLoading: false })
    }
  },

  selectRun: (runId: string) => {
    const { runs } = get()
    const run = runs.find((r) => r.id === runId)
    if (!run?.execution) return

    const nodeStates = (run.execution.nodeStates ?? {}) as Record<string, NodeState>
    const isTerminal = run.execution.status === "completed" || run.execution.status === "failed" || run.execution.status === "cancelled"
    const status: AppRunnerStatus = isTerminal
      ? (run.execution.status === "completed" ? "completed" : "failed")
      : "running"

    // Just re-point the active run + hydrate its runtime; do NOT stop other
    // runs' pollers (a concurrent run keeps streaming into its own runtime).
    set({ activeRunId: runId })
    patchRuntime(set, get, runId, {
      executionId: run.executionId,
      status,
      nodeStates,
      completedNodes: run.execution.completedNodes,
      totalNodes: run.execution.totalNodes,
      errorMessage: run.execution.errorMessage ?? null,
    })

    // Resume polling only if this run is live and not already being polled.
    if (!isTerminal && run.executionId && !pollers.has(run.executionId)) {
      startPolling(set, get, runId)
      computeProgressSegments(set, get, runId).catch(() => {})
    }
  },

  newRun: () => {
    // Reset the active pointer + flat mirror to idle. Other in-flight runs'
    // runtimes + pollers are intentionally left running (concurrency).
    set({
      activeRunId: null,
      executionId: null,
      executionStatus: "idle",
      nodeStates: {},
      inputValues: {},
      completedNodes: 0,
      totalNodes: 0,
      errorMessage: null,
      insufficientCredits: false,
      progressSegments: {},
      combinedProgress: {},
    })
  },

  run: async (existingRunId?: string) => {
    const { slug, inputValues, selectedVersion, app } = get()
    if (!slug) return

    // When the runId is known up front (chat launch), seed its runtime and make
    // it active immediately; otherwise the flat mirror covers the loading gap
    // until runPublishedApp assigns a runId.
    if (existingRunId) {
      // Re-firing a slot (Retry / re-run): drop the previous execution's poller
      // so its dead map entry can't linger, then reseed the runtime fresh.
      clearPoller(get().runtimes[existingRunId]?.executionId)
      set({ activeRunId: existingRunId })
      patchRuntime(set, get, existingRunId, { ...EMPTY_RUNTIME, status: "running" })
    } else {
      set({
        executionStatus: "running",
        errorMessage: null,
        insufficientCredits: false,
        nodeStates: {},
        completedNodes: 0,
        progressSegments: {},
        combinedProgress: {},
      })
    }

    try {
      // Fold lottie slot edits into a full-plan motionPlan override per node
      // (the orchestrator merge is shallow — see lottie-slot-overrides).
      const snapshotNodes = (app?.snapshotNodes ?? []) as ReadonlyArray<{
        id: string
        type?: string
        data?: Record<string, unknown>
      }>
      // Slot-exposed node ids derived from the SAME snapshot settings the app
      // renders its input cards from — so a slot-exposed lottie node ALWAYS emits
      // its full-plan override (freeze-on-exposure, design F16): the backend
      // pre-completes the node instead of re-rolling + re-charging it.
      const slotExposedNodeIds = collectSlotExposedNodeIds(
        resolveInputItems((app?.snapshotSettings ?? {}) as unknown as PresentationSettings),
      )
      const overrides = composeLottieSlotOverrides(inputValues, snapshotNodes, slotExposedNodeIds)
      const { executionId, runId } = await runPublishedApp(
        slug,
        Object.keys(overrides).length > 0 ? overrides : undefined,
        existingRunId,
        selectedVersion ?? undefined,
      )
      set({ activeRunId: runId })
      patchRuntime(set, get, runId, { executionId, status: "running" })
      startPolling(set, get, runId)
      computeProgressSegments(set, get, runId).catch(() => {})
    } catch (err) {
      const isInsufficientCredits = err instanceof InsufficientCreditsError
      const message = err instanceof Error ? err.message : "Failed to run app"
      const runId = existingRunId ?? get().activeRunId
      if (runId) {
        patchRuntime(set, get, runId, { status: "failed", errorMessage: message, insufficientCredits: isInsufficientCredits })
      } else {
        set({ executionStatus: "failed", errorMessage: message, insufficientCredits: isInsufficientCredits })
      }
    }
  },

  cancel: async (runId?: string) => {
    // Tolerate a bare onClick={cancel} (React passes the event): only a string
    // is a real runId, otherwise fall back to the active run.
    const rid = typeof runId === "string" ? runId : undefined
    const targetRunId = rid ?? get().activeRunId
    const executionId = targetRunId ? get().runtimes[targetRunId]?.executionId ?? null : get().executionId
    if (!executionId) return
    clearPoller(executionId)
    if (targetRunId) {
      patchRuntime(set, get, targetRunId, { status: "failed", errorMessage: "Cancelled" })
    } else {
      set({ executionStatus: "failed", errorMessage: "Cancelled" })
    }
    try {
      await cancelWorkflowExecution(executionId)
    } catch {
      // best effort
    }
  },

  deleteRun: async (runId: string) => {
    const { slug, runs, activeRunId, runtimes } = get()
    if (!slug) return
    try {
      await deleteAppRun(slug, runId)
      clearPoller(runtimes[runId]?.executionId)
      const nextRuntimes = { ...runtimes }
      delete nextRuntimes[runId]
      set({ runs: runs.filter((r) => r.id !== runId), runtimes: nextRuntimes })
      if (activeRunId === runId) {
        get().newRun()
      }
    } catch {
      // silently fail
    }
  },

  resumeExecution: (executionId: string, runId?: string) => {
    const targetRunId = runId ?? get().activeRunId
    if (!targetRunId) return
    // Re-point the active run + project its runtime onto the flat mirror FIRST,
    // so selecting an already-polling concurrent run still updates split-view.
    if (runId) set({ activeRunId: runId })
    patchRuntime(set, get, targetRunId, { executionId, status: "running", errorMessage: null })
    if (pollers.has(executionId)) return // already polling — just re-pointed + mirrored
    startPolling(set, get, targetRunId)
    computeProgressSegments(set, get, targetRunId).catch(() => {})
  },

  setSelectedVersion: (version: number | null) => {
    set({ selectedVersion: version })
  },

  updateInputValue: (nodeId: string, key: string, value: unknown) => {
    const { inputValues } = get()
    set({
      inputValues: {
        ...inputValues,
        [nodeId]: { ...inputValues[nodeId], [key]: value },
      },
    })
  },

  reset: () => {
    clearAllPollers()
    set({
      app: null,
      slug: null,
      loading: false,
      selectedVersion: null,
      runs: [],
      runsLoading: false,
      activeRunId: null,
      runtimes: {},
      executionId: null,
      executionStatus: "idle",
      nodeStates: {},
      inputValues: {},
      completedNodes: 0,
      totalNodes: 0,
      errorMessage: null,
      insufficientCredits: false,
      progressSegments: {},
      combinedProgress: {},
    })
  },
}))

/**
 * Migrate a published app's snapshot node array (loop→list, items→columns/rows)
 * once, at the loadApp ingest boundary. Only snapshotNodes/snapshotEdges are
 * replaced; every other PublishedApp field is passed through verbatim. Runs once
 * per load (loadApp is guarded against concurrent/duplicate loads), so the fresh
 * `app` object identity is harmless. Edges are returned unchanged by the
 * migration (list/loop share handle ids).
 *
 * Null-safe: if snapshotNodes is absent (real apps always have it — NOT NULL in
 * DB — but be defensive), the app is returned untouched rather than gaining
 * spurious empty arrays.
 */
function migrateAppSnapshot(app: PublishedApp): PublishedApp {
  if (!Array.isArray(app.snapshotNodes)) return app
  const { nodes, edges } = migrateListLoopNodes(
    app.snapshotNodes as WorkflowNode[],
    (Array.isArray(app.snapshotEdges) ? app.snapshotEdges : []) as WorkflowEdge[],
  )
  return { ...app, snapshotNodes: nodes, snapshotEdges: edges }
}

/**
 * Creates a bridged run function that syncs input values from the presentation store
 * to the app runner store (batched) before triggering the run.
 * Used by both app-runner-page and embed-page.
 */
export function createBridgedRun(
  getPresentationInputs: () => Record<string, Record<string, unknown>>,
  getRunId?: () => string | null,
): () => Promise<void> {
  return async () => {
    const presInputs = getPresentationInputs()
    const current = useAppRunnerStore.getState().inputValues
    const merged: Record<string, Record<string, unknown>> = { ...current }
    for (const [nodeId, values] of Object.entries(presInputs)) {
      merged[nodeId] = { ...merged[nodeId], ...values }
    }
    useAppRunnerStore.setState({ inputValues: merged })
    const runId = getRunId?.() ?? undefined
    await useAppRunnerStore.getState().run(runId)
  }
}

/**
 * Poll one run's execution to completion, writing into runtimes[runId]. The
 * timeout is registered in `pollers` keyed by executionId so concurrent runs
 * each keep their own poll loop. The runId→executionId binding is re-checked on
 * every tick so a stale response (run replaced/re-fired) is discarded.
 */
function startPolling(
  set: (partial: Partial<AppRunnerState>) => void,
  get: () => AppRunnerState,
  runId: string,
) {
  const executionId = get().runtimes[runId]?.executionId
  if (!executionId) return

  const poll = async () => {
    const rt = get().runtimes[runId]
    if (!rt || rt.executionId !== executionId || rt.status !== "running") return

    try {
      const status = await getAppExecutionStatus(executionId)

      // Guard: discard if this run's execution changed while in flight.
      if (get().runtimes[runId]?.executionId !== executionId) return

      const nodeStates = (status.node_states ?? {}) as Record<string, NodeState>
      patchRuntime(set, get, runId, {
        nodeStates,
        completedNodes: status.completed_nodes,
        totalNodes: status.total_nodes,
      })

      // Combined progress from THIS run's segments (per-run avoids the
      // output-node-id collision between concurrent same-app runs).
      const segs = get().runtimes[runId]?.progressSegments ?? {}
      if (Object.keys(segs).length > 0) {
        const combined: Record<string, number> = {}
        for (const [visibleId, s] of Object.entries(segs)) {
          combined[visibleId] = calculateCombinedProgress(
            s,
            nodeStates as Record<string, { status: "pending" | "running" | "completed" | "failed" | "skipped"; startedAt?: string }>,
          )
        }
        patchRuntime(set, get, runId, { combinedProgress: combined })
      }

      if (status.status === "completed") {
        patchRuntime(set, get, runId, { status: "completed" })
        clearPoller(executionId)
        const { slug } = get()
        if (slug) {
          getAppRuns(slug).then(({ data }) => set({ runs: data })).catch(() => {})
        }
        return
      }
      if (status.status === "failed" || status.status === "cancelled") {
        patchRuntime(set, get, runId, {
          status: "failed",
          errorMessage: status.error_message ?? "Execution failed",
        })
        clearPoller(executionId)
        return
      }

      pollers.set(executionId, setTimeout(poll, 2000))
    } catch (err) {
      // Guard: discard error for a stale/replaced execution.
      if (get().runtimes[runId]?.executionId !== executionId) return
      patchRuntime(set, get, runId, {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "Connection lost",
      })
      clearPoller(executionId)
    }
  }

  pollers.set(executionId, setTimeout(poll, 1000))
}

async function computeProgressSegments(
  set: (partial: Partial<AppRunnerState>) => void,
  get: () => AppRunnerState,
  runId: string,
) {
  const { app } = get()
  if (!app) return

  const nodes = app.snapshotNodes as WorkflowNode[]
  const edges = app.snapshotEdges as WorkflowEdge[]

  const visibleOutputs = getOutputNodes(nodes, edges, true)
  if (visibleOutputs.length === 0) return

  // Build edge map: targetId -> sourceIds
  const edgeMap = new Map<string, string[]>()
  for (const edge of edges) {
    const sources = edgeMap.get(edge.target) ?? []
    sources.push(edge.source)
    edgeMap.set(edge.target, sources)
  }

  const allAncestorIds = new Set<string>()
  const segmentNodeIds: Record<string, string[]> = {}

  for (const outputNode of visibleOutputs) {
    const ancestors: string[] = []
    const visited = new Set<string>()
    const queue = [outputNode.id]

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      ancestors.push(nodeId)
      allAncestorIds.add(nodeId)

      const parents = edgeMap.get(nodeId) ?? []
      for (const p of parents) {
        if (!visited.has(p)) queue.push(p)
      }
    }

    ancestors.reverse()
    segmentNodeIds[outputNode.id] = ancestors
  }

  // Seed segments with default estimates synchronously so the progress bar
  // can render at 0% during the gap before batchExecutionEstimates resolves
  // and the first poll fires. Multi-node flows where the output is the last
  // node especially need this — without it, combinedProgress[outputId] is
  // undefined while upstream nodes run, and the bar never appears.
  const buildSegments = (estimates: Record<string, { estimatedMs: number }>): Record<string, ProgressSegment[]> => {
    const out: Record<string, ProgressSegment[]> = {}
    for (const [visibleId, ancestorIds] of Object.entries(segmentNodeIds)) {
      const nodeEstimates = ancestorIds.map(id => ({
        nodeId: id,
        estimatedMs: estimates[id]?.estimatedMs ?? CATEGORY_DURATION_DEFAULTS.image!,
      }))
      out[visibleId] = buildProgressSegments(nodeEstimates)
    }
    return out
  }

  patchRuntime(set, get, runId, { progressSegments: buildSegments({}) })

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const estimateRequests = Array.from(allAncestorIds).map(nodeId => {
    const node = nodeMap.get(nodeId)
    const data = (node?.data ?? {}) as Record<string, unknown>
    return {
      nodeId,
      model: (data.provider as string) ?? (data.ttsModel as string) ?? (data.llmModel as string) ?? node?.type ?? "unknown",
      aspectRatio: (data.aspect_ratio as string) ?? (data.aspectRatio as string),
      quality: (data.resolution as string) ?? (data.quality as string),
      duration: Number(data.duration) || undefined,
    }
  })

  const estimates = await batchExecutionEstimates(estimateRequests)
  // Discard if the run was replaced/cleared while estimates were in flight.
  if (!get().runtimes[runId]) return
  patchRuntime(set, get, runId, { progressSegments: buildSegments(estimates) })
}
