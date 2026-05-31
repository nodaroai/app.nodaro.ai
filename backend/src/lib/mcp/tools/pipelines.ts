import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import {
  PIPELINE_STAGE_NAMES,
  PIPELINE_FORMATS,
  PIPELINE_MODES,
  PIPELINE_OUTPUT_RESOLUTIONS,
  PipelineInputSchema,
  CHAT_ENABLED_STAGES,
  CHAT_TURN_CAPS,
  type ChatEnabledStage,
  type JsonPatch,
  type ProposedChange,
} from "@nodaro/shared"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { randomUUID } from "node:crypto"

const executeGate: ToolGate = { required: ["pipelines:execute"] }
const approveGate: ToolGate = { required: ["pipelines:approve"] }
const readGate: ToolGate = { required: ["pipelines:read"] }

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

function okJson(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] }
}

/**
 * Pipeline tools — Phase 1D.3 + Phase 1D.2b §5.10.
 *
 * `branch_pipeline` is gated by `pipelines:execute`. It calls the
 * `branchPipeline` service directly (same in-process path as the HTTP route
 * at `POST /v1/pipelines/:id/branch`).
 *
 * `chat_pipeline_stage`, `apply_chat_proposal`, `get_pipeline_stage_chat` are
 * gated by `pipelines:approve` / `pipelines:read`. They mirror the HTTP route
 * handlers in `backend/src/routes/pipelines.ts` step-for-step but call the
 * service-layer helpers directly (`runChatRefineShowrunner`, `applyStageEdit`)
 * to avoid an HTTP roundtrip. TODO Phase 1D.2c: extract a shared chat-stage
 * service helper so the route + this MCP tool share a single implementation.
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

    // ── start_pipeline (pipelines:execute) ───────────────────────────────────
    // Phase 2 (§7.1) — the programmatic entry an agent uses to drive the engine.
    // Calls the shared createPipeline service (same path as POST /v1/pipelines).
    server.registerTool(
      "start_pipeline",
      {
        title: "Start Pipeline",
        description:
          "Start a new Story->Video pipeline from a prompt. The engine runs autonomously (default mode 'auto' completes end-to-end). Returns the new pipeline id; subscribe to events / poll status to watch progress.",
        inputSchema: {
          story_prompt: z
            .string()
            .min(1)
            .max(4000)
            .describe("What the film is about."),
          target_duration_seconds: z
            .number()
            .int()
            .min(5)
            .max(600)
            .default(15)
            .describe("Total film length in seconds (5-600)."),
          format: z.enum(PIPELINE_FORMATS).default("reel").describe("Film format."),
          mode: z
            .enum(PIPELINE_MODES)
            .default("auto")
            .describe(
              "'auto' runs end-to-end unattended; 'manual'/'guided' pause at approval gates.",
            ),
          output_resolution: z.enum(PIPELINE_OUTPUT_RESOLUTIONS).default("720p"),
          music_enabled: z.boolean().default(true),
          // Off by default for agent runs (the HTTP route defaults narration/
          // lipsync ON) — autonomous runs shouldn't silently incur those credits.
          narration_enabled: z.boolean().default(false),
          lipsync_enabled: z.boolean().default(false),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (args) => {
        try {
          const { createPipeline } = await import(
            "../../../ee/pipelines/create-pipeline.js"
          )
          // No canvas node in the agent/MCP context — synthesize a root id; the
          // engine's canvas-node materialization is a no-op when none exists.
          const input = PipelineInputSchema.parse({
            pipeline_type: "story_to_video",
            root_node_id: randomUUID(),
            story_prompt: args.story_prompt,
            target_duration_seconds: args.target_duration_seconds,
            format: args.format,
            mode: args.mode,
            output_resolution: args.output_resolution,
            config: {
              music_enabled: args.music_enabled,
              narration_enabled: args.narration_enabled,
              lipsync_enabled: args.lipsync_enabled,
            },
          })
          const result = await createPipeline({
            supabase,
            userId: session.userId,
            input,
          })
          if (!result.ok) {
            return err(
              `Could not start pipeline (${result.code})` +
                (result.message ? `: ${result.message}` : ""),
            )
          }
          return okJson({
            pipeline_id: result.pipelineId,
            status: "queued",
            mode: input.mode,
          })
        } catch (e) {
          return err(
            `start_pipeline failed: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      },
    )
  }

  // ── chat_pipeline_stage (pipelines:approve) ──────────────────────────────
  if (passesGate(session, approveGate)) {
    server.registerTool(
      "chat_pipeline_stage",
      {
        title: "Chat Pipeline Stage",
        description:
          "Send a chat message to the Showrunner Refinement Director for a stage that is awaiting approval. Pipeline must be in 'guided' mode. Returns the assistant's reply and optional proposed_change (json_patch) the user can apply via apply_chat_proposal.",
        inputSchema: {
          pipeline_id: z.string().uuid().describe("The id of the pipeline"),
          stage: z
            .enum(CHAT_ENABLED_STAGES as unknown as [string, ...string[]])
            .describe(
              "The stage to chat with — must be awaiting_approval. Only 'script' is wired in Phase 1D.2b.",
            ),
          message: z
            .string()
            .min(1)
            .max(8000)
            .describe("The user message to send to the refinement director"),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (args) => {
        const stageName = args.stage as ChatEnabledStage

        // Only Script chat ships in 1D.2b — mirror the route's 501 guard.
        if (stageName !== "script") {
          return err(
            `Chat specialist not implemented for stage '${stageName}'. Only 'script' is wired in Phase 1D.2b.`,
          )
        }

        // 1. Pipeline ownership + mode='guided' check.
        const { data: pipeline } = await supabase
          .from("pipelines")
          .select("user_id, mode")
          .eq("id", args.pipeline_id)
          .maybeSingle()
        if (!pipeline || pipeline.user_id !== session.userId) {
          return err(`Pipeline ${args.pipeline_id} not found.`)
        }
        if (pipeline.mode !== "guided") {
          return err(
            `Chat unavailable: pipeline ${args.pipeline_id} is not in 'guided' mode.`,
          )
        }

        // 2. Stage row lookup + awaiting_approval check.
        const { data: stageRow } = await supabase
          .from("pipeline_stages")
          .select("id, status, output")
          .eq("pipeline_id", args.pipeline_id)
          .eq("stage_name", stageName)
          .maybeSingle()
        if (!stageRow) {
          return err(
            `Chat unavailable: stage '${stageName}' has not been started yet.`,
          )
        }
        if (stageRow.status !== "awaiting_approval") {
          return err(
            `Chat unavailable: stage '${stageName}' is in status '${stageRow.status}', not 'awaiting_approval'.`,
          )
        }

        // 3. Turn-cap check.
        const { count: userTurnCount } = await supabase
          .from("pipeline_chat_turns")
          .select("id", { count: "exact", head: true })
          .eq("pipeline_stage_id", stageRow.id)
          .eq("role", "user")
        if ((userTurnCount ?? 0) >= CHAT_TURN_CAPS[stageName]) {
          return err(
            `Chat turn cap reached for stage '${stageName}' (cap: ${CHAT_TURN_CAPS[stageName]}).`,
          )
        }

        // 4. Compute next turn_n.
        const { data: maxRow } = await supabase
          .from("pipeline_chat_turns")
          .select("turn_n")
          .eq("pipeline_stage_id", stageRow.id)
          .order("turn_n", { ascending: false })
          .limit(1)
          .maybeSingle()
        const nextTurnN = (maxRow?.turn_n ?? 0) + 1

        // 5. INSERT user turn.
        const { data: userTurn, error: userInsertErr } = await supabase
          .from("pipeline_chat_turns")
          .insert({
            pipeline_stage_id: stageRow.id,
            turn_n: nextTurnN,
            role: "user",
            content: args.message,
          })
          .select("id")
          .single()
        if (userInsertErr || !userTurn) {
          return err(
            `Failed to persist user turn: ${userInsertErr?.message ?? "no row"}.`,
          )
        }

        // 6. Load prior turns + current plan.
        const { data: priorTurns } = await supabase
          .from("pipeline_chat_turns")
          .select("role, content, turn_n")
          .eq("pipeline_stage_id", stageRow.id)
          .order("turn_n", { ascending: true })
        const historyTurns = (priorTurns ?? [])
          .filter((t: { turn_n: number }) => t.turn_n < nextTurnN)
          .map((t: { role: string; content: string }) => ({
            role: t.role as "user" | "assistant",
            content: t.content as string,
          }))

        const stageOutput = (stageRow.output as { plan?: unknown } | null) ?? {}
        const currentPlan = (stageOutput as { plan?: unknown }).plan

        // 7. Call the specialist via dynamic import (preserves core→ee boundary).
        const { runChatRefineShowrunner } = await import(
          "../../../ee/pipelines/llms/chat-refine-showrunner.js"
        )
        let result: Awaited<ReturnType<typeof runChatRefineShowrunner>>
        try {
          result = await runChatRefineShowrunner({
            supabase,
            pipelineId: args.pipeline_id,
            stageId: stageRow.id as string,
            userId: session.userId,
            currentPlan: currentPlan as never,
            priorTurns: historyTurns,
            userMessage: args.message,
          })
        } catch {
          return err(
            "LLM unavailable: the refinement director failed to produce a response. The user turn has been persisted — please retry.",
          )
        }

        // 8. INSERT assistant turn.
        const assistantTurnN = nextTurnN + 1
        const proposedChange = result.response.proposed_change ?? null
        const { data: assistantTurn, error: assistantInsertErr } = await supabase
          .from("pipeline_chat_turns")
          .insert({
            pipeline_stage_id: stageRow.id,
            turn_n: assistantTurnN,
            role: "assistant",
            content: result.response.reply,
            proposed_change: proposedChange,
            llm_call_id: result.llmCallId,
          })
          .select("id")
          .single()
        if (assistantInsertErr || !assistantTurn) {
          return err(
            `Failed to persist assistant turn: ${assistantInsertErr?.message ?? "no row"}.`,
          )
        }

        // 9. SSE — publish the full assistant turn (mirror the route).
        const { pipelineEvents } = await import("../../../ee/pipelines/events.js")
        pipelineEvents.publish({
          type: "chat:turn",
          pipelineId: args.pipeline_id,
          stageName,
          turn: {
            id: assistantTurn.id as string,
            turn_n: assistantTurnN,
            role: "assistant",
            content: result.response.reply,
            proposed_change: proposedChange as ProposedChange | null,
          },
        })

        return okJson({
          turnId: assistantTurn.id,
          role: "assistant",
          content: result.response.reply,
          proposed_change: proposedChange,
        })
      },
    )

    // ── apply_chat_proposal (pipelines:approve) ──────────────────────────────
    server.registerTool(
      "apply_chat_proposal",
      {
        title: "Apply Chat Proposal",
        description:
          "Accept a proposed edit_artifact change from a prior assistant chat turn. Validates the JSON Patch, inserts a new pipeline_stage_attempts row, and advances the stage to approved.",
        inputSchema: {
          pipeline_id: z.string().uuid().describe("The id of the pipeline"),
          stage: z
            .enum(CHAT_ENABLED_STAGES as unknown as [string, ...string[]])
            .describe("The stage the chat turn belongs to"),
          turn_id: z
            .string()
            .uuid()
            .describe(
              "The id of the assistant turn whose proposed_change you want to apply",
            ),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (args) => {
        const stageName = args.stage as ChatEnabledStage

        if (stageName !== "script") {
          return err(
            `Chat specialist not implemented for stage '${stageName}'. Only 'script' is wired in Phase 1D.2b.`,
          )
        }

        // 1. Pipeline ownership check.
        const { data: pipeline } = await supabase
          .from("pipelines")
          .select("user_id")
          .eq("id", args.pipeline_id)
          .maybeSingle()
        if (!pipeline || pipeline.user_id !== session.userId) {
          return err(`Pipeline ${args.pipeline_id} not found.`)
        }

        // 2. Look up the turn.
        const { data: turn } = await supabase
          .from("pipeline_chat_turns")
          .select(
            "id, pipeline_stage_id, role, proposed_change, applied_to_attempt_id, llm_call_id",
          )
          .eq("id", args.turn_id)
          .maybeSingle()
        if (!turn) {
          return err(`Turn ${args.turn_id} not found.`)
        }
        if (turn.applied_to_attempt_id) {
          return err(
            `Turn ${args.turn_id} has already been applied (attempt ${turn.applied_to_attempt_id}).`,
          )
        }
        const proposedChange = turn.proposed_change as ProposedChange | null
        if (
          turn.role !== "assistant" ||
          !proposedChange ||
          proposedChange.change_type !== "edit_artifact"
        ) {
          return err(
            `Turn ${args.turn_id} is not applyable: must be an assistant turn with an edit_artifact proposed_change.`,
          )
        }

        // 3. Call the unified applyStageEdit helper.
        const { applyStageEdit } = await import(
          "../../../ee/pipelines/chat/apply-stage-edit.js"
        )
        const result = await applyStageEdit({
          supabase,
          pipelineId: args.pipeline_id,
          stageName,
          stageId: turn.pipeline_stage_id as string,
          userId: session.userId,
          jsonPatch: proposedChange.json_patch as JsonPatch,
          source: "chat_apply",
          chatTurnId: turn.id as string,
          llmCallId: (turn.llm_call_id as string | null) ?? undefined,
        })

        if (result.ok) {
          return okJson({
            applied: true,
            attemptId: result.newAttemptId,
            newOutput: result.newOutput,
          })
        }

        // Surface failures as MCP errors with the reason code in the message.
        const reasonMessages: Record<string, string> = {
          stage_not_awaiting: `Apply failed: stage '${stageName}' is no longer awaiting approval (may have been concurrently approved).`,
          patch_invalid: "Apply failed: proposed JSON Patch is invalid.",
          schema_invalid:
            "Apply failed: proposed change does not satisfy the stage schema. A follow-up assistant turn has been added with a hint.",
          reference_integrity_failed:
            "Apply failed: proposed change would leave dangling references to a removed cast/location/object entry. A follow-up assistant turn has been added with a hint.",
        }
        return err(reasonMessages[result.reason] ?? `Apply failed: ${result.reason}`)
      },
    )
  }

  // ── get_pipeline_stage_chat (pipelines:read) ─────────────────────────────
  if (passesGate(session, readGate)) {
    server.registerTool(
      "get_pipeline_stage_chat",
      {
        title: "Get Pipeline Stage Chat",
        description:
          "List all chat turns for a pipeline stage, ordered by turn_n ascending. Returns an empty array when no turns exist (e.g., stage not started or no messages sent yet).",
        inputSchema: {
          pipeline_id: z.string().uuid().describe("The id of the pipeline"),
          stage: z
            .enum(CHAT_ENABLED_STAGES as unknown as [string, ...string[]])
            .describe("The chat-enabled stage to list turns for"),
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (args) => {
        const stageName = args.stage as ChatEnabledStage

        // 1. Pipeline ownership check.
        const { data: pipeline } = await supabase
          .from("pipelines")
          .select("user_id")
          .eq("id", args.pipeline_id)
          .maybeSingle()
        if (!pipeline || pipeline.user_id !== session.userId) {
          return err(`Pipeline ${args.pipeline_id} not found.`)
        }

        // 2. Look up the stage row.
        const { data: stageRow } = await supabase
          .from("pipeline_stages")
          .select("id")
          .eq("pipeline_id", args.pipeline_id)
          .eq("stage_name", stageName)
          .maybeSingle()
        if (!stageRow) {
          return okJson({ turns: [] })
        }

        // 3. Select turns ordered by turn_n ascending.
        const { data: turns, error } = await supabase
          .from("pipeline_chat_turns")
          .select(
            "id, turn_n, role, content, proposed_change, applied_to_attempt_id, llm_call_id, created_at",
          )
          .eq("pipeline_stage_id", stageRow.id)
          .order("turn_n", { ascending: true })
        if (error) {
          return err(`Failed to load chat history: ${error.message}`)
        }
        return okJson({ turns: turns ?? [] })
      },
    )
  }
}
