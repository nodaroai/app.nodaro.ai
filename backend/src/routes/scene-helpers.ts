import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import type { ZodSchema } from "zod"
import {
  ImprovePromptInputSchema,
  GenerateMotionInputSchema,
  OptimizeForModelInputSchema,
  BridgeToNextSceneInputSchema,
  type ImprovePromptInput,
  type SceneHelperName,
  type SceneNodeData,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { hasCredits } from "../lib/config.js"
import { requireScope, type Scope } from "../lib/scopes.js"
import { supabase } from "../lib/supabase.js"

/**
 * Scene-Context helper routes — Phase 1B.3.
 *
 * 7 POST endpoints under `/v1/pipelines/:id/entities/:sceneId/helpers/<name>`.
 * Each handler runs the same gate sequence (edition → scope → auth → body
 * parse → context load → reserve credits → run → refund-on-failure); the
 * per-helper logic is captured in the {@link HELPERS} registry and dispatched
 * through {@link registerHelperRoute}.
 *
 * TODO Phase 1B.4: write a `pipeline_stage_attempts` row when undo lands
 * (requires migration extending the trigger CHECK to allow
 * `scene_helper:<name>`). The audit trail via `llm_calls` is sufficient for
 * 1B.3.
 */

function gateEdition(reply: FastifyReply): boolean {
  if (hasCredits()) return true
  void reply
    .status(403)
    .send({ error: { code: "edition_required", required_edition: "cloud" } })
  return false
}

// Scopes are only enforced for the OAuth dev-app path (mirrors `pipelines.ts`).
function gateScope(req: FastifyRequest, reply: FastifyReply, scope: Scope): boolean {
  if (!req.appAuthorization) return true
  const err = requireScope(req.appAuthorization.scopes ?? [], scope)
  if (!err) return true
  void reply.status(err.statusCode).send(err.body)
  return false
}

function gateAuth(req: FastifyRequest, reply: FastifyReply): string | null {
  if (req.userId) return req.userId
  void reply.status(401).send({ error: { code: "unauthorized" } })
  return null
}

type HelperContextOk = {
  ok: true
  plan: ShowrunnerPlan
  scene: SceneNodeData
  pipelineEntityId: string
  stageId: string
}
type HelperContextErr = { ok: false; status: number; code: string }

/**
 * Loads pipeline ownership + scene entity + Stage 1 plan. The three reads are
 * independent so they run in parallel; ownership is enforced on the fan-in.
 * Cross-user lookups return 404 `not_found` (not 403) to avoid leaking
 * existence.
 */
async function loadHelperContext(
  pipelineId: string,
  sceneEntityId: string,
  userId: string,
): Promise<HelperContextOk | HelperContextErr> {
  const [pipelineRes, entityRes, scriptRes] = await Promise.all([
    supabase.from("pipelines").select("id, user_id").eq("id", pipelineId).maybeSingle(),
    supabase
      .from("pipeline_entities")
      .select("id, stage_id, metadata, entity_type")
      .eq("id", sceneEntityId)
      .eq("pipeline_id", pipelineId)
      .eq("entity_type", "scene")
      .maybeSingle(),
    supabase
      .from("pipeline_stages")
      .select("output")
      .eq("pipeline_id", pipelineId)
      .eq("stage_name", "script")
      .maybeSingle(),
  ])

  const pipeline = pipelineRes.data
  if (!pipeline || pipeline.user_id !== userId) {
    return { ok: false, status: 404, code: "not_found" }
  }
  const entity = entityRes.data
  if (!entity) return { ok: false, status: 404, code: "scene_not_found" }
  const sceneNodeData = (entity.metadata as Record<string, unknown> | null)
    ?.scene_node_data as SceneNodeData | undefined
  if (!sceneNodeData) return { ok: false, status: 409, code: "scene_not_planned" }
  const plan = (scriptRes.data?.output as { plan?: ShowrunnerPlan } | undefined)?.plan
  if (!plan) return { ok: false, status: 409, code: "showrunner_plan_missing" }

  return {
    ok: true,
    plan,
    scene: sceneNodeData,
    pipelineEntityId: entity.id,
    stageId: (entity.stage_id as string | undefined) ?? "",
  }
}

interface HelperRunCtx {
  pipelineId: string
  pipelineEntityId: string
  stageId: string
  userId: string
  plan: ShowrunnerPlan
  scene: SceneNodeData
}

// Common kwargs every helper LLM accepts. Helpers that don't declare `plan` in
// their args interface silently ignore it (TS excess-property checks are
// suppressed via the spread at the call site).
function commonArgs(ctx: HelperRunCtx) {
  return {
    supabase,
    pipelineId: ctx.pipelineId,
    stageId: ctx.stageId,
    sceneId: ctx.pipelineEntityId,
    userId: ctx.userId,
    plan: ctx.plan,
    scene: ctx.scene,
  }
}

interface HelperConfig<TBody> {
  name: SceneHelperName
  body?: ZodSchema<TBody>
  run: (ctx: HelperRunCtx, body: TBody) => Promise<unknown>
}

// The `as HelperConfig<unknown>` cast lets each entry narrow its generic
// TBody while keeping the iteration site uniform.
const HELPERS: ReadonlyArray<HelperConfig<unknown>> = [
  {
    name: "audit_prompt",
    run: async (ctx) =>
      (await import("../ee/pipelines/llms/helpers/audit-prompt.js"))
        .runAuditPrompt(commonArgs(ctx)),
  } as HelperConfig<unknown>,
  {
    name: "improve_prompt",
    body: ImprovePromptInputSchema,
    run: async (ctx, body) =>
      (await import("../ee/pipelines/llms/helpers/improve-prompt.js"))
        .runImprovePrompt({ ...commonArgs(ctx), input: body as ImprovePromptInput }),
  } as HelperConfig<unknown>,
  {
    name: "generate_motion",
    body: GenerateMotionInputSchema,
    run: async (ctx, body) =>
      (await import("../ee/pipelines/llms/helpers/generate-motion.js"))
        .runGenerateMotion({
          ...commonArgs(ctx),
          shotIds: (body as { shot_ids: string[] }).shot_ids,
        }),
  } as HelperConfig<unknown>,
  {
    name: "optimize_for_model",
    body: OptimizeForModelInputSchema,
    run: async (ctx, body) =>
      (await import("../ee/pipelines/llms/helpers/optimize-for-model.js"))
        .runOptimizeForModel({
          ...commonArgs(ctx),
          targetModel: (body as { target_model: string }).target_model,
        }),
  } as HelperConfig<unknown>,
  {
    name: "add_broll",
    run: async (ctx) =>
      (await import("../ee/pipelines/llms/helpers/add-broll.js"))
        .runAddBRoll(commonArgs(ctx)),
  } as HelperConfig<unknown>,
  {
    name: "bridge_to_next_scene",
    body: BridgeToNextSceneInputSchema,
    run: async (ctx, body) =>
      (await import("../ee/pipelines/llms/helpers/bridge-to-next-scene.js"))
        .runBridgeToNextScene({
          ...commonArgs(ctx),
          targetShotId: (body as { target_shot_id: string }).target_shot_id,
        }),
  } as HelperConfig<unknown>,
  {
    // Uses `pipelineEntityId` instead of `sceneId` so it can link the
    // generated asset back to the scene entity.
    name: "anchor_scene_style",
    run: async (ctx) =>
      (await import("../ee/pipelines/llms/helpers/anchor-scene-style.js"))
        .runAnchorSceneStyle({ ...commonArgs(ctx), pipelineEntityId: ctx.pipelineEntityId }),
  } as HelperConfig<unknown>,
]

// Dynamic imports of the EE credit module stay inside the handler so
// `check-ee-imports` stays clean — core code must not statically import from
// `ee/`. The convention from `routes/pipelines.ts` is per-request dynamic.
function registerHelperRoute(app: FastifyInstance, cfg: HelperConfig<unknown>) {
  app.post<{ Params: { id: string; sceneId: string } }>(
    `/v1/pipelines/:id/entities/:sceneId/helpers/${cfg.name}`,
    async (req, reply) => {
      if (!gateEdition(reply)) return
      if (!gateScope(req, reply, "pipelines:approve")) return
      const userId = gateAuth(req, reply)
      if (!userId) return

      let parsedBody: unknown
      if (cfg.body) {
        const parsed = cfg.body.safeParse(req.body)
        if (!parsed.success) {
          return reply.status(400).send({
            error: { code: "validation_error", issues: parsed.error.issues },
          })
        }
        parsedBody = parsed.data
      }

      const ctx = await loadHelperContext(req.params.id, req.params.sceneId, userId)
      if (!ctx.ok) return reply.status(ctx.status).send({ error: { code: ctx.code } })

      const { reserveHelperCredits, refundHelperCredits } = await import(
        "../ee/pipelines/scene-helper-credits.js"
      )
      const reservation = await reserveHelperCredits({
        supabase,
        userId,
        helperName: cfg.name,
      })
      if (!reservation.ok) {
        const status = reservation.reason === "price_not_configured" ? 503 : 402
        return reply.status(status).send({ error: { code: reservation.reason } })
      }

      try {
        const result = await cfg.run(
          {
            pipelineId: req.params.id,
            pipelineEntityId: ctx.pipelineEntityId,
            stageId: ctx.stageId,
            userId,
            plan: ctx.plan,
            scene: ctx.scene,
          },
          parsedBody,
        )
        return reply.send(result)
      } catch (err) {
        await refundHelperCredits(supabase, reservation.usageLogId)
        return reply.status(500).send({
          error: {
            code: "helper_failed",
            detail: err instanceof Error ? err.message : "unknown",
          },
        })
      }
    },
  )
}

export async function sceneHelpersRoutes(app: FastifyInstance) {
  for (const cfg of HELPERS) registerHelperRoute(app, cfg)
}
