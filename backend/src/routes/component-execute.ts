import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { executeAppRun } from "../services/app-execution.js"
import { OUTPUT_FIELD_MAP } from "../../../packages/shared/src/component-types.js"
import type { ComponentMetadata } from "../../../packages/shared/src/component-types.js"
import { JOB_POLL_INTERVAL_MS, POLL_ABSOLUTE_TIMEOUT_MS } from "../services/workflow-engine/types.js"

const bodySchema = z.object({
  appSlug: z.string().min(1),
  inputOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  pinnedVersion: z.number().int().positive().optional(),
  workflowId: z.string().uuid().optional(),
  componentDepth: z.number().int().min(0).max(5).optional(),
  executingComponentIds: z.array(z.string()).optional(),
})

async function updateWrapperJob(jobId: string, fields: Record<string, unknown>) {
  await supabase.from("jobs").update({ ...fields, completed_at: new Date().toISOString() }).eq("id", jobId)
}

export async function componentExecuteRoutes(app: FastifyInstance) {
  app.post("/v1/component/execute", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }

    const { appSlug, inputOverrides, pinnedVersion, workflowId, componentDepth, executingComponentIds } = parsed.data

    // Look up published app by slug
    let appQuery = supabase
      .from("published_apps")
      .select("id, workflow_id, name, component_metadata, estimated_credits, snapshot_nodes, snapshot_edges, snapshot_settings")
      .eq("slug", appSlug)
      .eq("publish_type", "component")
      .eq("is_active", true)

    if (pinnedVersion) {
      appQuery = appQuery.eq("version", pinnedVersion)
    } else {
      appQuery = appQuery.order("version", { ascending: false }).limit(1)
    }

    const { data: appRows } = await appQuery
    const appRow = appRows?.[0]
    if (!appRow) {
      return reply.status(404).send({ error: { code: "not_found", message: "Component not found" } })
    }

    const componentMetadata = appRow.component_metadata as ComponentMetadata | null
    if (!componentMetadata) {
      return reply.status(400).send({ error: { code: "invalid_component", message: "Component metadata missing" } })
    }

    // Create wrapper job
    const { data: wrapperJob, error: jobError } = await supabase
      .from("jobs")
      .insert({
        user_id: req.userId,
        provider: "component",
        status: "processing",
        input_data: {
          componentName: appRow.name,
          appSlug,
          inputs: inputOverrides ?? {},
        },
        ...(workflowId ? { workflow_id: workflowId } : {}),
      })
      .select("id")
      .single()

    if (jobError || !wrapperJob) {
      return reply.status(500).send({ error: { code: "internal_error", message: "Failed to create component job" } })
    }

    // Return immediately — run inner execution in background
    reply.status(202).send({ jobId: wrapperJob.id })

    // Background: execute inner workflow, poll status, update wrapper job
    setImmediate(async () => {
      try {
        const result = await executeAppRun({
          appVersionId: appRow.id,
          workflowId: appRow.workflow_id as string,
          userId: req.userId!,
          appId: appRow.id as string,
          inputOverrides,
          isComponentExecution: true,
          componentDepth,
          executingComponentIds,
        })

        const startTime = Date.now()
        while (Date.now() - startTime < POLL_ABSOLUTE_TIMEOUT_MS) {
          // Poll status only — avoid transferring large node_states JSONB on every tick
          const { data: exec } = await supabase
            .from("workflow_executions")
            .select("status")
            .eq("id", result.executionId)
            .single()

          if (!exec) break

          if (exec.status === "completed" || exec.status === "failed") {
            // Fetch full data only on terminal status
            const { data: fullExec } = await supabase
              .from("workflow_executions")
              .select("status, node_states, total_credits_used, error_message")
              .eq("id", result.executionId)
              .single()

            if (fullExec?.status === "completed") {
              const nodeStates = (fullExec.node_states ?? {}) as Record<string, { output?: Record<string, unknown> }>
              const outputData: Record<string, string> = {}

              for (const handle of componentMetadata.outputs) {
                const nodeState = nodeStates[handle.id]
                const fieldKey = handle.fieldKey || OUTPUT_FIELD_MAP[handle.type] || handle.type
                const value = nodeState?.output?.[fieldKey]
                if (value && typeof value === "string") {
                  outputData[handle.id] = value
                }
              }

              await updateWrapperJob(wrapperJob.id, {
                status: "completed",
                output_data: outputData,
                credits_actual: fullExec.total_credits_used ?? 0,
              })
            } else {
              await updateWrapperJob(wrapperJob.id, {
                status: "failed",
                error_message: fullExec?.error_message ?? "Component execution failed",
              })
            }
            return
          }

          await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS))
        }

        await updateWrapperJob(wrapperJob.id, { status: "failed", error_message: "Component execution timed out" })
      } catch (err) {
        await updateWrapperJob(wrapperJob.id, {
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
        })
      }
    })
  })
}
