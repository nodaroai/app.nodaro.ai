import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { PIPELINE_STAGE_NAMES } from "@nodaro/shared"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"

const executeGate: ToolGate = { required: ["pipelines:execute"] }

export interface RegisterPipelineToolsOpts {
  server: McpServer
  session: McpSession
}

/** Standard MCP error shape. */
function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

/**
 * Pipeline tools — Phase 1D.3.
 *
 * `branch_pipeline` is gated by `pipelines:execute`. It calls the
 * `branchPipeline` service directly (same in-process path as the HTTP route
 * at `POST /v1/pipelines/:id/branch`).
 */
export function registerPipelineTools({ server, session }: RegisterPipelineToolsOpts): void {
  if (passesGate(session, executeGate)) {
    server.registerTool(
      "branch_pipeline",
      {
        title: "Branch Pipeline",
        description:
          "Create a new pipeline by re-running from a completed stage. The original pipeline's upstream stages and entities are cloned; the new pipeline starts running from the chosen stage. The source pipeline must have status='completed'.",
        inputSchema: {
          pipeline_id: z.string().uuid().describe("The id of the completed pipeline to branch from"),
          from_stage: z
            .enum(PIPELINE_STAGE_NAMES)
            .describe(
              "The stage to re-run from. Upstream stages are cloned as 'approved'; this stage and all downstream stages are fresh.",
            ),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (args) => {
        const { branchPipeline, BranchPipelineError } = await import(
          "../../../ee/pipelines/branch-pipeline.js"
        )
        try {
          const result = await branchPipeline({
            supabase,
            originalPipelineId: args.pipeline_id,
            fromStage: args.from_stage,
            userId: session.userId,
          })
          return ok(
            `Branched pipeline ${args.pipeline_id} from stage '${args.from_stage}'. ` +
              `New pipeline: ${result.newPipelineId}. ` +
              `Cloned ${result.clonedStages.length} stages + ${result.clonedEntities} entities.`,
          )
        } catch (e) {
          if (e instanceof BranchPipelineError) {
            const msgMap: Record<string, string> = {
              pipeline_not_found: `Pipeline ${args.pipeline_id} not found.`,
              pipeline_not_completed: `Pipeline ${args.pipeline_id} is not completed — only completed pipelines can be branched.`,
              forbidden: "You do not have permission to branch this pipeline.",
              invalid_stage: `Unknown stage: ${args.from_stage}`,
            }
            return err(msgMap[e.code] ?? `Branch failed: ${e.message}`)
          }
          throw e
        }
      },
    )
  }
}
