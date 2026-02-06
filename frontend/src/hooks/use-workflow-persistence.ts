"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getBatchJobStatus, type BatchJobStatus } from "@/lib/api"
import type { WorkflowNode, WorkflowEdge, CharacterDefinition, GeneratedResult } from "@/types/nodes"

interface SaveResult {
  readonly success: boolean
  readonly error?: string
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
async function syncNodeResultsFromDB(nodes: WorkflowNode[]): Promise<WorkflowNode[]> {
  // Find all nodes that might need syncing:
  // 1. Nodes with executionStatus === "running" or "pending"
  // 2. Nodes with generatedResults that have jobIds we can check
  const nodesToSync: { node: WorkflowNode; jobIds: string[] }[] = []

  for (const node of nodes) {
    const data = node.data as Record<string, unknown>
    const status = data.executionStatus as string | undefined
    const results = (data.generatedResults ?? []) as GeneratedResult[]

    // Collect jobIds from this node (only valid UUIDs, skip imported/local IDs)
    const jobIds = results
      .map(r => r.jobId)
      .filter((id): id is string => Boolean(id) && isValidUuid(id))

    // If node is in running/pending state or has jobs to check
    if (status === "running" || status === "pending" || jobIds.length > 0) {
      nodesToSync.push({ node, jobIds })
    }
  }

  if (nodesToSync.length === 0) {
    return nodes
  }

  // Collect all unique jobIds
  const allJobIds = [...new Set(nodesToSync.flatMap(n => n.jobIds))]

  if (allJobIds.length === 0) {
    // No jobIds to check - just reset running/pending nodes to idle
    return nodes.map(node => {
      const data = node.data as Record<string, unknown>
      const status = data.executionStatus as string | undefined
      if (status === "running" || status === "pending") {
        return {
          ...node,
          data: { ...data, executionStatus: "idle" }
        }
      }
      return node
    })
  }

  // Query all jobs at once via backend API
  let jobs: BatchJobStatus[]
  try {
    jobs = await getBatchJobStatus(allJobIds)
  } catch (err) {
    // Ignore abort errors (component unmounted during fetch)
    if (err instanceof DOMException && err.name === "AbortError") {
      return nodes
    }
    console.error("[sync] Failed to fetch jobs:", err)
    return nodes
  }

  // Create a map of jobId -> job for quick lookup
  const jobMap = new Map<string, BatchJobStatus>()
  for (const job of jobs) {
    jobMap.set(job.id, job)
  }

  // Update nodes based on job status
  const updatedNodes = nodes.map(node => {
    const data = node.data as Record<string, unknown>
    const status = data.executionStatus as string | undefined
    const results = (data.generatedResults ?? []) as GeneratedResult[]

    // Check if this node needs updating
    if (status !== "running" && status !== "pending") {
      return node
    }

    // Find the most recent job for this node
    const mostRecentResult = results[0]
    if (!mostRecentResult?.jobId) {
      // No job to check - reset to idle
      return {
        ...node,
        data: { ...data, executionStatus: "idle" }
      }
    }

    const job = jobMap.get(mostRecentResult.jobId)
    if (!job) {
      // Job not found - reset to idle
      return {
        ...node,
        data: { ...data, executionStatus: "idle" }
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

      const newData: Record<string, unknown> = {
        ...data,
        executionStatus: "completed",
        generatedResults: updatedResults,
        activeResultIndex: 0,
      }

      // Set the appropriate URL field based on node type
      if (job.output_data?.imageUrl) {
        newData.generatedImageUrl = job.output_data.imageUrl
      } else if (job.output_data?.videoUrl) {
        newData.generatedVideoUrl = job.output_data.videoUrl
      } else if (job.output_data?.audioUrl) {
        newData.generatedAudioUrl = job.output_data.audioUrl
      } else if (job.output_data?.script) {
        newData.generatedScript = job.output_data.script
      }

      console.log(`[sync] Updated node ${node.id} with completed job ${job.id}`)
      return { ...node, data: newData }
    } else if (job.status === "failed") {
      // Job failed - update node with error
      console.log(`[sync] Updated node ${node.id} with failed job ${job.id}`)
      return {
        ...node,
        data: {
          ...data,
          executionStatus: "failed",
          errorMessage: job.error_message ?? "Job failed"
        }
      }
    } else if (job.status === "cancelled") {
      // Job was cancelled - reset to idle
      console.log(`[sync] Updated node ${node.id} - job ${job.id} was cancelled`)
      return {
        ...node,
        data: { ...data, executionStatus: "idle" }
      }
    }

    // Job is still pending/processing - keep as running
    return node
  })

  return updatedNodes
}

export function useWorkflowPersistence(projectId?: string) {
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const savedFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow)
  const setWorkflowId = useWorkflowStore((s) => s.setWorkflowId)
  const markClean = useWorkflowStore((s) => s.markClean)
  const setSaveStatus = useWorkflowStore((s) => s.setSaveStatus)

  const save = useCallback(
    async (pid?: string): Promise<SaveResult> => {
      const resolvedProjectId = pid ?? projectId
      if (!resolvedProjectId) return { success: false, error: "No project ID" }

      const { workflowId, workflowName, nodes, edges, characterDefinitions } =
        useWorkflowStore.getState()

      // Don't save empty workflows
      if (nodes.length === 0) return { success: false, error: "Empty workflow" }

      setSaving(true)
      setSaveStatus("saving")
      try {
        const supabase = createClient()

        const payload = {
          project_id: resolvedProjectId,
          name: workflowName,
          nodes: JSON.parse(JSON.stringify(nodes)),
          edges: JSON.parse(JSON.stringify(edges)),
          settings: { characterDefinitions: JSON.parse(JSON.stringify(characterDefinitions)) },
        }

        if (workflowId) {
          const { error } = await supabase
            .from("workflows")
            .update(payload)
            .eq("id", workflowId)

          if (error) {
            setSaveStatus("error", error.message)
            return { success: false, error: error.message }
          }
        } else {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) {
            setSaveStatus("error", "Not authenticated")
            return { success: false, error: "Not authenticated" }
          }

          const { data, error } = await supabase
            .from("workflows")
            .insert({ ...payload, user_id: user.id })
            .select("id")
            .single()

          if (error) {
            setSaveStatus("error", error.message)
            return { success: false, error: error.message }
          }
          setWorkflowId(data.id)
        }

        markClean()
        setSaveStatus("saved")

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
    [projectId, setWorkflowId, markClean, setSaveStatus],
  )

  const load = useCallback(
    async (id: string): Promise<SaveResult> => {
      setLoading(true)
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
        let nodes = data.nodes as WorkflowNode[]
        const edges = data.edges as WorkflowEdge[]

        // Sync node results from jobs table via backend API
        // This handles the case where user left while jobs were running
        const syncedNodes = await syncNodeResultsFromDB(nodes)
        const nodesChanged = JSON.stringify(syncedNodes) !== JSON.stringify(nodes)
        nodes = syncedNodes

        loadWorkflow(
          data.id,
          data.name,
          nodes,
          edges,
          charDefs,
        )

        // If nodes were updated during sync, save the updated workflow
        if (nodesChanged && projectId) {
          console.log("[sync] Nodes were updated, saving workflow...")
          const { error: saveError } = await supabase
            .from("workflows")
            .update({ nodes: JSON.parse(JSON.stringify(nodes)) })
            .eq("id", id)

          if (saveError) {
            console.error("[sync] Failed to save synced nodes:", saveError)
          }
        }

        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Failed to load",
        }
      } finally {
        setLoading(false)
      }
    },
    [loadWorkflow, projectId],
  )

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
