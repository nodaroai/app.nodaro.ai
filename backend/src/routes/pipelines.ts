import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { z } from "zod"
import {
  ENTITY_TYPES,
  EntityRejectInputSchema,
  PipelineInputSchema,
  SubGateNameSchema,
  validateDurationForFormat,
  validateModeActivation,
  type PipelineStageName,
} from "@nodaro/shared"
import { hasCredits } from "../lib/config.js"
import { requireScope, type Scope } from "../lib/scopes.js"
import { createSSEStream } from "../lib/sse.js"
import { supabase } from "../lib/supabase.js"

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

    // mode normalization (auto_mode legacy)
    const mode = input.mode ?? (input.auto_mode ? "auto" : "manual")
    // When userId is set (JWT or OAuth user), this is an interactive activation.
    // Pure-programmatic activation (no user) is reserved for future internal
    // automation paths; routes always have a userId at this point.
    const activation = "interactive"

    const dv = validateDurationForFormat(input.format, input.target_duration_seconds)
    if (!dv.ok) {
      return reply.status(400).send({
        error: { code: "duration_out_of_bounds", message: dv.reason },
      })
    }
    const mv = validateModeActivation(mode, activation)
    if (!mv.ok) {
      return reply.status(400).send({
        error: { code: "mode_incompatible_with_activation", message: mv.reason },
      })
    }

    const { estimateUpfrontCredits, reservePipelineCredits, resolveMaxCostCredits } =
      await import("../ee/pipelines/credits.js")
    const { enqueuePipelineRun } = await import("../ee/pipelines/queue.js")

    const userTier = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", userId)
      .single()
      .then((r) => r.data?.tier ?? "free")

    const config = input.config ?? {}
    const upfront = estimateUpfrontCredits({
      targetDurationSeconds: input.target_duration_seconds,
      format: input.format,
      mode,
      musicEnabled: config.music_enabled ?? true,
      narrationEnabled: config.narration_enabled ?? true,
      lipsyncEnabled: config.lipsync_enabled ?? true,
    })
    const maxCost = resolveMaxCostCredits({
      requested: input.max_cost_credits,
      tier: userTier,
    })

    // 1. Insert pipeline row.
    const { data: pipeline, error: insertErr } = await supabase
      .from("pipelines")
      .insert({
        user_id: userId,
        workflow_id: input.workflow_id ?? null,
        root_node_id: input.root_node_id,
        pipeline_type: input.pipeline_type,
        activation_mode: activation,
        mode,
        input_prompt: input.story_prompt,
        target_duration_seconds: input.target_duration_seconds,
        format: input.format,
        output_resolution: input.output_resolution,
        language: input.language,
        style_directives: input.style_directives ?? null,
        config,
        upfront_credit_estimate: upfront,
        reserved_credits: upfront,
        max_cost_credits: maxCost,
      })
      .select("id")
      .single()
    if (insertErr || !pipeline) {
      return reply
        .status(500)
        .send({ error: { code: "db_error", detail: insertErr?.message } })
    }

    // 2. Reserve credits.
    const reservation = await reservePipelineCredits({
      supabase,
      userId,
      pipelineId: pipeline.id,
      credits: upfront,
    })
    if (!reservation.ok) {
      // Roll back the pipeline row — cheaper than carrying a dead 'queued' row around.
      await supabase.from("pipelines").delete().eq("id", pipeline.id)
      return reply.status(402).send({ error: { code: reservation.reason } })
    }

    // 3. Enqueue.
    await enqueuePipelineRun({ pipelineId: pipeline.id, userId, reason: "initial" })

    return reply.status(201).send({ id: pipeline.id })
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
        "id,status,current_stage,spent_credits,reserved_credits,upfront_credit_estimate,user_id",
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

  // ── GET /v1/pipelines ────────────────────────────────────────────────────
  app.get("/v1/pipelines", async (req, reply) => {
    if (!gateEdition(reply)) return
    if (!gateScope(req, reply, "pipelines:read")) return
    const userId = gateAuth(req, reply)
    if (!userId) return

    const { data, error } = await supabase
      .from("pipelines")
      .select(
        "id,status,current_stage,spent_credits,reserved_credits,upfront_credit_estimate,created_at",
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
        .select("status,output,critic_feedback,started_at,completed_at")
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
      await supabase
        .from("pipelines")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", pipeline.id)
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

      if (req.params.stage_name !== "script") {
        return reply.status(400).send({
          error: {
            code: "stage_not_implemented",
            message: "Only Stage 1 (script) is implemented in Phase 1A",
          },
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

      const { approveScriptStage } = await import("../ee/pipelines/engine.js")
      const result = await approveScriptStage(supabase, req.params.id, req.body?.edits)
      if (!result.ok) return reply.status(409).send({ error: { code: result.reason } })
      return reply.send({ ok: true })
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
