"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

interface SaveResult {
  readonly success: boolean
  readonly error?: string
}

const SAVED_DISPLAY_DURATION = 2000

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

      const { workflowId, workflowName, nodes, edges } =
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

        loadWorkflow(
          data.id,
          data.name,
          data.nodes as WorkflowNode[],
          data.edges as WorkflowEdge[],
        )
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
    [loadWorkflow],
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
