import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { z } from "zod"
import {
  CHAT_ENABLED_STAGES,
  CHAT_TURN_CAPS,
  CHAT_WIRED_STAGES,
  ENTITY_TYPES,
  EntityRejectInputSchema,
  IMAGE_CRITIC_UNRESOLVABLE,
  PIPELINE_STAGE_NAMES,
  PipelineInputSchema,
  SubGateNameSchema,
  clearImageCriticMetadata,
  clearVideoCriticMetadata,
  type ChatEnabledStage,
  type EntityType,
  type JsonPatch,
  type PipelineStageName,
  type ProposedChange,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { hasCredits } from "../lib/config.js"
import { requireScope, type Scope } from "../lib/scopes.js"
import { createSSEStream } from "../lib/sse.js"
import { supabase } from "../lib/supabase.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const STAGE_NAMES: PipelineStageName[] = [
  "script",
  "characters",
  "objects",
  "locations",
  "shot_list",
  "scene_images",
  "animate_audio_edit",
  "post_merge",
]

/**
 * Phase 1D.2b E1: body schema for the stage-approve route. `edits` is an
 * optional RFC 6902 JSON Patch — when present and non-empty, the route
 * routes through `applyStageEdit` (audit-trail + per-stage Zod validation
 * + reference-integrity check). When absent or empty, the no-edits path
 * runs (CAS-flip approval).
 */
const ApproveStageBodySchema = z.object({
  edits: z
    .array(
      z.object({
        op: z.enum(["add", "remove", "replace"]),
        path: z.string().min(1),
        value: z.unknown().optional(),
      }),
    )
    .optional(),
})

/**
 * Phase 1 (granular-pipeline-control spec) — body schema for the save-only
 * inline edit route. `edits` is a non-empty RFC 6902 array (named to match
 * the sibling `approve` route's `edits` field). Ops are `replace` only in
 * Phase 1 (path whitelist + op restriction further enforced inside
 * `saveStageEdit`).
 */
/**
 * Phase 3 (granular-pipeline-control spec) — body for Step A approval.
 * Discriminated union on `mode`:
 *
 *   { mode: 'llm' }
 *     → No additional fields. Approves the LLM-derived description as-is.
 *
 *   { mode: 'user_edited', description: <string> }
 *     → User rewrote the description. The new text overwrites
 *       metadata.visual_description before the entity is flipped to pending.
 *       Cap at 2000 chars (the realistic ceiling for a character description
 *       — much longer is a sign the user pasted a script).
 *
 *   { mode: 'upload', asset_url: <r2 URL>, filename?, mime_type?, size_bytes? }
 *     → Client uploaded their own image via /v1/upload/image first. Optional
 *       filename/mime_type/size_bytes are derived from the URL when omitted.
 */
const ApproveDescriptionBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("llm") }),
  z.object({
    mode: z.literal("user_edited"),
    description: z.string().min(1).max(2000),
  }),
  z.object({
    mode: z.literal("upload"),
    asset_url: z.string().url(),
    filename: z.string().min(1).max(255).optional(),
    mime_type: z.string().min(1).max(100).optional(),
    size_bytes: z.number().int().min(0).optional(),
  }),
])

const SaveStageEditBodySchema = z.object({
  edits: z
    .array(
      z.object({
        op: z.enum(["replace"]),
        path: z.string().min(1),
        value: z.unknown(),
      }),
    )
    .min(1)
    .max(50),
})

/**
 * Phase 2 (granular-pipeline-control spec) — body schema for the
 * regenerate-scene route. `sceneIndex` is 0-based against plan.scenes.
 * `feedback` is free-form user guidance (e.g. "make it more tense",
 * "shorter — 4 seconds"). 2000 char cap mirrors the chat route's user
 * turn cap so the LLM doesn't get pages of guidance per scene.
 */
const RegenerateSceneBodySchema = z.object({
  sceneIndex: z.number().int().min(0),
  feedback: z.string().min(1).max(2000),
})

function gateEdition(reply: FastifyReply): boolean {
  if (!hasCredits()) {
    void reply.status(403).send({
      error: { code: "edition_required", required_edition: "cloud" },
    })
    return false
  }
  return true
}

/**
 * Scope check that mirrors the convention used by other routes (e.g. workflows.ts):
 * scopes are only enforced for the OAuth dev-app path (`req.appAuthorization`).
 * JWT-authenticated users own their resources and bypass scope checks.
 */
function gateScope(req: FastifyRequest, reply: FastifyReply, scope: Scope): boolean {
  if (!req.appAuthorization) return true
  const err = requireScope(req.appAuthorization.scopes, scope)
  if (err) {
    void reply.status(err.statusCode).send(err.body)
    return false
  }
  return true
}

function gateAuth(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.userId) {
    void reply.status(401).send({ error: { code: "unauthorized" } })
    return null
  }
  return req.userId
}

export async function pipelinesRoutes(app: FastifyInstance) {
  // ── POST /v1/pipelines ───────────────────────────────────────────────────
  app.post("/v1/pipelines", async (req, reply) => {
    if (!gateEdition(reply)) return
    if (!gateScope(req, reply, "pipelines:execute")) return
    const userId = gateAuth(req, reply)
    if (!userId) return

    const parsed = PipelineInputSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", issues: parsed.error.issues },
      })
    }
    const input = parsed.data

    // Create + reserve + enqueue via the shared service (also used by the MCP
    // `start_pipeline` tool so both paths share one tier guard + reservation).
    // Dynamic import keeps the core→ee boundary intact (same pattern the route
    // already uses for credits.js / queue.js).
    const { createPipeline } = await import("../ee/pipelines/create-pipeline.js")
    const result = await createPipeline({ supabase, userId, input })
    if (!result.ok) {
      const errBody: Record<string, unknown> = { code: result.code }
      if (result.message !== undefined) errBody.message = result.message
      if (result.detail !== undefined) errBody.detail = result.detail
      if (result.model !== undefined) errBody.model = result.model
      return reply.status(result.status).send({ error: errBody })
    }

    return reply.status(201).send({ id: result.pipelineId })
  })

  // ── GET /v1/pipelines/:id ────────────────────────────────────────────────
  app.get("/v1/pipelines/:id", async (req, reply) => {
    if (!gateEdition(reply)) return
    if (!gateScope(req, reply, "pipelines:read")) return
    const userId = gateAuth(req, reply)
    if (!userId) return

    const params = z.object({ id: z.string().uuid() }).safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({ error: { code: "validation_error" } })
    }
    const { data, error } = await supabase
      .from("pipelines")
      .select(
        "id,status,current_stage,spent_credits,reserved_credits,upfront_credit_estimate,user_id,branched_from_pipeline_id,branched_from_stage,mode,failure_reason,current_progress_message",
      )
      .eq("id", params.data.id)
      .maybeSingle()
    if (error) {
      return reply
        .status(500)
        .send({ error: { code: "db_error", detail: error.message } })
    }
    if (!data) return reply.status(404).send({ error: { code: "not_found" } })
    // Scope to caller — service-role client bypasses RLS so we enforce here.
    if (data.user_id !== userId) {
      return reply.status(404).send({ error: { code: "not_found" } })
    }
    const { user_id: _userId, ...publicFields } = data
    return publicFields
  })

  // ── PATCH /v1/pipelines/:id — mode switch (manual target only) ─────────
  // Phase 1D.2a §4.5. The user can flip an auto/guided run to manual at any
  // approval gate (or while it's still running between gates). Allowed
  // transitions: mode ∈ {auto, guided} AND status ∈ {running, awaiting_approval}.
  // Failed runs are NOT eligible — use Branch instead. Manual→manual is a no-op
  // and rejected for clarity (caller likely wanted a different target mode that
  // isn't yet implemented).
  app.patch<{ Params: { id: string }; Body: { mode: "manual" } }>(
    "/v1/pipelines/:id",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:execute")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const params = z.object({ id: z.string().uuid() }).safeParse(req.params)
      if (!params.success) {
        return reply.status(400).send({ error: { code: "validation_error" } })
      }
      const body = z.object({ mode: z.literal("manual") }).safeParse(req.body)
      if (!body.success) {
        return reply.status(400).send({
          error: { code: "validation_error", issues: body.error.issues },
        })
      }

      // Look up pipeline + ownership.
      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("user_id, mode, status")
        .eq("id", params.data.id)
        .maybeSingle()
      if (!pipeline || pipeline.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Validate transition: allowed from mode IN ('auto','guided')
      // AND status IN ('running','awaiting_approval'). Failed/completed/
      // cancelled/forked + manual source mode are rejected with 409.
      if (
        !["auto", "guided"].includes(pipeline.mode) ||
        !["running", "awaiting_approval"].includes(pipeline.status)
      ) {
        return reply.status(409).send({
          error: {
            code: "mode_transition_not_allowed",
            message: `cannot switch to manual from mode=${pipeline.mode} status=${pipeline.status}`,
          },
        })
      }

      // Flip mode.
      const { error: updateError } = await supabase
        .from("pipelines")
        .update({ mode: "manual" })
        .eq("id", params.data.id)
      if (updateError) {
        return reply.status(500).send({
          error: { code: "db_error", detail: updateError.message },
        })
      }

      // Re-enqueue so the orchestrator picks up the mode change and
      // re-evaluates the next-action policy (e.g. stop auto-approving).
      const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")
      await enqueuePipelineRun({
        pipelineId: params.data.id,
        userId,
        reason: "mode_switch",
      })

      // Emit SSE — status unchanged, but listeners may rerender the badge.
      const { pipelineEvents } = await import("../ee/pipelines/events.js")
      pipelineEvents.publish({
        type: "pipeline:status",
        pipelineId: params.data.id,
        status: pipeline.status,
      })

      return reply.send({ ok: true, mode: "manual" })
    },
  )

  // ── GET /v1/pipelines ────────────────────────────────────────────────────
  app.get("/v1/pipelines", async (req, reply) => {
    if (!gateEdition(reply)) return
    if (!gateScope(req, reply, "pipelines:read")) return
    const userId = gateAuth(req, reply)
    if (!userId) return

    const { data, error } = await supabase
      .from("pipelines")
      .select(
        "id,status,current_stage,spent_credits,reserved_credits,upfront_credit_estimate,created_at,input_prompt",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50)
    if (error) {
      return reply
        .status(500)
        .send({ error: { code: "db_error", detail: error.message } })
    }
    return data ?? []
  })

  // ── GET /v1/pipelines/:id/stages/:stage_name ─────────────────────────────
  app.get<{ Params: { id: string; stage_name: string } }>(
    "/v1/pipelines/:id/stages/:stage_name",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:read")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const stageName = req.params.stage_name as PipelineStageName
      if (!STAGE_NAMES.includes(stageName)) {
        return reply.status(404).send({ error: { code: "invalid_stage_name" } })
      }

      // Ownership check on the parent pipeline row.
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("status,output,critic_feedback,user_edits,started_at,completed_at")
        .eq("pipeline_id", req.params.id)
        .eq("stage_name", stageName)
        .maybeSingle()
      if (error) {
        return reply
          .status(500)
          .send({ error: { code: "db_error", detail: error.message } })
      }
      if (!data) return reply.status(404).send({ error: { code: "stage_not_started" } })
      return data
    },
  )

  // ── GET /v1/pipelines/:id/pending-approvals ──────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/v1/pipelines/:id/pending-approvals",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      // Ownership check.
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("stage_name,output")
        .eq("pipeline_id", req.params.id)
        .eq("status", "awaiting_approval")
      if (error) {
        return reply
          .status(500)
          .send({ error: { code: "db_error", detail: error.message } })
      }
      return data ?? []
    },
  )

  // ── POST /v1/pipelines/:id/cancel ────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    "/v1/pipelines/:id/cancel",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:execute")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const { refundPipelineCredits } = await import("../ee/pipelines/credits.js")
      const { pipelineEvents } = await import("../ee/pipelines/events.js")

      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("id,user_id,reserved_credits,spent_credits,status")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!pipeline) return reply.status(404).send({ error: { code: "not_found" } })
      if (pipeline.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }
      if (
        pipeline.status === "completed" ||
        pipeline.status === "cancelled" ||
        pipeline.status === "failed"
      ) {
        return reply.status(409).send({ error: { code: "already_terminal" } })
      }
      const cancelledAt = new Date().toISOString()
      await supabase
        .from("pipelines")
        .update({
          status: "cancelled",
          cancelled_at: cancelledAt,
          // Clear the transient progress banner — otherwise a stale
          // "Drafting plan…" message persists on the cancelled pipeline
          // for any refresh-survivor viewer.
          current_progress_message: null,
        })
        .eq("id", pipeline.id)

      // Propagate cancellation to in-flight pipeline_stages rows. Without
      // this, any stage that was actively running at cancel time stays
      // forever at `status='running'` in the DB — the worker can't update
      // it (the worker only knows about the pipeline-level cancel when it
      // re-enters drivePipeline for the next stage). Two visible symptoms
      // before this fix:
      //   - The admin /stuck-pipelines list keeps showing the pipeline
      //     because its stage row is stuck "running" past the cutoff.
      //   - If the user re-opens the pipeline panel, the script row says
      //     "Running…" even though the pipeline-level status is cancelled.
      // We also emit per-stage `stage:status cancelled` events so any open
      // SSE subscriber sees the row flip in real time.
      const { data: runningStages } = await supabase
        .from("pipeline_stages")
        .select("id, stage_name")
        .eq("pipeline_id", pipeline.id)
        .eq("status", "running")
      if (runningStages && runningStages.length > 0) {
        await supabase
          .from("pipeline_stages")
          .update({ status: "cancelled", completed_at: cancelledAt })
          .eq("pipeline_id", pipeline.id)
          .eq("status", "running")
        for (const stage of runningStages) {
          pipelineEvents.publish({
            type: "stage:status",
            pipelineId: pipeline.id,
            stageName: stage.stage_name as never,
            status: "cancelled",
          })
        }
      }

      const refund = Math.max(0, pipeline.reserved_credits - pipeline.spent_credits)
      if (refund > 0) {
        await refundPipelineCredits({
          supabase,
          userId: pipeline.user_id,
          pipelineId: pipeline.id,
          credits: refund,
          reason: "user_cancel",
        })
      }
      pipelineEvents.publish({
        type: "pipeline:status",
        pipelineId: pipeline.id,
        status: "cancelled",
      })
      return reply.send({ ok: true })
    },
  )

  // ── POST /v1/pipelines/:id/stages/:stage/approve ─────────────────────────
  //
  // Phase 1D.2b E1: generalized to call `approveStage(stageName, edits?)` for
  // any stage. `edits` is a JSON Patch — when present, routes through
  // `applyStageEdit` for validation + audit-trail attempt row; otherwise
  // performs the no-edits CAS-flip approval.
  app.post<{
    Params: { id: string; stage_name: string }
    Body: { edits?: unknown }
  }>(
    "/v1/pipelines/:id/stages/:stage_name/approve",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      // Validate stage_name against the canonical tuple. Cast to
      // PipelineStageName below is safe ONLY because we narrow here.
      const stageName = req.params.stage_name as PipelineStageName
      if (!(PIPELINE_STAGE_NAMES as readonly string[]).includes(stageName)) {
        return reply.status(400).send({
          error: { code: "invalid_stage_name", stage: req.params.stage_name },
        })
      }

      // Ownership check.
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Validate body — `edits` is an optional RFC 6902 JSON Patch.
      const body = ApproveStageBodySchema.safeParse(req.body ?? {})
      if (!body.success) {
        return reply.status(400).send({
          error: { code: "validation_error", issues: body.error.issues },
        })
      }

      const { approveStage } = await import("../ee/pipelines/engine.js")
      const result = await approveStage(
        supabase,
        req.params.id,
        stageName,
        userId,
        body.data.edits as JsonPatch | undefined,
      )
      if (!result.ok) return reply.status(409).send({ error: { code: result.reason } })
      return reply.send({ ok: true })
    },
  )

  // ── POST /v1/pipelines/:id/stages/:stage_name/edit ───────────────────────
  //
  // Phase 1 (granular-pipeline-control spec) — save-only inline editing for
  // Stage 1 scene fields. Applies the JSON Patch to pipeline_stages.output AND
  // appends the ops to pipeline_stages.user_edits (audit trail). DOES NOT
  // advance the stage — caller still has to hit /approve afterward.
  //
  // Allowed paths (script stage only — enforced in `saveStageEdit`):
  //   - /scenes/{n}/description
  //   - /scenes/{n}/duration_seconds
  //   - /scenes/{n}/emotional_beat
  //   - /scenes/{n}/dialogue/{m}/line
  // Other paths return 400 `patch_path_not_editable`. add/remove ops are
  // deferred (add-scene/delete-scene = Phase 5).
  app.post<{
    Params: { id: string; stage_name: string }
    Body: { edits?: unknown }
  }>(
    "/v1/pipelines/:id/stages/:stage_name/edit",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const stageName = req.params.stage_name as PipelineStageName
      if (!(PIPELINE_STAGE_NAMES as readonly string[]).includes(stageName)) {
        return reply.status(400).send({
          error: { code: "invalid_stage_name", stage: req.params.stage_name },
        })
      }

      const body = SaveStageEditBodySchema.safeParse(req.body ?? {})
      if (!body.success) {
        return reply.status(400).send({
          error: { code: "validation_error", issues: body.error.issues },
        })
      }

      // Ownership check on the parent pipeline row.
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Look up the stage row id — `saveStageEdit` takes stageId (not
      // pipeline+stage_name) to mirror `applyStageEdit`'s signature.
      const { data: stageRow } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", req.params.id)
        .eq("stage_name", stageName)
        .maybeSingle()
      if (!stageRow) {
        return reply.status(404).send({ error: { code: "stage_not_started" } })
      }

      const { saveStageEdit } = await import(
        "../ee/pipelines/save-stage-edit.js"
      )
      const result = await saveStageEdit({
        supabase,
        pipelineId: req.params.id,
        stageId: stageRow.id as string,
        stageName,
        userId,
        jsonPatch: body.data.edits as JsonPatch,
      })
      if (!result.ok) {
        // Map helper reason → HTTP status:
        //   400 — caller's fault (bad patch shape / path / value)
        //   409 — stage-state issue (not awaiting / not editable / race)
        const status =
          result.reason === "patch_path_not_editable" ||
          result.reason === "patch_invalid" ||
          result.reason === "schema_invalid"
            ? 400
            : 409
        return reply
          .status(status)
          .send({ error: { code: result.reason, detail: result.detail } })
      }
      return reply.send({ ok: true, newOutput: result.newOutput })
    },
  )

  // ── POST /v1/pipelines/:id/stages/script/regenerate-scene ────────────────
  //
  // Phase 2 (granular-pipeline-control spec) — single-scene LLM regeneration.
  // Replaces ONLY scenes[sceneIndex] in the script stage's plan; other scenes
  // (including any user inline edits) are preserved. Appends an audit op to
  // pipeline_stages.user_edits.
  //
  // Cost: 3 credits per call (STATIC_CREDIT_COSTS["regenerate-scene"]).
  // Refund: on LLM failure / roster-ref-invalid / CAS-lost — full refund.
  //
  // `dedup: false` because our success response shape is
  // `{ ok: true, newScene, newPlan }` not `{ jobId }`, so the dedup
  // middleware's `{ jobId, deduped: true }` short-circuit would break the
  // frontend.
  app.post<{
    Params: { id: string }
    Body: { sceneIndex?: unknown; feedback?: unknown }
  }>(
    "/v1/pipelines/:id/stages/script/regenerate-scene",
    {
      preHandler: creditGuard(() => "regenerate-scene", { dedup: false }),
    },
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const body = RegenerateSceneBodySchema.safeParse(req.body ?? {})
      if (!body.success) {
        return reply.status(400).send({
          error: { code: "validation_error", issues: body.error.issues },
        })
      }

      // Ownership check (existence-leak prevention — wrong-user → 404).
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Stage lookup. Must be Stage 1 (script) AND awaiting_approval AND
      // have a plan in output. Anything else → reject early (before any
      // credit reservation).
      const { data: stageRow } = await supabase
        .from("pipeline_stages")
        .select("id, status, output, user_edits")
        .eq("pipeline_id", req.params.id)
        .eq("stage_name", "script")
        .maybeSingle()
      if (!stageRow) {
        return reply.status(404).send({ error: { code: "stage_not_started" } })
      }
      if (stageRow.status !== "awaiting_approval") {
        return reply.status(409).send({ error: { code: "stage_not_awaiting" } })
      }
      const stageOutput = stageRow.output as { plan?: ShowrunnerPlan } | null
      const currentPlan = stageOutput?.plan
      if (!currentPlan) {
        return reply.status(409).send({ error: { code: "plan_not_available" } })
      }

      // sceneIndex range check BEFORE any credit charge — saves the user
      // 3cr on a bad request.
      if (body.data.sceneIndex >= currentPlan.scenes.length) {
        return reply.status(400).send({
          error: {
            code: "scene_index_out_of_range",
            detail: {
              sceneIndex: body.data.sceneIndex,
              sceneCount: currentPlan.scenes.length,
            },
          },
        })
      }

      // Create a jobs row for credit accounting (matches the ai-writer /
      // adjust-volume pattern — synchronous LLM call, jobs row exists only
      // to anchor the credit reservation for commit/refund).
      const { data: job, error: jobErr } = await supabase
        .from("jobs")
        .insert({
          user_id: userId,
          status: "pending",
          input_data: {
            type: "regenerate-scene",
            pipeline_id: req.params.id,
            scene_index: body.data.sceneIndex,
            feedback: body.data.feedback,
          },
        })
        .select("id")
        .single()
      if (jobErr || !job) {
        return reply
          .status(500)
          .send({ error: { code: "db_error", detail: jobErr?.message } })
      }

      // Reserve credits against the job. Sets req.creditReservation +
      // usageLogId. If the reservation fails (insufficient credits etc.),
      // reserveCreditsForJob sends the reply itself — we return.
      const reservation = await reserveCreditsForJob(
        req,
        reply,
        job.id,
        "regenerate-scene",
      )
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      const { CreditsService } = await import("../ee/billing/credits.js")
      const { runSceneRefiner } = await import(
        "../ee/pipelines/llms/scene-refiner.js"
      )

      // Run the refiner. Catch BOTH explicit ok=false branches and thrown
      // errors. Refund credits on any failure path.
      let refinerResult: Awaited<ReturnType<typeof runSceneRefiner>>
      try {
        refinerResult = await runSceneRefiner({
          supabase,
          pipelineId: req.params.id,
          stageId: stageRow.id as string,
          userId,
          plan: currentPlan,
          sceneIndex: body.data.sceneIndex,
          feedback: body.data.feedback,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await supabase
          .from("jobs")
          .update({ status: "failed", error: message })
          .eq("id", job.id)
          .eq("user_id", userId)
        if (usageLogId) await CreditsService.refundCredits(usageLogId)
        return reply.status(502).send({ error: { code: "llm_unavailable", detail: message } })
      }

      if (!refinerResult.ok) {
        await supabase
          .from("jobs")
          .update({ status: "failed", error: refinerResult.reason })
          .eq("id", job.id)
          .eq("user_id", userId)
        if (usageLogId) await CreditsService.refundCredits(usageLogId)
        // scene_index_out_of_range can't fire here (we pre-checked above),
        // but we handle it for completeness.
        const status =
          refinerResult.reason === "roster_ref_invalid" ? 422 : 400
        return reply.status(status).send({
          error: { code: refinerResult.reason, detail: refinerResult.detail },
        })
      }

      // Replace the target scene in the plan. Append an audit op to
      // user_edits (mirrors saveStageEdit's audit-trail pattern — the op is
      // a whole-scene replace, conceptually one big patch op).
      const patchedScenes = currentPlan.scenes.map((s, i) =>
        i === body.data.sceneIndex ? refinerResult.newScene : s,
      )
      const patchedPlan: ShowrunnerPlan = { ...currentPlan, scenes: patchedScenes }
      const existingEdits = Array.isArray(stageRow.user_edits)
        ? (stageRow.user_edits as unknown[])
        : []
      const auditOp = {
        op: "replace",
        path: `/scenes/${body.data.sceneIndex}`,
        value: refinerResult.newScene,
      }
      const mergedEdits = [...existingEdits, auditOp]

      // CAS-guard on status — protect against a concurrent approve flipping
      // the row out from under us between our SELECT and UPDATE.
      const { data: updatedRows, error: updateErr } = await supabase
        .from("pipeline_stages")
        .update({
          output: { plan: patchedPlan },
          user_edits: mergedEdits,
        })
        .eq("id", stageRow.id)
        .eq("status", "awaiting_approval")
        .select("id")
      if (updateErr) {
        await supabase
          .from("jobs")
          .update({ status: "failed", error: "db_update_failed" })
          .eq("id", job.id)
          .eq("user_id", userId)
        if (usageLogId) await CreditsService.refundCredits(usageLogId)
        return reply
          .status(500)
          .send({ error: { code: "db_error", detail: updateErr.message } })
      }
      if (!updatedRows || updatedRows.length === 0) {
        await supabase
          .from("jobs")
          .update({ status: "failed", error: "stage_not_awaiting" })
          .eq("id", job.id)
          .eq("user_id", userId)
        if (usageLogId) await CreditsService.refundCredits(usageLogId)
        return reply.status(409).send({ error: { code: "stage_not_awaiting" } })
      }

      // Success — mark job completed and commit the reserved credits.
      await supabase
        .from("jobs")
        .update({ status: "completed" })
        .eq("id", job.id)
        .eq("user_id", userId)
      if (usageLogId) await CreditsService.commitCredits(usageLogId)

      return reply.send({
        ok: true,
        newScene: refinerResult.newScene,
        newPlan: patchedPlan,
      })
    },
  )

  // ── POST /v1/pipelines/:id/stages/:stage/reject ──────────────────────────
  app.post<{
    Params: { id: string; stage_name: string }
    Body: { feedback: string }
  }>(
    "/v1/pipelines/:id/stages/:stage_name/reject",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const body = z
        .object({ feedback: z.string().min(1).max(2000) })
        .safeParse(req.body)
      if (!body.success) {
        return reply.status(400).send({
          error: { code: "validation_error", issues: body.error.issues },
        })
      }
      if (req.params.stage_name !== "script") {
        return reply.status(400).send({ error: { code: "stage_not_implemented" } })
      }

      // Ownership check.
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const { rejectScriptStage } = await import("../ee/pipelines/engine.js")
      const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")
      const result = await rejectScriptStage(supabase, req.params.id, body.data.feedback)
      if (!result.ok) return reply.status(409).send({ error: { code: result.reason } })
      // Re-enqueue so the worker re-runs Stage 1 with the feedback baked in.
      await enqueuePipelineRun({
        pipelineId: req.params.id,
        userId,
        reason: "user_reject",
      })
      return reply.send({ ok: true })
    },
  )

  // ── POST /v1/pipelines/:id/stages/:stage_name/chat ───────────────────────
  //
  // Phase 1D.2b H1 — Guided-mode chat. User sends a chat message; the
  // chat-refine-showrunner specialist is invoked; both turns persist; SSE
  // emits the assistant turn. Only the Script stage actually ships in 1D.2b
  // — the other chat-enabled stages return 501 until 1D.2d wires their
  // specialists.
  app.post<{
    Params: { id: string; stage_name: string }
    Body: { message: string }
  }>(
    "/v1/pipelines/:id/stages/:stage_name/chat",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const params = z
        .object({
          id: z.string().uuid(),
          stage_name: z.enum(
            CHAT_ENABLED_STAGES as unknown as [string, ...string[]],
          ),
        })
        .safeParse(req.params)
      if (!params.success) {
        return reply.status(400).send({
          error: { code: "invalid_stage", issues: params.error.issues },
        })
      }
      const stageName = params.data.stage_name as ChatEnabledStage

      // Phase 1D.2c C1 — defense-in-depth gate. `CHAT_ENABLED_STAGES`
      // pre-declares every stage that *could* host chat (script, shot_list,
      // post_merge) so the Zod enum stays stable across phases. The actual
      // wiring lives in `CHAT_WIRED_STAGES`: only stages that map to `true`
      // have a specialist + dispatch branch below. shot_list is enabled but
      // not yet wired (1D.2d) — return 501 with a distinct code so callers
      // can tell the difference between "unknown stage" (400) and "future
      // work" (501).
      if (!CHAT_WIRED_STAGES[stageName]) {
        return reply.status(501).send({
          error: { code: "chat_not_wired_for_stage", stage: stageName },
        })
      }

      const body = z
        .object({ message: z.string().min(1).max(8000) })
        .safeParse(req.body)
      if (!body.success) {
        return reply.status(400).send({
          error: { code: "validation_error", issues: body.error.issues },
        })
      }

      // Look up pipeline. Ownership + mode='guided' + stage awaiting_approval
      // are all required for chat to be available.
      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("user_id, mode")
        .eq("id", params.data.id)
        .maybeSingle()
      if (!pipeline || pipeline.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }
      if (pipeline.mode !== "guided") {
        return reply.status(409).send({
          error: { code: "chat_unavailable", reason: "pipeline_not_guided" },
        })
      }

      // Look up the stage row.
      const { data: stageRow } = await supabase
        .from("pipeline_stages")
        .select("id, status, output")
        .eq("pipeline_id", params.data.id)
        .eq("stage_name", stageName)
        .maybeSingle()
      if (!stageRow) {
        return reply.status(409).send({
          error: { code: "chat_unavailable", reason: "stage_not_started" },
        })
      }
      if (stageRow.status !== "awaiting_approval") {
        return reply.status(409).send({
          error: {
            code: "chat_unavailable",
            reason: "stage_not_awaiting_approval",
            status: stageRow.status,
          },
        })
      }

      // Cap check — count existing role='user' turns.
      const { count: userTurnCount } = await supabase
        .from("pipeline_chat_turns")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_stage_id", stageRow.id)
        .eq("role", "user")
      if ((userTurnCount ?? 0) >= CHAT_TURN_CAPS[stageName]) {
        return reply.status(409).send({
          error: {
            code: "chat_turn_cap_reached",
            cap: CHAT_TURN_CAPS[stageName],
          },
        })
      }

      // Compute next turn_n. Defaults to 1 when no rows exist yet.
      const { data: maxRow } = await supabase
        .from("pipeline_chat_turns")
        .select("turn_n")
        .eq("pipeline_stage_id", stageRow.id)
        .order("turn_n", { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextTurnN = (maxRow?.turn_n ?? 0) + 1

      // INSERT user turn.
      const { data: userTurn, error: userInsertErr } = await supabase
        .from("pipeline_chat_turns")
        .insert({
          pipeline_stage_id: stageRow.id,
          turn_n: nextTurnN,
          role: "user",
          content: body.data.message,
        })
        .select("id")
        .single()
      if (userInsertErr || !userTurn) {
        return reply.status(500).send({
          error: { code: "db_error", detail: userInsertErr?.message },
        })
      }

      // Load prior turns + current plan.
      const { data: priorTurns } = await supabase
        .from("pipeline_chat_turns")
        .select("role, content, turn_n")
        .eq("pipeline_stage_id", stageRow.id)
        .order("turn_n", { ascending: true })
      // Exclude the just-inserted user turn from the prior-turns list; the
      // specialist receives the latest message as `userMessage` separately.
      const historyTurns = (priorTurns ?? [])
        .filter((t) => t.turn_n < nextTurnN)
        .map((t) => ({
          role: t.role as "user" | "assistant",
          content: t.content as string,
        }))

      // Phase 1D.2c C1 — dispatch by stage. Each chat-wired stage has its
      // own specialist + artifact shape; they all converge on
      // ChatTurnResponse `{ reply, proposed_change }` so the downstream
      // INSERT + SSE path is shared.
      let chatResponse: import("@nodaro/shared").ChatTurnResponse
      let llmCallId: string
      try {
        if (stageName === "script") {
          // Script chat: needs the current ShowrunnerPlan from the stage's
          // output envelope.
          const stageOutput =
            (stageRow.output as { plan?: unknown } | null) ?? {}
          const currentPlan = (stageOutput as { plan?: unknown }).plan
          const { runChatRefineShowrunner } = await import(
            "../ee/pipelines/llms/chat-refine-showrunner.js"
          )
          const result = await runChatRefineShowrunner({
            supabase,
            pipelineId: params.data.id,
            stageId: stageRow.id as string,
            userId,
            // currentPlan is typed as ShowrunnerPlan — at this point we've
            // validated stageRow.status='awaiting_approval' so a plan must
            // exist; the route's promised invariant is "we don't call the
            // LLM unless we have a plan to refine".
            currentPlan: currentPlan as never,
            priorTurns: historyTurns,
            userMessage: body.data.message,
          })
          chatResponse = result.response
          llmCallId = result.llmCallId
        } else if (stageName === "post_merge") {
          // Post-merge chat: needs the rendered video artifact from the
          // post_merge stage output. `final_output_url` is the canonical key
          // — written at 2 sites in `backend/src/ee/pipelines/stages/post-merge.ts`
          // (auto branch + manual/guided branch). The specialist field
          // matches the persisted name; no aliasing required.
          //
          // `cut_decisions` is persisted by Stage 7's Editor sub-step as an
          // array of `EditorCutDecision` (`ee/pipelines/llms/editor.ts`). We
          // keep `unknown[]` here because core/ can't statically import the
          // ee/ type — the specialist's typed signature checks the shape on
          // its own side, and a runtime mismatch would surface as an LLM
          // schema-validation failure (callLLM Zod-validates the response,
          // not the request payload, but the prompt's JSON stringification
          // is shape-tolerant).
          const postMergeOutput = (stageRow.output as {
            final_output_url?: string
            cut_decisions?: unknown[]
            final_duration_seconds?: number
            beat_grid_used?: number[] | null
          } | null) ?? {}
          const finalOutputUrl = postMergeOutput.final_output_url ?? ""
          // If the artifact hasn't been rendered yet, refuse to call the LLM —
          // a `chat_unavailable` would be misleading (the stage IS awaiting
          // approval; the artifact just isn't ready). Return a distinct code
          // so the panel can render a "wait for the video to finish" hint.
          if (!finalOutputUrl) {
            return reply.status(409).send({
              error: { code: "stage_artifact_incomplete", stage: stageName },
            })
          }
          const { runChatRefinePostMerge } = await import(
            "../ee/pipelines/llms/chat-refine-postmerge.js"
          )
          const result = await runChatRefinePostMerge({
            supabase,
            pipelineId: params.data.id,
            stageId: stageRow.id as string,
            userId,
            finalOutputUrl,
            // Cast through `never` mirrors the showrunner-chat branch's
            // `currentPlan as never` pattern — the typed shape lives in ee/
            // and core/ can't statically import it.
            cutDecisions: (postMergeOutput.cut_decisions ?? []) as never,
            finalDurationSeconds: postMergeOutput.final_duration_seconds ?? 0,
            beatGridUsed: postMergeOutput.beat_grid_used ?? null,
            chatHistory: historyTurns,
            userMessage: body.data.message,
          })
          chatResponse = result.output
          llmCallId = result.llmCallId
        } else {
          // Unreachable today — `CHAT_WIRED_STAGES[stageName]` returned
          // 501 above for every stage that doesn't have an explicit
          // dispatch branch here. Kept as a runtime escape hatch in case
          // a future entry is added to CHAT_WIRED_STAGES without a
          // matching branch (the compile-time guard is the lint rule on
          // stale stage handling rather than TS exhaustiveness — TS can't
          // narrow from a Record<K, boolean> value).
          return reply.status(501).send({
            error: { code: "chat_not_wired_for_stage", stage: stageName },
          })
        }
      } catch {
        return reply.status(502).send({ error: { code: "llm_unavailable" } })
      }

      // INSERT assistant turn.
      const assistantTurnN = nextTurnN + 1
      const proposedChange = chatResponse.proposed_change ?? null
      const { data: assistantTurn, error: assistantInsertErr } = await supabase
        .from("pipeline_chat_turns")
        .insert({
          pipeline_stage_id: stageRow.id,
          turn_n: assistantTurnN,
          role: "assistant",
          content: chatResponse.reply,
          proposed_change: proposedChange,
          llm_call_id: llmCallId,
        })
        .select("id")
        .single()
      if (assistantInsertErr || !assistantTurn) {
        return reply.status(500).send({
          error: { code: "db_error", detail: assistantInsertErr?.message },
        })
      }

      // SSE — publish the full assistant turn so clients can render without
      // an extra GET roundtrip.
      const { pipelineEvents } = await import("../ee/pipelines/events.js")
      pipelineEvents.publish({
        type: "chat:turn",
        pipelineId: params.data.id,
        stageName,
        turn: {
          id: assistantTurn.id as string,
          turn_n: assistantTurnN,
          role: "assistant",
          content: chatResponse.reply,
          proposed_change: proposedChange as ProposedChange | null,
        },
      })

      return reply.send({
        turnId: assistantTurn.id,
        role: "assistant",
        content: chatResponse.reply,
        proposed_change: proposedChange,
      })
    },
  )

  // ── POST /v1/pipelines/:id/stages/:stage_name/chat/turns/:turnId/apply ──
  //
  // Phase 1D.2b H2 — user accepts a proposed edit_artifact change. Routes
  // through `applyStageEdit` which validates the JSON Patch, inserts a new
  // pipeline_stage_attempts row, CAS-flips stage status, and emits
  // chat:proposal_applied SSE.
  //
  // Recoverable failures (schema_invalid / reference_integrity_failed) insert
  // a follow-up assistant turn so the user sees the error in-chat and can ask
  // the specialist for a retry. Hard failures (patch_invalid /
  // stage_not_awaiting) return 409 — no follow-up turn because the chat is
  // no longer in a state where retry makes sense.
  app.post<{
    Params: { id: string; stage_name: string; turnId: string }
  }>(
    "/v1/pipelines/:id/stages/:stage_name/chat/turns/:turnId/apply",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const params = z
        .object({
          id: z.string().uuid(),
          stage_name: z.enum(
            CHAT_ENABLED_STAGES as unknown as [string, ...string[]],
          ),
          turnId: z.string().uuid(),
        })
        .safeParse(req.params)
      if (!params.success) {
        return reply.status(400).send({
          error: { code: "validation_error", issues: params.error.issues },
        })
      }
      const stageName = params.data.stage_name as ChatEnabledStage

      // Phase 1D.2c C1 — same wired-stage gate as the POST /chat route. The
      // Zod enum already restricts to CHAT_ENABLED_STAGES; this catches the
      // shot_list case where chat is enabled but no specialist (and therefore
      // no Apply path) exists yet.
      if (!CHAT_WIRED_STAGES[stageName]) {
        return reply.status(501).send({
          error: { code: "chat_not_wired_for_stage", stage: stageName },
        })
      }

      // Ownership check.
      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", params.data.id)
        .maybeSingle()
      if (!pipeline || pipeline.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Look up the turn — must be assistant + applyable + not already applied.
      const { data: turn } = await supabase
        .from("pipeline_chat_turns")
        .select(
          "id, pipeline_stage_id, role, proposed_change, applied_to_attempt_id, llm_call_id",
        )
        .eq("id", params.data.turnId)
        .maybeSingle()
      if (!turn) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }
      if (turn.applied_to_attempt_id) {
        return reply.status(409).send({ error: { code: "already_applied" } })
      }
      const proposedChange = turn.proposed_change as ProposedChange | null
      if (turn.role !== "assistant" || !proposedChange) {
        return reply.status(400).send({ error: { code: "turn_not_applyable" } })
      }

      // Phase 1D.2c C2 — post_merge stage only accepts suggest_branch
      // (STAGE_PATCH_SCHEMA.post_merge=null, the merged artifact isn't
      // user-editable in place). The chat-refine-postmerge system prompt
      // forbids edit_artifact, so this should rarely fire — but per spec
      // §5.12 it's a hard defense-in-depth gate.
      if (
        stageName === "post_merge" &&
        proposedChange.change_type === "edit_artifact"
      ) {
        return reply.status(400).send({
          error: {
            code: "invalid_change_type_for_stage",
            detail:
              "post_merge stage only accepts suggest_branch; edit_artifact is not valid here.",
          },
        })
      }

      // Phase 1D.2c C2 — suggest_branch on post_merge is informational only;
      // the user acts on it via the dedicated POST /v1/pipelines/:id/branch
      // endpoint, NOT this Apply route. Return 200 to confirm we saw the
      // click; no JSON Patch to apply, no pipeline_stage_attempts row to
      // bind `applied_to_attempt_id` to (the FK is nullable but writing
      // NULL is meaningless). Frontend's ProposedChangeCard.tsx already
      // renders suggest_branch as a hint pointing at "Re-run from here";
      // this endpoint exists as the API contract for non-UI callers.
      //
      // For other stages (script today), suggest_branch still falls through
      // to the legacy `turn_not_applyable` 400 below — the script chat
      // already has an edit_artifact path the user can take, and the LLM
      // emits suggest_branch sparingly as a "this is too deep to patch"
      // signal. Keeping the script behavior unchanged preserves the
      // existing API contract.
      if (
        stageName === "post_merge" &&
        proposedChange.change_type === "suggest_branch"
      ) {
        return reply.send({
          applied: false,
          suggested: true,
          suggested_from_stage: proposedChange.from_stage,
          suggested_reason: proposedChange.reason,
        })
      }

      // After the stage-specific gates: every remaining apply MUST be an
      // edit_artifact. suggest_branch on non-post_merge stages falls here.
      if (proposedChange.change_type !== "edit_artifact") {
        return reply.status(400).send({ error: { code: "turn_not_applyable" } })
      }

      const { applyStageEdit } = await import(
        "../ee/pipelines/chat/apply-stage-edit.js"
      )
      const result = await applyStageEdit({
        supabase,
        pipelineId: params.data.id,
        stageName,
        stageId: turn.pipeline_stage_id as string,
        userId,
        jsonPatch: proposedChange.json_patch as JsonPatch,
        source: "chat_apply",
        chatTurnId: turn.id as string,
        llmCallId: (turn.llm_call_id as string | null) ?? undefined,
      })

      if (result.ok) {
        return reply.send({
          applied: true,
          attemptId: result.newAttemptId,
          newOutput: result.newOutput,
        })
      }

      // Recoverable failures — insert a follow-up assistant turn with a
      // human-readable error so the user can iterate via chat.
      if (
        result.reason === "schema_invalid" ||
        result.reason === "reference_integrity_failed"
      ) {
        // Compute next turn_n for the follow-up turn.
        const { data: maxRow } = await supabase
          .from("pipeline_chat_turns")
          .select("turn_n")
          .eq("pipeline_stage_id", turn.pipeline_stage_id)
          .order("turn_n", { ascending: false })
          .limit(1)
          .maybeSingle()
        const nextTurnN = (maxRow?.turn_n ?? 0) + 1

        const hint =
          result.reason === "schema_invalid"
            ? `The proposed change failed schema validation. Detail: ${JSON.stringify(result.detail)}`
            : `The proposed change failed reference integrity: removing a cast/location/object entry that is still referenced. Detail: ${JSON.stringify(result.detail)}`

        const { data: followUpTurn } = await supabase
          .from("pipeline_chat_turns")
          .insert({
            pipeline_stage_id: turn.pipeline_stage_id,
            turn_n: nextTurnN,
            role: "assistant",
            content: hint,
            proposed_change: null,
            // Reuse the original llm_call_id to satisfy the
            // chat_turns_llm_call_required_for_assistant CHECK constraint —
            // we don't have a new LLM call to attribute this synthetic
            // error-recovery turn to.
            llm_call_id: turn.llm_call_id,
          })
          .select("id, turn_n")
          .single()

        if (followUpTurn) {
          const { pipelineEvents } = await import("../ee/pipelines/events.js")
          pipelineEvents.publish({
            type: "chat:turn",
            pipelineId: params.data.id,
            stageName,
            turn: {
              id: followUpTurn.id as string,
              turn_n: followUpTurn.turn_n as number,
              role: "assistant",
              content: hint,
              proposed_change: null,
            },
          })
        }

        return reply.send({
          applied: false,
          error: { code: result.reason, detail: result.detail },
        })
      }

      // Hard failures — 409.
      return reply.status(409).send({ error: { code: result.reason } })
    },
  )

  // ── GET /v1/pipelines/:id/stages/:stage_name/chat ────────────────────────
  //
  // Phase 1D.2b H3 — list chat turns for a stage. Returns empty array when
  // no turns exist yet. Used by the frontend chat panel on initial mount
  // (subsequent updates come via SSE).
  app.get<{ Params: { id: string; stage_name: string } }>(
    "/v1/pipelines/:id/stages/:stage_name/chat",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:read")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const params = z
        .object({
          id: z.string().uuid(),
          stage_name: z.enum(
            CHAT_ENABLED_STAGES as unknown as [string, ...string[]],
          ),
        })
        .safeParse(req.params)
      if (!params.success) {
        return reply.status(400).send({
          error: { code: "invalid_stage", issues: params.error.issues },
        })
      }
      const stageName = params.data.stage_name as ChatEnabledStage

      // Ownership check.
      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", params.data.id)
        .maybeSingle()
      if (!pipeline || pipeline.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Look up the stage row.
      const { data: stageRow } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", params.data.id)
        .eq("stage_name", stageName)
        .maybeSingle()
      if (!stageRow) {
        return reply.send({ turns: [] })
      }

      const { data: turns, error } = await supabase
        .from("pipeline_chat_turns")
        .select(
          "id, turn_n, role, content, proposed_change, applied_to_attempt_id, llm_call_id, created_at",
        )
        .eq("pipeline_stage_id", stageRow.id)
        .order("turn_n", { ascending: true })
      if (error) {
        return reply
          .status(500)
          .send({ error: { code: "db_error", detail: error.message } })
      }
      return reply.send({ turns: turns ?? [] })
    },
  )

  // ── GET /v1/pipelines/:id/entities?type=character|object|location|scene ──
  app.get<{ Params: { id: string }; Querystring: { type: string } }>(
    "/v1/pipelines/:id/entities",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:read")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      // Ownership check on the parent pipeline row.
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const typeFilter = req.query.type
      if (!(ENTITY_TYPES as readonly string[]).includes(typeFilter)) {
        return reply.status(400).send({ error: { code: "invalid_entity_type" } })
      }

      const { data: entities, error } = await supabase
        .from("pipeline_entities")
        .select("id, entity_type, entity_key, status, main_asset_id, metadata")
        .eq("pipeline_id", req.params.id)
        .eq("entity_type", typeFilter)
        .order("created_at", { ascending: true })
      if (error) {
        return reply
          .status(500)
          .send({ error: { code: "db_error", detail: error.message } })
      }

      const ids = (entities ?? []).map((e) => e.id)
      const { data: variants } = ids.length
        ? await supabase
            .from("pipeline_entity_variants")
            .select("entity_id, variant_key, asset_id, status")
            .in("entity_id", ids)
        : {
            data: [] as Array<{
              entity_id: string
              variant_key: string
              asset_id: string | null
              status: string
            }>,
          }

      const assetIds = [
        ...new Set([
          ...((entities ?? [])
            .map((e) => e.main_asset_id)
            .filter(Boolean) as string[]),
          ...((variants ?? [])
            .map((v) => v.asset_id)
            .filter(Boolean) as string[]),
        ]),
      ]
      const { data: assets } = assetIds.length
        ? await supabase
            .from("assets")
            .select("id, r2_url")
            .in("id", assetIds)
        : { data: [] as Array<{ id: string; r2_url: string }> }
      const urlById = new Map((assets ?? []).map((a) => [a.id, a.r2_url]))

      const result = (entities ?? []).map((e) => ({
        ...e,
        main_asset_url: e.main_asset_id
          ? (urlById.get(e.main_asset_id) ?? null)
          : null,
        variants: (variants ?? [])
          .filter((v) => v.entity_id === e.id)
          .map((v) => ({
            variant_key: v.variant_key,
            asset_id: v.asset_id,
            asset_url: v.asset_id ? (urlById.get(v.asset_id) ?? null) : null,
            status: v.status,
          })),
      }))

      return result
    },
  )

  // ── GET /v1/pipelines/:id/timeline ───────────────────────────────────────
  // Phase 0 walking skeleton — assembles the data the studio view turns into a
  // Remotion SceneGraph: ordered scene composite clips + their durations, plus
  // the music + narration audio tracks. Reads the same scene metadata the
  // silent-cut reel uses (`scene_node_data.composite_video_url`) and the audio
  // URLs Stage 7 wrote onto the `animate_audio_edit` stage output.
  app.get<{ Params: { id: string } }>(
    "/v1/pipelines/:id/timeline",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:read")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("user_id, output_resolution")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!pipeline || pipeline.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Scenes in story order (entity_key asc — matches the silent-cut reel).
      const { data: scenes, error: scenesErr } = await supabase
        .from("pipeline_entities")
        .select("metadata")
        .eq("pipeline_id", req.params.id)
        .eq("entity_type", "scene")
        .order("entity_key", { ascending: true })
      if (scenesErr) {
        return reply
          .status(500)
          .send({ error: { code: "db_error", detail: scenesErr.message } })
      }

      const sceneClips: Array<{ compositeUrl: string; durationSeconds: number }> = []
      for (const row of scenes ?? []) {
        const meta = (row.metadata as Record<string, unknown> | null) ?? {}
        const sceneNodeData = meta.scene_node_data as
          | {
              composite_video_url?: string
              shots?: Array<{ duration_seconds?: number }>
            }
          | undefined
        const compositeUrl = sceneNodeData?.composite_video_url
        if (!compositeUrl) continue
        const durationSeconds = (sceneNodeData?.shots ?? []).reduce(
          (sum, s) =>
            sum + (typeof s.duration_seconds === "number" ? s.duration_seconds : 0),
          0,
        )
        sceneClips.push({ compositeUrl, durationSeconds })
      }

      // Audio URLs from the Stage 7 (animate_audio_edit) stage output.
      const { data: animateStage } = await supabase
        .from("pipeline_stages")
        .select("output")
        .eq("pipeline_id", req.params.id)
        .eq("stage_name", "animate_audio_edit")
        .maybeSingle()
      const animateOutput =
        (animateStage?.output as {
          music_result?: { musicAssetUrl?: string } | null
          narration_audio_url?: string | null
        } | null) ?? {}
      // `musicAssetUrl` is "" when music is disabled or the Suno step failed
      // (see MusicTimelineResult) — use a truthy check, not ??, so an empty
      // string never becomes a phantom audio track.
      const musicUrl = animateOutput.music_result?.musicAssetUrl || undefined
      const narrationUrl = animateOutput.narration_audio_url || undefined

      const resolution = (pipeline as { output_resolution?: string })
        .output_resolution
      const { width, height } =
        resolution === "1080p"
          ? { width: 1920, height: 1080 }
          : { width: 1280, height: 720 }

      return {
        fps: 30,
        width,
        height,
        scenes: sceneClips,
        ...(musicUrl ? { musicUrl } : {}),
        ...(narrationUrl ? { narrationUrl } : {}),
      }
    },
  )

  // ── POST /v1/pipelines/:id/entities/:entity_id/approve ───────────────────
  app.post<{ Params: { id: string; entity_id: string } }>(
    "/v1/pipelines/:id/entities/:entity_id/approve",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      // Ownership check on the parent pipeline row.
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const { approveEntity } = await import("../ee/pipelines/entity-approval.js")
      const result = await approveEntity(supabase, req.params.id, req.params.entity_id)
      if (!result.ok) return reply.status(409).send({ error: { code: result.reason } })
      // Re-drive the engine so the orchestrator picks up the approval and advances
      // (e.g. runs ensureCharacterVariants for the just-approved entity).
      const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")
      await enqueuePipelineRun({
        pipelineId: req.params.id,
        userId,
        reason: "stage_advance",
      })
      return reply.send({ ok: true })
    },
  )

  // ── POST /v1/pipelines/:id/entities/:entity_id/approve-description ──────
  //
  // Phase 3 (granular-pipeline-control spec) — Step A of the Character
  // Wizard. Three modes via discriminated body:
  //
  //   { mode: 'llm' }
  //     → Approve the LLM-derived visual_description as-is. Flips entity
  //       pending_description → pending so the engine picks up next cycle.
  //
  //   { mode: 'user_edited', description: <string> }
  //     → User rewrote the description. Persists the new text into
  //       metadata.visual_description, then flips to pending.
  //
  //   { mode: 'upload', asset_url: <r2 URL>, filename?, mime_type?, size_bytes? }
  //     → User uploaded their own portrait (client posted to /v1/upload/image
  //       first). Creates an assets row pointing at the R2 URL, sets it as
  //       main_asset_id, flips entity directly to 'approved' (skips Step B
  //       per spec line 86). NO image-critic call (D2 override — user owns
  //       the choice, no 3cr LLM opinion they didn't ask for).
  //
  // CAS-guarded on `status='pending_description'`. Concurrent re-click
  // returns 409 entity_not_pending_description.
  app.post<{
    Params: { id: string; entity_id: string }
    Body: unknown
  }>(
    "/v1/pipelines/:id/entities/:entity_id/approve-description",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const body = ApproveDescriptionBodySchema.safeParse(req.body ?? {})
      if (!body.success) {
        return reply.status(400).send({
          error: { code: "validation_error", issues: body.error.issues },
        })
      }

      // Ownership check on the parent pipeline.
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const {
        approveDescriptionLlmOrEdited,
        attachUploadedImageToEntity,
      } = await import("../ee/pipelines/entity-description.js")
      const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")

      const data = body.data
      let result: Awaited<ReturnType<typeof approveDescriptionLlmOrEdited>>
      if (data.mode === "upload") {
        result = await attachUploadedImageToEntity({
          supabase,
          pipelineId: req.params.id,
          entityId: req.params.entity_id,
          userId,
          assetUrl: data.asset_url,
          filename: data.filename,
          mimeType: data.mime_type,
          sizeBytes: data.size_bytes,
        })
      } else {
        // mode === 'llm' || 'user_edited'
        result = await approveDescriptionLlmOrEdited({
          supabase,
          pipelineId: req.params.id,
          entityId: req.params.entity_id,
          newDescription: data.mode === "user_edited" ? data.description : undefined,
        })
      }

      if (!result.ok) {
        const status =
          result.reason === "entity_not_found"
            ? 404
            : result.reason === "asset_insert_failed"
              ? 500
              : 409
        return reply
          .status(status)
          .send({ error: { code: result.reason, detail: result.detail } })
      }

      // Re-drive the engine: for mode='llm'/'user_edited' the entity is now
      // `pending` and needs generateCharacterMain; for mode='upload' the
      // entity is `approved` and needs ensureCharacterVariants.
      await enqueuePipelineRun({
        pipelineId: req.params.id,
        userId,
        reason: "stage_advance",
      })

      return reply.send({
        ok: true,
        mode: data.mode,
        newStatus: result.newStatus,
        ...(result.assetId ? { assetId: result.assetId } : {}),
      })
    },
  )

  // ── POST /v1/pipelines/:id/entities/:entity_id/skip ─────────────────────
  //
  // Phase 3 (granular-pipeline-control spec) — Step A skip action. Flips a
  // `pending_description` entity to terminal `skipped` state so it stops
  // blocking stage advancement. No body required.
  //
  // The frontend wizard renders a one-line warning at skip time when the
  // character is referenced in any scene's cast_keys (D3 override) — that
  // check is purely UI-side. Backend permits any skip; downstream stages
  // handle missing main_asset_id on their own.
  app.post<{ Params: { id: string; entity_id: string } }>(
    "/v1/pipelines/:id/entities/:entity_id/skip",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const { skipEntity } = await import("../ee/pipelines/entity-description.js")
      const result = await skipEntity({
        supabase,
        pipelineId: req.params.id,
        entityId: req.params.entity_id,
      })
      if (!result.ok) {
        const status = result.reason === "entity_not_found" ? 404 : 409
        return reply.status(status).send({ error: { code: result.reason } })
      }

      // Re-drive the engine so it re-evaluates the stage-completion gate
      // (skipped entities count as "resolved" alongside approved).
      const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")
      await enqueuePipelineRun({
        pipelineId: req.params.id,
        userId,
        reason: "stage_advance",
      })

      return reply.send({ ok: true, status: "skipped" })
    },
  )

  // ── POST /v1/pipelines/:id/entities/:entity_id/reject ────────────────────
  app.post<{
    Params: { id: string; entity_id: string }
    Body: { feedback: string }
  }>(
    "/v1/pipelines/:id/entities/:entity_id/reject",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      // Ownership check on the parent pipeline row.
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const parsed = EntityRejectInputSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "validation_error", issues: parsed.error.issues } })
      }
      const { rejectEntity } = await import("../ee/pipelines/entity-approval.js")
      const result = await rejectEntity(
        supabase,
        req.params.id,
        req.params.entity_id,
        parsed.data.feedback,
      )
      if (!result.ok) return reply.status(409).send({ error: { code: result.reason } })
      // Re-drive the engine so the orchestrator regenerates the rejected entity's main image.
      const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")
      await enqueuePipelineRun({
        pipelineId: req.params.id,
        userId,
        reason: "user_reject",
      })
      return reply.send({ ok: true })
    },
  )

  // ── POST /v1/pipelines/:id/entities/:entity_id/force-approve-image-critic-failure ─
  // Phase 1D.2c-a §7 (E1) follow-up — Skip button on the EntityCard.
  //
  // The Stage 2 / Stage 4 image-critic chain may terminally fail an entity
  // after `IMAGE_CRITIC_MAX_RETRIES`. The general approve route CAS-gates on
  // `status='awaiting_approval'` (safe-by-default for the common path); this
  // narrow recovery route accepts the failed image AS-IS and lets the
  // pipeline advance.
  //
  // Gate: entity.status='failed' AND metadata.last_error=IMAGE_CRITIC_UNRESOLVABLE.
  // Side-effects: status→'approved', main_asset_id→latest assets row for the
  // entity (mirrors what the success path would have written had the critic
  // passed). Re-enqueues the orchestrator so downstream stages run.
  app.post<{ Params: { id: string; entity_id: string } }>(
    "/v1/pipelines/:id/entities/:entity_id/force-approve-image-critic-failure",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      // Ownership check on the parent pipeline row (existence-leak prevention —
      // cross-user lookups return 404, not 403).
      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Load the entity + verify it's in the image-critic-failed state.
      const { data: entity } = await supabase
        .from("pipeline_entities")
        .select("id, entity_type, entity_key, status, metadata")
        .eq("id", req.params.entity_id)
        .eq("pipeline_id", req.params.id)
        .maybeSingle()
      if (!entity) return reply.status(404).send({ error: { code: "not_found" } })
      const metadata = (entity.metadata ?? {}) as Record<string, unknown>
      if (
        entity.status !== "failed" ||
        metadata.last_error !== IMAGE_CRITIC_UNRESOLVABLE
      ) {
        return reply
          .status(409)
          .send({ error: { code: "entity_not_image_critic_failed" } })
      }

      // Pick the asset row to adopt. Fix 2 — when the critic loop wrote
      // `last_attempted_asset_id` we use it directly. Older failures (before
      // the writer was updated) fall back to the latest-by-created_at query.
      const lastAttemptedAssetId =
        typeof metadata.last_attempted_asset_id === "string"
          ? (metadata.last_attempted_asset_id as string)
          : null
      let mainAssetId: string | null = lastAttemptedAssetId
      if (!mainAssetId) {
        const { data: latestAsset } = await supabase
          .from("assets")
          .select("id")
          .eq("pipeline_entity_id", req.params.entity_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        mainAssetId = (latestAsset?.id as string | undefined) ?? null
      }
      if (!mainAssetId) {
        return reply.status(409).send({ error: { code: "no_asset_to_approve" } })
      }

      const { data: updated } = await supabase
        .from("pipeline_entities")
        .update({
          status: "approved",
          main_asset_id: mainAssetId,
        })
        .eq("id", req.params.entity_id)
        .eq("pipeline_id", req.params.id)
        .eq("status", "failed")
        .select("id")
      if (!updated || (Array.isArray(updated) && updated.length === 0)) {
        // CAS lost — the row was in `failed` at SELECT time but moved out of
        // it before the UPDATE landed (concurrent click / orchestrator action).
        // Surface as `entity_already_advanced` per the sibling convention in
        // `entity-approval.ts:approveEntity` so the client distinguishes
        // "stale UI, refetch" from "wrong state to begin with".
        return reply
          .status(409)
          .send({ error: { code: "entity_already_advanced" } })
      }

      // Fix 1 — run the same post-approve side effects the general
      // approveEntity flow runs: publish entity:status SSE + flip the canvas
      // node's pipeline_state to approved + (re-)materialize the canvas node
      // row. Without this the EntityCard waits ~5s for the React Query poll
      // to flip and the canvas node stays stuck in `running`.
      const { approveEntityCore } = await import("../ee/pipelines/entity-approval.js")
      await approveEntityCore(supabase, req.params.id, {
        id: entity.id as string,
        entity_type: entity.entity_type as EntityType,
        entity_key: entity.entity_key as string,
      })

      // Drive the engine forward — same reason as the general approve route.
      const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")
      await enqueuePipelineRun({
        pipelineId: req.params.id,
        userId,
        reason: "stage_advance",
      })
      return reply.send({ ok: true })
    },
  )

  // ── POST /v1/pipelines/:id/entities/:entity_id/retry-image-generation ────
  // Phase 1D.2c-a §7 (E1) follow-up — Regenerate button on the EntityCard.
  //
  // Resets a critic-failed entity back to `pending` and clears the
  // image-critic-only metadata, leaving the rest of the row intact (name,
  // voice_match, role, etc.). Re-enqueuing the orchestrator drives the stage
  // handler back through `generateCharacterMain` / `generateLocationMain`
  // with a fresh retry budget.
  //
  // Gate is identical to force-approve: only critic-failed rows recover here.
  app.post<{ Params: { id: string; entity_id: string } }>(
    "/v1/pipelines/:id/entities/:entity_id/retry-image-generation",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const { data: entity } = await supabase
        .from("pipeline_entities")
        .select("id, entity_type, entity_key, status, metadata")
        .eq("id", req.params.entity_id)
        .eq("pipeline_id", req.params.id)
        .maybeSingle()
      if (!entity) return reply.status(404).send({ error: { code: "not_found" } })
      const metadata = (entity.metadata ?? {}) as Record<string, unknown>
      if (
        entity.status !== "failed" ||
        metadata.last_error !== IMAGE_CRITIC_UNRESOLVABLE
      ) {
        return reply
          .status(409)
          .send({ error: { code: "entity_not_image_critic_failed" } })
      }

      // Strip image-critic-only metadata keys. Anything else (name, role,
      // voice_match, reject_count, …) survives intact so the next attempt
      // doesn't lose context. Fix 5 — the key set is the single source of
      // truth in `@nodaro/shared/pipeline-defaults` so the writer
      // (`_image-critic-loop.ts`) and this clearer can't drift.
      const preservedMetadata = clearImageCriticMetadata(metadata)

      const { data: updated } = await supabase
        .from("pipeline_entities")
        .update({
          status: "pending",
          metadata: preservedMetadata,
        })
        .eq("id", req.params.entity_id)
        .eq("pipeline_id", req.params.id)
        .eq("status", "failed")
        .select("id")
      if (!updated || (Array.isArray(updated) && updated.length === 0)) {
        // Fix 4 — CAS lost (entity moved out of `failed` between SELECT and
        // UPDATE). Same convention as the force-approve route + sibling
        // approveEntity helper.
        return reply
          .status(409)
          .send({ error: { code: "entity_already_advanced" } })
      }

      // Fix 1 — publish entity:status SSE + drop the canvas node back to
      // `running`. Mirrors the rejectEntity path (which transitions to
      // `generating` + `pipeline_owned_running`). UI updates instantly
      // instead of waiting for the React Query 5s poll.
      //
      // Symmetry with the sibling force-approve route — both recovery routes
      // delegate their post-CAS side effects to dedicated helpers in
      // `entity-approval.ts` (here: `resetEntityForRetry`; there:
      // `approveEntityCore`).
      const { resetEntityForRetry } = await import(
        "../ee/pipelines/entity-approval.js"
      )
      await resetEntityForRetry(supabase, req.params.id, {
        id: entity.id as string,
        entity_type: entity.entity_type as EntityType,
        entity_key: entity.entity_key as string,
      })

      const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")
      await enqueuePipelineRun({
        pipelineId: req.params.id,
        userId,
        reason: "stage_advance",
      })
      return reply.send({ ok: true })
    },
  )

  // ── POST /v1/pipelines/:id/entities/:entity_id/retry-variants ────────────
  // Re-attempts variant generation for a character entity whose
  // `ensureCharacterVariants` ran but either threw at the outermost level
  // (variant_generation_error set) or finished with `variants_failed_count
  // > 0`. Clears the failure markers, deletes any failed
  // pipeline_entity_variants rows so they're regenerated fresh, and
  // re-enqueues drivePipeline. The engine picks up the entity at its
  // existing `approved` status and re-runs ensureCharacterVariants.
  //
  // Idempotent CAS: the UPDATE is gated only on entity ownership, NOT on a
  // specific failure marker, so the route also recovers entities that
  // pre-date this PR (no variant_*_error markers ever written for them,
  // they just stalled silently — pipeline 65c57374 from 2026-05-26 is the
  // motivating case). Filter the variants delete by status='failed' so we
  // don't accidentally wipe a partial set of successful variants.
  app.post<{ Params: { id: string; entity_id: string } }>(
    "/v1/pipelines/:id/entities/:entity_id/retry-variants",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const { data: owner } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!owner || owner.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const { data: entity } = await supabase
        .from("pipeline_entities")
        .select("id, entity_type, entity_key, status, metadata")
        .eq("id", req.params.entity_id)
        .eq("pipeline_id", req.params.id)
        .maybeSingle()
      if (!entity) return reply.status(404).send({ error: { code: "not_found" } })
      if (entity.entity_type !== "character") {
        return reply.status(409).send({ error: { code: "entity_not_character" } })
      }
      if (entity.status !== "approved") {
        // Variants only generate after the main image was approved.
        return reply
          .status(409)
          .send({ error: { code: "entity_not_approved" } })
      }

      // Clear failed variant rows so the engine regenerates them (instead
      // of skipping them as "already exist"). Approved variants stay so
      // we don't waste credits re-generating successful ones.
      await supabase
        .from("pipeline_entity_variants")
        .delete()
        .eq("entity_id", req.params.entity_id)
        .eq("status", "failed")

      // Strip the failure markers. The post-loop UPDATE in
      // ensureCharacterVariants will re-set them if the new run also fails
      // — same metadata, fresh values.
      const meta = (entity.metadata ?? {}) as Record<string, unknown>
      const cleared: Record<string, unknown> = { ...meta }
      delete cleared.variants_failed_count
      delete cleared.variants_total_count
      delete cleared.variant_generation_error
      delete cleared.variant_generation_error_at
      await supabase
        .from("pipeline_entities")
        .update({ metadata: cleared })
        .eq("id", req.params.entity_id)

      // Re-enqueue the orchestrator. Same trigger pattern as the sibling
      // retry-image-generation route — drivePipeline re-enters and the
      // characters stage's per-entity loop picks the entity up.
      const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")
      await enqueuePipelineRun({
        pipelineId: req.params.id,
        userId,
        reason: "stage_advance",
      })
      return reply.send({ ok: true })
    },
  )

  // ── POST /v1/pipelines/:id/shots/:scene_id/:shot_id/skip-video-critic-failure ─
  // Phase 1D.2c-b-ii §9 (J1) — Skip button on the per-shot video-critic surface.
  //
  // The Stage 7 video-critic retry loop (`scene-internal-pipeline.ts`) may
  // terminally mark a shot as `video_critic_failed=true` after the attempt
  // cap is exhausted. The flag lives inside
  // `pipeline_entities.metadata.scene_node_data.shots[N]`, NOT directly on
  // the entity row — so the entity-level recovery routes can't reach it.
  //
  // This route accepts the failed clip AS-IS: it flips `video_critic_failed`
  // back to `false` (keeping the rest of the `video_critic_*` findings for
  // audit trail) and emits a `shot:status` SSE so the per-shot UI updates
  // without a refetch.
  //
  // Gate: shot exists AND `shot.video_critic_failed === true`. Any other
  // state returns 409 `shot_not_video_critic_failed`. Auto-mode pipelines
  // are already on the failure path (aggregator in `animate-audio-edit.ts`),
  // so callers in auto-mode shouldn't reach this route — the route doesn't
  // gate on mode (idempotent + safe regardless).
  app.post<{ Params: { id: string; scene_id: string; shot_id: string } }>(
    "/v1/pipelines/:id/shots/:scene_id/:shot_id/skip-video-critic-failure",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const { loadFailedShotOrError, applyShotMutationAndEmit } = await import(
        "../ee/pipelines/shot-recovery.js"
      )
      const loaded = await loadFailedShotOrError(supabase, reply, {
        pipelineId: req.params.id,
        sceneId: req.params.scene_id,
        shotId: req.params.shot_id,
        userId,
      })
      if (!loaded) return // helper already sent the error response
      const { sceneEntity, sceneData, shotIndex } = loaded

      // Flip the flag — keep `video_critic_findings` / score / continuity /
      // retry_count for audit trail. The per-shot UI uses `video_critic_failed`
      // as the gate for the Skip/Regenerate buttons; the rest of the fields
      // continue rendering as informational (warning chip color). The helper
      // handles UPDATE + SSE + reply.
      await applyShotMutationAndEmit({
        supabase,
        reply,
        pipelineId: req.params.id,
        sceneEntity,
        sceneData,
        shotIndex,
        shotId: req.params.shot_id,
        sceneId: req.params.scene_id,
        shotMutator: (s) => ({ ...s, video_critic_failed: false }),
      })
    },
  )

  // ── POST /v1/pipelines/:id/shots/:scene_id/:shot_id/retry-video-generation ─
  // Phase 1D.2c-b-ii §9 (J1) — Regenerate button on the per-shot video-critic
  // surface.
  //
  // Strips every `video_critic_*` field from the failed shot (findings, score,
  // continuity_score, identified_action, retry_count, last_attempted_url,
  // failed) and re-enqueues the orchestrator so the Stage 7 inner loop
  // (`runSceneInternalPipeline`) re-runs `processShot` for this shot. The
  // critic budget resets to fresh, the prior verdict is gone from the audit
  // trail, and the next clip generation is the user's intent.
  //
  // Gate is identical to skip-video-critic-failure: only shots flagged
  // `video_critic_failed=true` can be recovered here.
  app.post<{ Params: { id: string; scene_id: string; shot_id: string } }>(
    "/v1/pipelines/:id/shots/:scene_id/:shot_id/retry-video-generation",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const { loadFailedShotOrError, applyShotMutationAndEmit } = await import(
        "../ee/pipelines/shot-recovery.js"
      )
      const loaded = await loadFailedShotOrError(supabase, reply, {
        pipelineId: req.params.id,
        sceneId: req.params.scene_id,
        shotId: req.params.shot_id,
        userId,
      })
      if (!loaded) return // helper already sent the error response
      const { sceneEntity, sceneData, shotIndex } = loaded

      // Strip every `video_critic_*` key from the shot — clears the entire
      // critic verdict block so the next Stage 7 pass starts with a clean
      // slate. Non-critic fields (camera, action, motion_prompt, …) survive.
      // The shared `clearVideoCriticMetadata` helper is the single source of
      // truth for the key set so the writer (Stage 7) + this clearer + the
      // frontend Regenerate handler can't drift.
      //
      // The helper runs `onAfterUpdate` (re-enqueue orchestrator) between
      // UPDATE and SSE so the orchestrator is already queued before clients
      // are nudged to refetch. `reason: "stage_advance"` mirrors the sibling
      // entity-level retry-image-generation route — the engine handles the rest.
      await applyShotMutationAndEmit({
        supabase,
        reply,
        pipelineId: req.params.id,
        sceneEntity,
        sceneData,
        shotIndex,
        shotId: req.params.shot_id,
        sceneId: req.params.scene_id,
        shotMutator: (s) => clearVideoCriticMetadata(s),
        // Invalidate the scene's composite so the re-enqueued drive actually
        // re-animates it. `runSceneInternalPipeline` now short-circuits when a
        // scene still carries `composite_video_url`; without clearing it the
        // Regenerate would re-enqueue but the scene would skip → silent no-op.
        clearSceneComposite: true,
        onAfterUpdate: async () => {
          const { enqueuePipelineRun } = await import(
            "../ee/pipelines/queue.js"
          )
          await enqueuePipelineRun({
            pipelineId: req.params.id,
            userId,
            reason: "stage_advance",
          })
        },
      })
    },
  )

  // ── POST /v1/pipelines/:id/fork ──────────────────────────────────────────
  // Phase 1B.4 — user takes over creative control. Caller becomes the owner
  // of every materialized canvas node; pipeline status flips to `forked`,
  // every entity is flagged `is_forked=true`, every node is orphaned, and
  // the unspent reservation is refunded. Idempotent — second call returns
  // the existing `forked_at`. Terminal pipelines return 409.
  app.post<{ Params: { id: string } }>(
    "/v1/pipelines/:id/fork",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:execute")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("user_id, status")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!pipeline) return reply.status(404).send({ error: { code: "not_found" } })
      // Existence-leak prevention — cross-user lookups return 404, not 403.
      if (pipeline.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Terminal statuses other than `forked` reject — there's nothing left
      // to fork. `forked` falls through to `forkPipeline` which is idempotent.
      if (
        pipeline.status === "completed" ||
        pipeline.status === "failed" ||
        pipeline.status === "cancelled"
      ) {
        return reply
          .status(409)
          .send({ error: { code: "pipeline_terminal", status: pipeline.status } })
      }

      const { forkPipeline } = await import("../ee/pipelines/fork.js")
      const result = await forkPipeline(supabase, req.params.id)

      // Best-effort: drop any queued BullMQ jobs for this pipeline. In-flight
      // active jobs are left alone — letting them finish keeps the credit
      // accounting clean (refund of unused credits has already run). Errors
      // here are non-fatal; the fork has already committed.
      try {
        const { pipelineOrchestrationQueue } = await import("../ee/pipelines/queue.js")
        const queued = await pipelineOrchestrationQueue.getJobs(
          ["waiting", "delayed"],
          0,
          -1,
          false,
        )
        const matching = queued.filter(
          (job) => (job.data as { pipelineId?: string }).pipelineId === req.params.id,
        )
        await Promise.all(matching.map((j) => j.remove()))
      } catch (err) {
        console.error(
          "[pipelines/fork] queue cleanup failed:",
          err instanceof Error ? err.message : err,
        )
      }

      return reply.send(result)
    },
  )

  // ── POST /v1/pipelines/:id/sub-gates/:gate/approve ───────────────────────
  // Phase 1C.2 task L1. The user approves a mid-Stage-7 sub-gate
  // (dialogue_recheck / silent_cut_preview). Clears `current_sub_gate` from
  // the stage output, flips stage status back to 'running', and re-enqueues
  // the orchestrator so the chain resumes from where it paused. The
  // `sub_step_completed` flag for that sub-step is already set by the SUT
  // before the pause, so the resumed handler skips past it.
  app.post<{
    Params: { id: string; gate: string }
  }>(
    "/v1/pipelines/:id/sub-gates/:gate/approve",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const gateParsed = SubGateNameSchema.safeParse(req.params.gate)
      if (!gateParsed.success) {
        return reply.status(400).send({
          error: { code: "invalid_sub_gate", issues: gateParsed.error.issues },
        })
      }
      const gate = gateParsed.data

      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!pipeline || pipeline.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const { data: stageRow } = await supabase
        .from("pipeline_stages")
        .select("id, status, output")
        .eq("pipeline_id", req.params.id)
        .eq("stage_name", "animate_audio_edit")
        .maybeSingle()
      if (!stageRow) {
        return reply.status(404).send({ error: { code: "stage_not_found" } })
      }
      if (stageRow.status !== "awaiting_approval") {
        return reply.status(409).send({
          error: { code: "stage_not_awaiting_approval", status: stageRow.status },
        })
      }
      const output = (stageRow.output as Record<string, unknown> | null) ?? {}
      if (output.current_sub_gate !== gate) {
        // Existence-leak guard — wrong-gate mismatch returns 404 rather than
        // 409 so we don't leak which gate is currently active.
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Strip current_sub_gate from output (delete the key).
      const nextOutput: Record<string, unknown> = { ...output }
      delete nextOutput.current_sub_gate
      const resumedAt = new Date().toISOString()
      const { error: updateErr } = await supabase
        .from("pipeline_stages")
        .update({ status: "running", output: nextOutput })
        .eq("id", stageRow.id)
      if (updateErr) {
        return reply
          .status(500)
          .send({ error: { code: "db_error", detail: updateErr.message } })
      }

      // Emit a stage:status SSE so subscribers see the running transition.
      const { pipelineEvents } = await import("../ee/pipelines/events.js")
      pipelineEvents.publish({
        type: "stage:status",
        pipelineId: req.params.id,
        stageName: "animate_audio_edit",
        status: "running",
      })

      // Re-enqueue the orchestrator. The animate-audio-edit handler will
      // see the cleared sub_gate + updated sub_step_completed and resume.
      const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")
      await enqueuePipelineRun({
        pipelineId: req.params.id,
        userId,
        reason: "stage_advance",
      })

      return reply.send({ ok: true, gate, resumed_at: resumedAt })
    },
  )

  // ── POST /v1/pipelines/:id/sub-gates/:gate/reject ────────────────────────
  // The user rejects the sub-gate; the stage fails with
  // failure_reason='sub_gate_rejected:<gate>' and the pipeline cascades to
  // failed. Unspent credits are refunded. TODO Phase 1D: integrate
  // branch-from-stage on reject so the user can iterate without starting over.
  app.post<{
    Params: { id: string; gate: string }
    Body: { feedback?: string }
  }>(
    "/v1/pipelines/:id/sub-gates/:gate/reject",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const gateParsed = SubGateNameSchema.safeParse(req.params.gate)
      if (!gateParsed.success) {
        return reply.status(400).send({
          error: { code: "invalid_sub_gate", issues: gateParsed.error.issues },
        })
      }
      const gate = gateParsed.data

      const bodySchema = z.object({ feedback: z.string().max(2000).optional() })
      const bodyParsed = bodySchema.safeParse(req.body ?? {})
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", issues: bodyParsed.error.issues },
        })
      }
      const feedback = bodyParsed.data.feedback

      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!pipeline || pipeline.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const { data: stageRow } = await supabase
        .from("pipeline_stages")
        .select("id, status, output")
        .eq("pipeline_id", req.params.id)
        .eq("stage_name", "animate_audio_edit")
        .maybeSingle()
      if (!stageRow) {
        return reply.status(404).send({ error: { code: "stage_not_found" } })
      }
      if (stageRow.status !== "awaiting_approval") {
        return reply.status(409).send({
          error: { code: "stage_not_awaiting_approval", status: stageRow.status },
        })
      }
      const output = (stageRow.output as Record<string, unknown> | null) ?? {}
      if (output.current_sub_gate !== gate) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      // Mark stage failed with sub_gate_rejected reason + stash feedback.
      const nextOutput: Record<string, unknown> = { ...output }
      delete nextOutput.current_sub_gate
      nextOutput.failure_reason = `sub_gate_rejected:${gate}`
      if (feedback != null) nextOutput.reject_feedback = feedback
      const completedAt = new Date().toISOString()
      const { error: stageUpdateErr } = await supabase
        .from("pipeline_stages")
        .update({
          status: "failed",
          output: nextOutput,
          completed_at: completedAt,
        })
        .eq("id", stageRow.id)
      if (stageUpdateErr) {
        return reply
          .status(500)
          .send({ error: { code: "db_error", detail: stageUpdateErr.message } })
      }

      // Cascade to pipeline-level failure.
      await supabase
        .from("pipelines")
        .update({ status: "failed" })
        .eq("id", req.params.id)

      // Refund unspent credits.
      const { refundPipelineCredits } = await import("../ee/pipelines/credits.js")
      await refundPipelineCredits({
        supabase,
        userId,
        pipelineId: req.params.id,
        reason: `sub_gate_rejected:${gate}`,
      })

      const { pipelineEvents } = await import("../ee/pipelines/events.js")
      pipelineEvents.publish({
        type: "stage:status",
        pipelineId: req.params.id,
        stageName: "animate_audio_edit",
        status: "failed",
      })
      pipelineEvents.publish({
        type: "pipeline:status",
        pipelineId: req.params.id,
        status: "failed",
      })

      // TODO Phase 1D: integrate branch-from-stage on reject so the user
      // can iterate from the rejected sub-gate without abandoning the run.
      return reply.send({ ok: false, gate, reason: "rejected" })
    },
  )

  // ── POST /v1/pipelines/:id/branch ───────────────────────────────────────
  // Phase 1D.3 — clone a completed pipeline's upstream state into a new
  // pipeline that re-runs from the given stage. The original pipeline stays
  // `status='completed'`; the new pipeline starts `status='running'`.
  app.post<{ Params: { id: string }; Body: { fromStage: string } }>(
    "/v1/pipelines/:id/branch",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:execute")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      const bodyParsed = z
        .object({ fromStage: z.enum(STAGE_NAMES as [string, ...string[]]) })
        .safeParse(req.body)
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", issues: bodyParsed.error.issues },
        })
      }

      const { branchPipeline, BranchPipelineError } = await import(
        "../ee/pipelines/branch-pipeline.js"
      )

      try {
        const result = await branchPipeline({
          supabase,
          originalPipelineId: req.params.id,
          fromStage: bodyParsed.data.fromStage as PipelineStageName,
          userId,
        })
        return reply.status(201).send({
          pipelineId: result.newPipelineId,
          clonedStages: result.clonedStages,
          clonedEntities: result.clonedEntities,
        })
      } catch (err) {
        if (err instanceof BranchPipelineError) {
          const statusMap: Record<string, number> = {
            pipeline_not_found: 404,
            pipeline_not_completed: 400,
            forbidden: 403,
            invalid_stage: 400,
          }
          const httpStatus = statusMap[err.code] ?? 500
          return reply.status(httpStatus).send({ error: { code: err.code } })
        }
        throw err
      }
    },
  )

  // ── GET /v1/pipelines/:id/events  (SSE) ──────────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/v1/pipelines/:id/events",
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:read")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      // Ownership check.
      const { data: row } = await supabase
        .from("pipelines")
        .select("id,user_id")
        .eq("id", req.params.id)
        .maybeSingle()
      if (!row || row.user_id !== userId) {
        return reply.status(404).send({ error: { code: "not_found" } })
      }

      const sse = await createSSEStream(req, reply)
      const { pipelineEvents } = await import("../ee/pipelines/events.js")
      const unsub = pipelineEvents.subscribe(req.params.id, (event) => {
        sse.sendEvent({
          type: "execution",
          data: event as unknown as Record<string, unknown>,
        })
        if (
          event.type === "pipeline:done" ||
          event.type === "pipeline:completed" ||
          (event.type === "pipeline:status" &&
            (event.status === "completed" ||
              event.status === "failed" ||
              event.status === "cancelled"))
        ) {
          sse.close()
        }
      })
      req.raw.on("close", () => {
        unsub()
        sse.close()
      })
    },
  )
}
