"use client"

import { useCallback, useState } from "react"
import { createClient } from "@/lib/supabase"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

interface SaveResult {
  readonly success: boolean
  readonly error?: string
}

export function useWorkflowPersistence() {
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const {
    workflowId,
    workflowName,
    nodes,
    edges,
    setWorkflowId,
    loadWorkflow,
    markClean,
  } = useWorkflowStore()

  const save = useCallback(
    async (projectId: string): Promise<SaveResult> => {
      setSaving(true)
      try {
        const supabase = createClient()

        const payload = {
          project_id: projectId,
          name: workflowName,
          nodes: JSON.parse(JSON.stringify(nodes)),
          edges: JSON.parse(JSON.stringify(edges)),
        }

        if (workflowId) {
          const { error } = await supabase
            .from("workflows")
            .update(payload)
            .eq("id", workflowId)

          if (error) return { success: false, error: error.message }
        } else {
          const { data, error } = await supabase
            .from("workflows")
            .insert(payload)
            .select("id")
            .single()

          if (error) return { success: false, error: error.message }
          setWorkflowId(data.id)
        }

        markClean()
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Failed to save",
        }
      } finally {
        setSaving(false)
      }
    },
    [workflowId, workflowName, nodes, edges, setWorkflowId, markClean],
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

  return { save, load, saving, loading }
}
