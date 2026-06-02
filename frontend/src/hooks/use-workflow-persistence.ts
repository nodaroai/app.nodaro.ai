import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase"
import { useWorkflowStore, type PresentationSettings } from "@/hooks/use-workflow-store"
import { getBatchJobStatus, listWorkflowExecutions, type BatchJobStatus } from "@/lib/api"
import { reconcileWorkflowNodeResults } from "@/lib/reconcile-node-results"
import { prefetchModelCredits } from "@/ee/hooks/queries/use-credits-queries"
import { toast } from "sonner"
import type { WorkflowNode, WorkflowEdge, CharacterDefinition, GeneratedResult, SceneNodeData } from "@/types/nodes"
import { filterCloneNodes } from "@nodaro/shared"
import { orderNodesParentFirst } from "@/components/editor/workflow-editor/group-coords"
import { isStudioWorkflowSettings } from "@/lib/studio"

interface StillRunningJob {
  readonly nodeId: string
  readonly jobId: string
  readonly nodeType: string
}

interface ActiveBackendExecution {
  readonly executionId: string
  readonly nodeStates: Record<string, NodeExecutionState>
}

interface NodeExecutionState {
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  output?: {
    imageUrl?: string
    videoUrl?: string
    audioUrl?: string
    text?: string
    script?: unknown
    generatedVoiceId?: string
    alignment?: unknown
    vocalUrl?: string
    instrumentalUrl?: string
    splitResults?: string[]
    combinedText?: string
    listResults?: string[]
  }
  error?: string
}

interface SaveResult {
  readonly success: boolean
  readonly error?: string
  readonly stillRunningJobs?: StillRunningJob[]
  readonly activeBackendExecution?: ActiveBackendExecution
}

const SAVED_DISPLAY_DURATION = 2000

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Check if a string is a valid UUID
 */
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id)
}

/**
 * Sync node results from jobs table via backend API.
 * When user leaves and returns, jobs may have completed in the background.
 * This function checks for any nodes with "running" status and updates them
 * with the actual job results from the database.
 */
async function syncNodeResultsFromDB(nodes: WorkflowNode[]): Promise<{ nodes: WorkflowNode[]; stillRunningJobs: StillRunningJob[] }> {
  // Find all nodes that might need syncing:
  // 1. Nodes with executionStatus === "running" or "pending"
  // 2. Nodes with generatedResults that have jobIds we can check
  const nodesToSync: { node: WorkflowNode; jobIds: string[] }[] = []

  for (const node of nodes) {
    const data = node.data as Record<string, unknown>
    const status = data.executionStatus as string | undefined
    const results = (data.generatedResults ?? []) as GeneratedResult[]

    // Collect jobIds from generatedResults (only valid UUIDs, skip imported/local IDs)
    const jobIds = results
      .map(r => r.jobId)
      .filter((id): id is string => Boolean(id) && isValidUuid(id))

    // Also check currentJobId as a source (persisted during active runs)
    const currentJobId = data.currentJobId as string | undefined
    if (currentJobId && isValidUuid(currentJobId) && !jobIds.includes(currentJobId)) {
      jobIds.unshift(currentJobId)
    }

    // Only sync nodes that are still in running/pending state
    if (status === "running" || status === "pending") {
      nodesToSync.push({ node, jobIds })
    }
  }

  if (nodesToSync.length === 0) {
    return { nodes, stillRunningJobs: [] }
  }

  // Collect all unique jobIds
  const allJobIds = [...new Set(nodesToSync.flatMap(n => n.jobIds))]

  if (allJobIds.length === 0) {
    // No jobIds to check - just reset running/pending nodes to idle
    const resetNodes = nodes.map(node => {
      const data = node.data as Record<string, unknown>
      const status = data.executionStatus as string | undefined
      if (status === "running" || status === "pending") {
        return {
          ...node,
          data: { ...data, executionStatus: "idle" } as SceneNodeData
        }
      }
      return node
    })
    return { nodes: resetNodes, stillRunningJobs: [] }
  }

  // Query all jobs at once via backend API
  let jobs: BatchJobStatus[]
  try {
    jobs = await getBatchJobStatus(allJobIds)
  } catch (err) {
    // Ignore abort errors (component unmounted during fetch)
    if (err instanceof DOMException && err.name === "AbortError") {
      return { nodes, stillRunningJobs: [] }
    }
    return { nodes, stillRunningJobs: [] }
  }

  // Create a map of jobId -> job for quick lookup
  const jobMap = new Map<string, BatchJobStatus>()
  for (const job of jobs) {
    jobMap.set(job.id, job)
  }

  // Track jobs that are still running so caller can restore polling
  const stillRunningJobs: StillRunningJob[] = []

  // Update nodes based on job status
  const updatedNodes = nodes.map(node => {
    const data = node.data as Record<string, unknown>
    const status = data.executionStatus as string | undefined
    const results = (data.generatedResults ?? []) as GeneratedResult[]

    // Check if this node needs updating
    if (status !== "running" && status !== "pending") {
      return node
    }

    // Find the job ID to check: prefer currentJobId, fallback to most recent result
    const currentJobId = data.currentJobId as string | undefined
    const mostRecentResult = results[0]
    const jobIdToCheck = (currentJobId && isValidUuid(currentJobId))
      ? currentJobId
      : mostRecentResult?.jobId

    if (!jobIdToCheck) {
      // No job to check - reset to idle
      return {
        ...node,
        data: { ...data, executionStatus: "idle", currentJobId: undefined }
      }
    }

    const job = jobMap.get(jobIdToCheck)
    if (!job) {
      // Job not found - reset to idle
      return {
        ...node,
        data: { ...data, executionStatus: "idle", currentJobId: undefined }
      }
    }

    if (job.status === "completed") {
      // Job completed - update node with result
      const outputUrl = job.output_data?.imageUrl ?? job.output_data?.videoUrl ?? job.output_data?.audioUrl

      // Update the result with the URL if it was missing
      const updatedResults = results.map((r, i) => {
        if (i === 0 && r.jobId === job.id && !r.url && outputUrl) {
          return { ...r, url: outputUrl }
        }
        return r
      })

      // If the job was tracked by currentJobId but has no result entry, prepend one
      const hasResultForJob = updatedResults.some(r => r.jobId === job.id)
      if (!hasResultForJob && outputUrl) {
        updatedResults.unshift({ url: outputUrl, timestamp: new Date().toISOString(), jobId: job.id })
      }

      const newData: Record<string, unknown> = {
        ...data,
        executionStatus: "completed",
        generatedResults: updatedResults,
        activeResultIndex: 0,
        currentJobId: undefined,
        currentJobProgress: undefined,
      }

      // Set the appropriate URL field based on output type
      const nodeType = node.type ?? ""
      if (job.output_data?.imageUrl) {
        // Character/face/object/location nodes use sourceImageUrl
        if (["character", "face", "object", "location"].includes(nodeType)) {
          newData.sourceImageUrl = job.output_data.imageUrl
        } else {
          newData.generatedImageUrl = job.output_data.imageUrl
        }
      } else if (job.output_data?.videoUrl) {
        newData.generatedVideoUrl = job.output_data.videoUrl
      } else if (job.output_data?.audioUrl) {
        newData.generatedAudioUrl = job.output_data.audioUrl
      } else if (job.output_data?.script) {
        newData.generatedScript = job.output_data.script
      } else if (job.output_data) {
        // Node-type-specific restoration for sync nodes without media URLs
        const outputData = job.output_data as Record<string, unknown>
        switch (nodeType) {
          case "instagram-post":
          case "tiktok-post":
          case "youtube-upload":
          case "linkedin-post":
          case "x-post":
          case "facebook-post":
            newData.platformPostId = outputData.platformPostId
            newData.platformPostUrl = outputData.platformPostUrl
            break
          case "qa-check":
            newData.score = outputData.score
            newData.approved = outputData.approved
            newData.reason = outputData.reason
            break
          case "image-critic":
            newData.score = outputData.score
            newData.approved = outputData.approved
            newData.feedback = outputData.feedback
            newData.details = outputData.details
            break
          case "save-to-storage":
            // Backend stores `url`, frontend uses `savedUrl`
            newData.savedUrl = outputData.url
            break
          case "webhook-output":
            newData.webhookSuccess = outputData.success
            newData.webhookStatusCode = outputData.statusCode
            newData.webhookResponseBody = outputData.responseBody
            break
          case "component": {
            // Component output_data is { handleId: url } — restore outputResults
            const outputResults: Record<string, string> = {}
            for (const [k, v] of Object.entries(outputData)) {
              if (typeof v === "string") outputResults[k] = v
            }
            newData.outputResults = outputResults
            break
          }
        }
      }

      return { ...node, data: newData }
    } else if (job.status === "failed") {
      // Job failed - update node with error
      return {
        ...node,
        data: {
          ...data,
          executionStatus: "failed",
          errorMessage: job.error_message ?? "Job failed",
          currentJobId: undefined,
          currentJobProgress: undefined,
        }
      }
    } else if (job.status === "cancelled") {
      // Job was cancelled - reset to idle
      return {
        ...node,
        data: { ...data, executionStatus: "idle", currentJobId: undefined, currentJobProgress: undefined }
      }
    }

    // Job is still pending/processing - collect for polling restoration
    stillRunningJobs.push({
      nodeId: node.id,
      jobId: jobIdToCheck,
      nodeType: node.type ?? "",
    })
    return node
  })

  return { nodes: updatedNodes as WorkflowNode[], stillRunningJobs }
}

/**
 * Apply backend execution node states to frontend nodes.
 * Maps orchestrator nodeStates → node.data.executionStatus + output URLs.
 */
function applyBackendExecutionState(
  nodes: WorkflowNode[],
  nodeStates: Record<string, NodeExecutionState>,
): WorkflowNode[] {
  return nodes.map(node => {
    const state = nodeStates[node.id]
    if (!state) return node

    const data = { ...(node.data as Record<string, unknown>) }

    // Map backend status → frontend executionStatus
    if (state.status === "completed") {
      data.executionStatus = "completed"
      if (state.output) {
        const nodeType = node.type ?? ""
        if (state.output.imageUrl) {
          if (["character", "face", "object", "location"].includes(nodeType)) {
            data.sourceImageUrl = state.output.imageUrl
          } else {
            data.generatedImageUrl = state.output.imageUrl
          }
        }
        if (state.output.videoUrl) data.generatedVideoUrl = state.output.videoUrl
        if (state.output.audioUrl) data.generatedAudioUrl = state.output.audioUrl
        if (state.output.script) data.generatedScript = state.output.script
        if (state.output.generatedVoiceId) data.generatedVoiceId = state.output.generatedVoiceId
        if (state.output.vocalUrl) data.generatedVocalUrl = state.output.vocalUrl
        if (state.output.instrumentalUrl) data.generatedInstrumentalUrl = state.output.instrumentalUrl
        if (state.output.alignment) data.generatedAlignment = state.output.alignment
        if (state.output.combinedText) data.generatedText = state.output.combinedText
        if (state.output.splitResults) data.generatedSplitResults = state.output.splitResults

        // Build generated result entries from the output
        const listResultUrls = (state.output.listResults ?? []).filter(
          (u: string) => u && u.startsWith("http"),
        )
        const results = (data.generatedResults ?? []) as GeneratedResult[]
        const existingUrls = new Set(results.map(r => r.url))

        if (listResultUrls.length > 1) {
          // Fan-out: multiple results from list execution
          const newResults = listResultUrls
            .filter((url: string) => !existingUrls.has(url))
            .map((url: string, i: number) => ({
              url,
              timestamp: new Date().toISOString(),
              jobId: `exec-${node.id}-${i}`,
            }))
          if (newResults.length > 0) {
            data.generatedResults = [...newResults, ...results]
            data.activeResultIndex = 0
          }
          data.__listResults = state.output.listResults
          data.__listTotal = state.output.listResults!.length
          data.__listCompleted = state.output.listResults!.length
        } else {
          const outputUrl = state.output.imageUrl ?? state.output.videoUrl ?? state.output.audioUrl
          if (outputUrl && !existingUrls.has(outputUrl)) {
            data.generatedResults = [
              { url: outputUrl, timestamp: new Date().toISOString(), jobId: `exec-${node.id}` },
              ...results,
            ]
            data.activeResultIndex = 0
          }
        }
      }
    } else if (state.status === "running") {
      data.executionStatus = "running"
    } else if (state.status === "pending") {
      data.executionStatus = "pending"
    } else if (state.status === "failed") {
      data.executionStatus = "failed"
      if (state.error) data.errorMessage = state.error
    }
    // "skipped" → leave as-is (idle)

    return { ...node, data: data as SceneNodeData }
  })
}

/**
 * Apply results from a completed backend execution to nodes that don't
 * already have outputs. This handles the case where execution ran while
 * the frontend was closed — the workflow JSON was never updated with results.
 */
function applyCompletedExecutionResults(
  nodes: WorkflowNode[],
  nodeStates: Record<string, NodeExecutionState>,
): WorkflowNode[] {
  return nodes.map(node => {
    const state = nodeStates[node.id]
    if (!state || state.status !== "completed" || !state.output) return node

    const data = node.data as Record<string, unknown>

    // Skip nodes that were already marked completed in the saved workflow.
    // Their results were already synced (via SSE or a previous load).
    // Any changes the user made (e.g. deleting images) should be respected.
    if (data.executionStatus === "completed") return node

    const outputUrl = state.output.imageUrl ?? state.output.videoUrl ?? state.output.audioUrl

    // Skip if node already has results (don't overwrite newer manual runs)
    const existingResults = (data.generatedResults ?? []) as GeneratedResult[]
    if (outputUrl && existingResults.some(r => r.url === outputUrl)) return node

    // Skip if node already has a generated output URL matching the execution
    const hasImage = data.generatedImageUrl || data.sourceImageUrl
    const hasVideo = data.generatedVideoUrl
    const hasAudio = data.generatedAudioUrl
    if (hasImage && state.output.imageUrl) return node
    if (hasVideo && state.output.videoUrl) return node
    if (hasAudio && state.output.audioUrl) return node

    // Apply the output
    const newData: Record<string, unknown> = { ...data, executionStatus: "completed" }
    const nodeType = node.type ?? ""

    if (state.output.imageUrl) {
      if (["character", "face", "object", "location"].includes(nodeType)) {
        newData.sourceImageUrl = state.output.imageUrl
      } else {
        newData.generatedImageUrl = state.output.imageUrl
      }
    }
    if (state.output.videoUrl) newData.generatedVideoUrl = state.output.videoUrl
    if (state.output.audioUrl) newData.generatedAudioUrl = state.output.audioUrl
    if (state.output.script) newData.generatedScript = state.output.script
    if (state.output.generatedVoiceId) newData.generatedVoiceId = state.output.generatedVoiceId
    if (state.output.vocalUrl) newData.generatedVocalUrl = state.output.vocalUrl
    if (state.output.instrumentalUrl) newData.generatedInstrumentalUrl = state.output.instrumentalUrl
    if (state.output.alignment) newData.generatedAlignment = state.output.alignment
    if (state.output.combinedText) newData.generatedText = state.output.combinedText
    if (state.output.splitResults) newData.generatedSplitResults = state.output.splitResults

    // Handle fan-out list results — create a generatedResult entry for each URL
    const listResultUrls = (state.output.listResults ?? []).filter(
      (u: string) => u && u.startsWith("http"),
    )
    if (listResultUrls.length > 1) {
      // Fan-out: multiple results from list execution
      const existingUrls = new Set(existingResults.map(r => r.url))
      const newResults = listResultUrls
        .filter((url: string) => !existingUrls.has(url))
        .map((url: string, i: number) => ({
          url,
          timestamp: new Date().toISOString(),
          jobId: `exec-${node.id}-${i}`,
        }))
      if (newResults.length > 0) {
        newData.generatedResults = [...newResults, ...existingResults]
        newData.activeResultIndex = 0
      }
      // Sync fan-out metadata so downstream item:N resolution works
      newData.__listResults = state.output.listResults
      newData.__listTotal = state.output.listResults!.length
      newData.__listCompleted = state.output.listResults!.length
    } else if (outputUrl) {
      newData.generatedResults = [
        { url: outputUrl, timestamp: new Date().toISOString(), jobId: `exec-${node.id}` },
        ...existingResults,
      ]
      newData.activeResultIndex = 0
    }

    return { ...node, data: newData as SceneNodeData }
  })
}

export function useWorkflowPersistence(projectId?: string) {
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const savedFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow)
  const setIsWorkflowLoading = useWorkflowStore((s) => s.setIsWorkflowLoading)
  const setWorkflowId = useWorkflowStore((s) => s.setWorkflowId)
  const setSaveStatus = useWorkflowStore((s) => s.setSaveStatus)
  const setLoadedUpdatedAt = useWorkflowStore((s) => s.setLoadedUpdatedAt)
  const setRemoteUpdatedAt = useWorkflowStore((s) => s.setRemoteUpdatedAt)
  const applySaveSuccess = useWorkflowStore((s) => s.applySaveSuccess)

  // Hold a reference to the latest `load` callback so the save-on-conflict
  // toast's "Reload" button can call it without forcing a circular
  // `useCallback` dependency. Updated below right after `load` is defined.
  const loadRef = useRef<((id: string) => Promise<SaveResult>) | null>(null)

  const save = useCallback(
    async (pid?: string): Promise<SaveResult> => {
      const resolvedProjectId = pid ?? projectId
      if (!resolvedProjectId) return { success: false, error: "No project ID" }

      const { workflowId, workflowName, nodes: allNodes, edges: allEdges, characterDefinitions, flowPromptTemplates, presentationSettings } =
        useWorkflowStore.getState()

      // Filter out temporary nodes: sub-workflow execution nodes and expanded loop clones
      const cleaned = filterCloneNodes(allNodes, allEdges, { filterSubWorkflow: true })
      // Persist parent-first so every reader of the saved JSON (read-only
      // viewer, template preview, SDK, collaborators) renders groups correctly
      // without each having to re-sort. React Flow requires it (see group-coords).
      const nodes = orderNodesParentFirst(cleaned.nodes)
      const edges = cleaned.edges

      // Don't save empty workflows
      if (nodes.length === 0) return { success: false, error: "Empty workflow" }

      // isDirty guard: when the row is already persisted and the store has no
      // unsaved edits, skip the Supabase UPDATE entirely. The pre-Run save
      // (run-handlers) calls save() on every Run; for a clean editor this is a
      // pure round-trip with no payload change, so returning the success shape
      // without a network write makes Run feel instant. A brand-new workflow
      // (no workflowId yet) must still INSERT, so only short-circuit when an
      // id exists.
      if (workflowId && !useWorkflowStore.getState().isDirty) {
        return { success: true }
      }

      // Studio workflows are read-only in the app; never persist. (The Studio
      // app owns writes via the same backend route.) isReadOnly actions never
      // set isDirty, so this is belt-and-suspenders.
      if (useWorkflowStore.getState().isReadOnly) return { success: true }

      setSaving(true)
      setSaveStatus("saving")
      try {
        const supabase = createClient()

        const payload = {
          project_id: resolvedProjectId,
          name: workflowName,
          nodes: JSON.parse(JSON.stringify(nodes)),
          edges: JSON.parse(JSON.stringify(edges)),
          settings: {
            characterDefinitions: JSON.parse(JSON.stringify(characterDefinitions)),
            flowPromptTemplates: JSON.parse(JSON.stringify(flowPromptTemplates)),
            presentationSettings: JSON.parse(JSON.stringify(presentationSettings)),
            viewport: useWorkflowStore.getState().savedViewport,
          },
        }

        if (workflowId) {
          // Optimistic locking: chain `.eq("updated_at", loadedUpdatedAt)`
          // so a concurrent write (same workflow open on phone / other
          // tab / other browser) is detected as a 0-row UPDATE. Falls
          // back to last-write-wins only when `loadedUpdatedAt` is null
          // (no load happened — defensive; shouldn't occur in practice
          // since save() is reached via the editor which always loads
          // first).
          const loadedUpdatedAt = useWorkflowStore.getState().loadedUpdatedAt

          let query = supabase
            .from("workflows")
            .update(payload)
            .eq("id", workflowId)
          if (loadedUpdatedAt) query = query.eq("updated_at", loadedUpdatedAt)

          const { data, error } = await query.select("updated_at").maybeSingle()

          if (error) {
            setSaveStatus("error", error.message)
            return { success: false, error: error.message }
          }

          if (!data) {
            // 0 rows matched: either the row was deleted, or its
            // `updated_at` changed between load and save (another tab /
            // device wrote first). Surface the conflict with a one-tap
            // Reload action; dedupe on a stable toast id so a retry
            // loop in the autosave gate can't spam the screen.
            setSaveStatus("error", "Workflow was updated on another device")
            // Fetch the current updated_at so the realtime banner's
            // divergence check (`remoteUpdatedAt !== loadedUpdatedAt`)
            // shows even if the matching Realtime UPDATE event hasn't
            // arrived yet (or was missed because Realtime was offline).
            // If the fallback fetch fails or returns no `updated_at`,
            // still mark `remoteUpdatedAt` non-null with a sentinel so
            // the autosave gate (`remoteUpdatedAt !== loadedUpdatedAt`)
            // pauses retries — otherwise the loop hot-retries every
            // 3 s and spams the conflict toast on the same id.
            let captured = false
            try {
              const { data: cur } = await supabase
                .from("workflows")
                .select("updated_at")
                .eq("id", workflowId)
                .maybeSingle()
              if (cur?.updated_at) {
                setRemoteUpdatedAt(cur.updated_at as string)
                captured = true
              }
            } catch {
              // best-effort; fall through to the sentinel below
            }
            if (!captured) {
              // Sentinel: any string different from `loadedUpdatedAt`.
              // The next real Realtime broadcast or reload corrects it.
              setRemoteUpdatedAt(`conflict:${new Date().toISOString()}`)
            }
            const reload = loadRef.current
            toast.error("Workflow was updated on another device", {
              id: "workflow-remote-conflict",
              description: "Your unsaved edits are still here. Reload to see the latest version.",
              action: reload && workflowId
                ? { label: "Reload", onClick: () => { void reload(workflowId) } }
                : undefined,
              duration: 10_000,
            })
            return { success: false, error: "remote_conflict" }
          }

          // Advance the optimistic-lock cursor to the new version + mark
          // clean + flip status atomically — see `applySaveSuccess` doc
          // for why these four updates must land in one Zustand set().
          applySaveSuccess(data.updated_at as string)
        } else {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) {
            setSaveStatus("error", "Not authenticated")
            return { success: false, error: "Not authenticated" }
          }

          const { data, error } = await supabase
            .from("workflows")
            .insert({ ...payload, user_id: user.id })
            .select("id, updated_at")
            .single()

          if (error) {
            setSaveStatus("error", error.message)
            return { success: false, error: error.message }
          }
          // `setWorkflowId` is a separate set() — ordering matters only
          // relative to the realtime subscription, which won't fire for
          // this workflow until the channel id matches (re-subscribe is
          // triggered by `workflowId` change in `workflow-canvas.tsx`).
          // The window between insert and re-subscribe is broadcast-safe.
          setWorkflowId(data.id)
          applySaveSuccess(data.updated_at as string)
        }

        // Clear any existing fade timer
        if (savedFadeTimerRef.current) {
          clearTimeout(savedFadeTimerRef.current)
        }
        savedFadeTimerRef.current = setTimeout(() => {
          // Only reset if still in "saved" state
          const current = useWorkflowStore.getState().saveStatus
          if (current === "saved") {
            setSaveStatus("idle")
          }
        }, SAVED_DISPLAY_DURATION)

        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save"
        setSaveStatus("error", message)
        return { success: false, error: message }
      } finally {
        setSaving(false)
      }
    },
    [projectId, setWorkflowId, setSaveStatus, setLoadedUpdatedAt, setRemoteUpdatedAt, applySaveSuccess],
  )

  const load = useCallback(
    async (id: string): Promise<SaveResult> => {
      setLoading(true)
      setIsWorkflowLoading(true)

      // Immediately clear old workflow data so the canvas doesn't flash
      // the previous workflow while the new one is being fetched.
      // The empty nodes array also prevents save() from persisting stale data
      // (save bails out when nodes.length === 0).
      loadWorkflow(id, "", [], [], [])
      setLoadedUpdatedAt(null)
      setRemoteUpdatedAt(null)

      try {
        const supabase = createClient()

        const { data, error } = await supabase
          .from("workflows")
          .select("*")
          .eq("id", id)
          .single()

        if (error) return { success: false, error: error.message }

        const settings = (data.settings ?? {}) as Record<string, unknown>
        const charDefs = (settings.characterDefinitions ?? []) as CharacterDefinition[]
        const flowTemplates = (settings.flowPromptTemplates ?? {}) as Record<string, string>
        const presSettings = (settings.presentationSettings ?? undefined) as PresentationSettings | undefined
        const savedViewport = (settings.viewport ?? null) as { x: number; y: number; zoom: number } | null
        let nodes = data.nodes as unknown as WorkflowNode[]
        const edges = data.edges as unknown as WorkflowEdge[]

        // `__listRunning` is an in-session list-fan-out marker (abandon-guard
        // exemption). It must never survive a reload: there is no live
        // executeNodeForList running for a freshly-loaded workflow, so a stale
        // `true` (autosaved mid-batch before the finally cleared it) would
        // permanently exempt the node from the abandon-guard. Clear it on load.
        nodes = nodes.map((n) => {
          const d = n.data as Record<string, unknown> | undefined
          if (d?.__listRunning) {
            return { ...n, data: { ...d, __listRunning: false } as typeof n.data }
          }
          return n
        })

        // Sync node results from jobs table via backend API
        // This handles the case where user left while jobs were running
        const syncResult = await syncNodeResultsFromDB(nodes)
        let nodesChanged = JSON.stringify(syncResult.nodes) !== JSON.stringify(nodes)
        nodes = syncResult.nodes

        // Check for backend orchestrator executions:
        // 1. Active (pending/running) → restore polling + apply current state
        // 2. Most recent completed → apply results to nodes missing outputs
        //
        // The list response already includes nodeStates, so we use it directly
        // instead of issuing a separate /v1/workflow-executions/:id detail call.
        // That second call was racing list/detail consistency (single-node job
        // IDs merged into the list could 404 on detail) and showing loud 404s
        // in the console on every workflow refresh.
        let activeBackendExecution: ActiveBackendExecution | undefined
        try {
          // First check for an active execution (editor-triggered only — exclude
          // app-runner and component executions which share the same workflow_id)
          const { data: activeExecs } = await listWorkflowExecutions(id, {
            limit: 1,
            status: "pending,running,stopping",
            source: "editor",
          })
          if (activeExecs.length > 0) {
            const exec = activeExecs[0]
            const nodeStates = (exec.nodeStates ?? {}) as Record<string, NodeExecutionState>
            // Status from list is a point-in-time snapshot — the subsequent
            // poll (once restored) will fetch fresh state and correct any
            // drift (e.g. execution completed between load and render).
            const stillActive = exec.status === "pending" || exec.status === "running" || exec.status === "stopping"
            if (stillActive && Object.keys(nodeStates).length > 0) {
              nodes = applyBackendExecutionState(nodes, nodeStates)
              nodesChanged = true
              activeBackendExecution = { executionId: exec.id, nodeStates }
            } else if (Object.keys(nodeStates).length > 0) {
              // Execution already finished — apply results like a completed execution
              nodes = applyCompletedExecutionResults(nodes, nodeStates)
              nodesChanged = true
            }
          } else {
            // No active execution — check the most recent completed one.
            // This handles the case where the execution ran while the
            // frontend was closed, so results were never applied to nodes.
            // Use source=editor to exclude app-runner/component executions.
            const { data: completedExecs } = await listWorkflowExecutions(id, {
              limit: 1,
              status: "completed",
              source: "editor",
            })
            if (completedExecs.length > 0) {
              const exec = completedExecs[0]
              const nodeStates = (exec.nodeStates ?? {}) as Record<string, NodeExecutionState>
              if (Object.keys(nodeStates).length > 0) {
                // Only apply outputs to nodes that don't already have results
                const before = JSON.stringify(nodes)
                nodes = applyCompletedExecutionResults(nodes, nodeStates)
                if (JSON.stringify(nodes) !== before) {
                  nodesChanged = true
                }
              }
            }
          }
        } catch {
          // Non-critical — no execution found or query failed
        }

        loadWorkflow(
          data.id,
          data.name,
          nodes,
          edges,
          charDefs,
          flowTemplates,
          presSettings,
          savedViewport,
        )
        setLoadedUpdatedAt(data.updated_at as string)

        // Studio-origin workflows are view-only in the node editor (the Studio
        // app edits them). `settings` was computed above from data.settings.
        useWorkflowStore.setState({ isReadOnly: isStudioWorkflowSettings(settings) })

        // Reconcile per-node `generatedResults` against the backend's
        // `jobs.output_data`. When a single-node run gets stuck → backend
        // reconcile finishes it → the frontend's poll wasn't around to see
        // the variant URLs, so the node has 1 result but the job actually
        // has N. This catches that case on every workflow load. Fire-and-
        // forget: the workflow becomes interactive immediately; updates land
        // a moment later as the jobs.get calls resolve. Safe to skip — the
        // user can manually re-run if reconciliation can't reach the job.
        const { updateNodeData: storeUpdateNodeData } = useWorkflowStore.getState()
        reconcileWorkflowNodeResults(nodes, storeUpdateNodeData).catch(() => {})

        // Prefetch model credit costs for all nodes in one batch request
        const modelIds = [...new Set(
          nodes
            .map((n) => (n.data as Record<string, unknown>).provider as string | undefined)
            .filter(Boolean) as string[],
        )]
        if (modelIds.length > 0) {
          prefetchModelCredits(modelIds).catch(() => {})
        }

        // If nodes were updated during sync, save the updated workflow.
        // Order parent-first: loadWorkflow heals the store's copy, but this
        // local `nodes` array was never reordered, so without this the re-save
        // would re-persist a child-before-parent order to the DB.
        //
        // Capture the side-save's returned `updated_at` and advance the
        // optimistic-lock cursor — otherwise the next user-driven autosave
        // would send the pre-side-save version and 0-row-conflict against
        // the row we just bumped here ourselves.
        if (nodesChanged && projectId) {
          const { data: sideSaved, error: saveError } = await supabase
            .from("workflows")
            .update({ nodes: JSON.parse(JSON.stringify(orderNodesParentFirst(nodes))) })
            .eq("id", id)
            .select("updated_at")
            .maybeSingle()

          if (saveError) {
            toast.error("Failed to save synced nodes")
          } else if (sideSaved?.updated_at) {
            setLoadedUpdatedAt(sideSaved.updated_at as string)
          }
        }

        return {
          success: true,
          stillRunningJobs: syncResult.stillRunningJobs,
          activeBackendExecution,
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Failed to load",
        }
      } finally {
        setLoading(false)
        setIsWorkflowLoading(false)
      }
    },
    [loadWorkflow, projectId, setIsWorkflowLoading, setLoadedUpdatedAt, setRemoteUpdatedAt],
  )

  // Refresh the ref pointer on every render — read by the save-on-
  // conflict toast's "Reload" action. Same pattern as the realtime
  // sync hook's callback refs (avoids a circular `useCallback` dep
  // between `save` and `load`).
  loadRef.current = load

  // Cleanup fade timer on unmount
  useEffect(() => {
    return () => {
      if (savedFadeTimerRef.current) {
        clearTimeout(savedFadeTimerRef.current)
      }
    }
  }, [])

  return { save, load, saving, loading }
}
