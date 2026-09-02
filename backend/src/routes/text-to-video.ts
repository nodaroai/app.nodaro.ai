import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { videoQueue } from "../lib/queue.js"
import { shotsSchema, elementsSchema } from "../lib/video-schemas.js"
import { effectiveVideoPromptCeiling } from "../lib/video-prompt-ceiling.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { resolveVideoRequestNorm } from "../lib/video-request-norm.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { insertJobIdempotent } from "../lib/insert-job.js"
import { sendInternalError } from "../lib/http-errors.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { TEXT_TO_VIDEO_PROVIDERS, SEEDANCE_2_5_REF_LIMITS, PROMPT_HARD_CEILING, videoProviderRequiresImage, isSeedance2Provider, isMinimaxH3Provider, applyDefaultVideoSelection, buildVideoCreditModelIdentifier, type ConnectedReference } from "@nodaro/shared"
import { imageRequiredError } from "../lib/video-image-required.js"
import { composeVideoPromptText } from "@nodaro/prompts"
import { connectedReferenceSchema } from "../lib/connected-reference-schema.js"
import { directionSchema } from "../lib/direction-schema.js"
import { subjectSchema } from "../lib/subject-schema.js"
import { assembleVideoConnectedReferences, validateRefVideoDurationPreHandler } from "./generate-video.js"
import { formatZodError } from "../lib/zod-error.js"

export const textToVideoBody = z.object({
  prompt: z.string().min(1).max(PROMPT_HARD_CEILING),
  userPrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  provider: z.enum(TEXT_TO_VIDEO_PROVIDERS).optional(),
  duration: z.number().int().min(1).max(60).optional(),
  mode: z.enum(["pro", "std", "4K"]).optional(),
  sound: z.boolean().optional(),
  negativePrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  cfgScale: z.number().min(0).max(1).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "21:9", "9:21", "adaptive"]).optional(),
  multiShot: z.boolean().optional(),
  shots: shotsSchema.optional(),
  elements: elementsSchema.optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  resolution: z.string().optional(),
  generateAudio: z.boolean().optional(),
  // Wire ceiling = the widest provider's caps (Seedance 2.5: 30/10/10);
  // per-provider enforcement lives in the input resolvers.
  referenceImageUrls: z.array(safeUrlSchema).max(SEEDANCE_2_5_REF_LIMITS.images).optional(),
  referenceVideoUrls: z.array(safeUrlSchema).max(SEEDANCE_2_5_REF_LIMITS.videos).optional(),
  referenceAudioUrls: z.array(safeUrlSchema).max(SEEDANCE_2_5_REF_LIMITS.audio).optional(),
  // Structured references (parity with generate-video). When present, the route
  // assembles them server-side via the shared video resolver — auto-attaching
  // unmentioned wired refs to referenceImageUrls, emitting per-ref directives, and
  // expanding {image:N} tokens. Absent → byte-identical to the flat path.
  connectedReferences: z.array(connectedReferenceSchema).max(14).optional(),
  referenceOrder: z.array(z.string()).max(14).optional(),
  // Structured cinematic direction: catalog IDS, not hint text (parity with
  // /v1/generate-video, same shared schema). Rendered server-side with the
  // platform's verbosity policy; absent → byte-identical to the flat path.
  direction: directionSchema.optional(),
  // Structured SUBJECT ids (parity with /v1/generate-image and
  // /v1/generate-video, same shared schema). Folded ahead of the direction
  // clauses; absent → byte-identical to the flat path.
  subject: subjectSchema.optional(),
  webSearch: z.boolean().optional(),
  nsfwChecker: z.boolean().optional(),
  // VEO 3.x: opt out of KIE's auto-translate-to-English (default true
  // upstream). Set false to keep prompts verbatim. No effect on non-VEO.
  enableTranslation: z.boolean().optional(),
  userId: z.string().uuid().optional(),
})

export async function textToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-video", {
    // The duration pre-check runs BEFORE creditGuard so an out-of-bounds
    // reference clip is a 400 with nothing reserved — and its probe is what
    // computeCredits below reuses. Shared with /v1/generate-video (one copy).
    preHandler: [validateRefVideoDurationPreHandler, creditGuard(
      (req) => {
        const body = req.body as Record<string, unknown>
        const hasVideoRef = Array.isArray(body?.referenceVideoUrls) && (body.referenceVideoUrls as unknown[]).length > 0
        const sel = applyDefaultVideoSelection({ provider: body?.provider as string | undefined, duration: body?.duration as number | string | undefined })
        // Placement rule: the CHECK identifier, `computeCredits` and the
        // reservation must all be computed from the SAME normalized values.
        // Stash them so the two later sites cannot re-derive them differently.
        const norm = resolveVideoRequestNorm({
          provider: sel.provider,
          aspectRatio: body?.aspectRatio as string | undefined,
          resolution: body?.resolution as string | undefined,
          duration: sel.duration,
        })
        req.videoNorm = norm
        return buildVideoCreditModelIdentifier(
          sel.provider,
          norm.duration ?? sel.duration,
          body?.sound as boolean | undefined,
          "text-to-video",
          body?.mode as string | undefined,
          norm.resolution,
          hasVideoRef,
        )
      },
      {
        computeCredits: async (body, req) => {
          const b = body as Record<string, unknown>
          const hasVideoRef = Array.isArray(b?.referenceVideoUrls) && (b.referenceVideoUrls as unknown[]).length > 0
          // R14: read the resolution the CHECK identifier was built from, never
          // the raw body — normalizing in the preHandler but not here would make
          // the reserved AMOUNT disagree with the checked IDENTIFIER, which is
          // the exact drift this normalizer exists to remove.
          const normResolution = req.videoNorm?.resolution ?? (b.resolution as string | undefined)
          // Seedance 2 reference-video runs bill unit×(input+output): ffprobe the
          // connected reference videos and reserve the FULL scaled base up front
          // (commit_credits only refunds — never up-charges). Core may not
          // statically import ee/, so the helpers are loaded dynamically (the
          // allowed escape hatch — same pattern the credit-guard shim uses).
          if (isSeedance2Provider(b?.provider as string | undefined) && hasVideoRef) {
            const { seedance2RefVideoBaseCreditsFromUrls, seedance2RefVideoBaseCreditsFromDurations } =
              await import("../ee/billing/seedance2-ref-video-credits.js")
            const priceArgs = {
              provider: b.provider as string,
              resolution: normResolution ?? "720p",
              outputDurationSec: Number(b.duration ?? 5),
            }
            // Probe once, use twice: when validateRefVideoDurationPreHandler
            // already ffprobed this request (it runs first, for every provider
            // with a declared duration limit), price from ITS durations rather
            // than paying for a second uncached probe per clip. Identical
            // arithmetic — the same worst-case rule applies to a NaN entry —
            // so the CHECK and the DEBIT read the same probed set.
            const stashed = req.refVideoDurationsSec
            if (stashed) {
              return seedance2RefVideoBaseCreditsFromDurations({ ...priceArgs, durationsSec: stashed })
            }
            return seedance2RefVideoBaseCreditsFromUrls({
              ...priceArgs,
              referenceVideoUrls: b.referenceVideoUrls as unknown[],
            })
          }
          // MiniMax Hailuo 3: unit×(input+output) for ref-video runs + a
          // surcharge for input images beyond the first 5. Predict the
          // ASSEMBLED reference-image count the same way the handler will
          // (connectedReferences → referenceImageUrls; t2v has no frames).
          // The `direction` fold is not applied here and does not need to be:
          // it is text-only, and the billed quantity is the reference count.
          // See the same note in generate-video.ts for the guard that closes
          // the one shape which could couple prompt text to that count.
          if (isMinimaxH3Provider(b?.provider as string | undefined)) {
            const { minimaxH3BaseCreditsFromUrls, minimaxH3BaseCreditsFromDurations, minimaxH3BillableRefImageCount, MINIMAX_H3_FREE_INPUT_IMAGES } =
              await import("../ee/billing/minimax-h3-credits.js")
            const refVideos = Array.isArray(b.referenceVideoUrls) ? (b.referenceVideoUrls as unknown[]) : []
            const assembled = assembleVideoConnectedReferences({
              prompt: b.prompt as string | undefined,
              provider: b.provider as string,
              connectedReferences: (Array.isArray(b.connectedReferences) ? b.connectedReferences : []) as ConnectedReference[],
              baseReferenceImageUrls: (Array.isArray(b.referenceImageUrls) ? b.referenceImageUrls : undefined) as string[] | undefined,
              referenceOrder: (Array.isArray(b.referenceOrder) ? b.referenceOrder : undefined) as string[] | undefined,
              referenceVideoCount: refVideos.length,
              referenceAudioCount: Array.isArray(b.referenceAudioUrls) ? (b.referenceAudioUrls as unknown[]).length : 0,
            })
            const refImageCount = minimaxH3BillableRefImageCount({
              referenceImageUrls: assembled.referenceImageUrls,
              referenceVideoUrls: refVideos,
              referenceAudioUrls: Array.isArray(b.referenceAudioUrls) ? (b.referenceAudioUrls as unknown[]) : undefined,
            })
            if (hasVideoRef || refImageCount > MINIMAX_H3_FREE_INPUT_IMAGES) {
              const h3PriceArgs = {
                outputDurationSec: Number(b.duration ?? 6),
                referenceImageCount: refImageCount,
                resolution: normResolution,
              }
              // Probe once, use twice (R15) — same contract as the seedance
              // branch above: validateRefVideoDurationPreHandler already
              // ffprobed this request (minimax-h3 has a declared bound), so the
              // DEBIT prices from the very array the CHECK read, NaN included.
              const stashed = req.refVideoDurationsSec
              if (stashed) {
                return minimaxH3BaseCreditsFromDurations({ ...h3PriceArgs, durationsSec: stashed })
              }
              return minimaxH3BaseCreditsFromUrls({ ...h3PriceArgs, referenceVideoUrls: refVideos })
            }
            // No ref videos and ≤5 images → the seeded duration composite prices it.
          }
          // Non-ref / other providers: the normal base for the resolved identifier
          // (matches how generate-video computes its non-addon base).
          const bSel = applyDefaultVideoSelection({ provider: b?.provider as string | undefined, duration: b?.duration as number | string | undefined })
          const modelId = buildVideoCreditModelIdentifier(
            bSel.provider,
            req.videoNorm?.duration ?? bSel.duration,
            b?.sound as boolean | undefined,
            "text-to-video",
            b?.mode as string | undefined,
            normResolution,
            hasVideoRef,
          )
          const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
          const { creditCost } = await getModelCreditBaseCost(modelId)
          return creditCost
        },
      },
    )],
  }, async (req, reply) => {
    const parsed = textToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { provider: rawProvider, duration: rawDuration, mode, sound, negativePrompt, cfgScale, aspectRatio, multiShot, shots, elements, seed, resolution, generateAudio, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, enableTranslation } = parsed.data
    // Platform default when the request omits provider/duration (shared with
    // generate-video and the DAG payload builder).
    const { provider, duration } = applyDefaultVideoSelection({ provider: rawProvider, duration: rawDuration })
    // Recomputed rather than read off `req` so the handler is correct even when
    // credits are disabled (community edition never runs the guard). Pure, so it
    // agrees with the preHandler by construction.
    const normalized = resolveVideoRequestNorm({ provider, aspectRatio, resolution, duration })
    const normAspectRatio = normalized.aspectRatio
    const normResolution = normalized.resolution
    const normDuration = normalized.duration ?? duration
    if (normalized.adjustments.length > 0) {
      req.log.warn({ provider, adjustments: normalized.adjustments }, "[text-to-video] snapped catalog-governed params")
    }
    // `prompt` + `referenceImageUrls` are reassigned by the connectedReferences
    // assembly below (when present), so they're `let`, not part of the const destructure.
    let prompt = parsed.data.prompt
    let referenceImageUrls = parsed.data.referenceImageUrls
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Image-to-video-only models (e.g. Grok Imagine Video 1.5) are surfaced in the
    // T2V provider set for unified-node visibility, but KIE requires an input image.
    // Fail fast with a clear message instead of letting the prompt-only request
    // reach the provider. The creditGuard preHandler only checks balance — no
    // reservation happens until reserveCreditsForJob below, so returning here is clean.
    if (videoProviderRequiresImage(provider)) {
      return reply.status(400).send(imageRequiredError(provider, "text-to-video"))
    }

    // Subject + cinematic direction fold — catalog IDS → prompt text,
    // server-side. Same shape and same fold SITE as generate-video: before the
    // reference assembly below, because the resolver frames the body. Neither
    // channel → `composeVideoPromptText` returns `prompt` verbatim, so the flat
    // path is byte-identical. (`prompt` is required on this route, so the composer's
    // absent-prompt branch is dead here — the identical shape is deliberate so
    // the two routes read the same.)
    // The clamp's EFFECTIVE ceiling, not the raw cap: a non-native negative
    // prompt is folded in as a "\nAvoid: …" suffix whose room the clamp reserves
    // FIRST, so budgeting on the cap would shed too little on exactly the runs
    // that get truncated. Same helper as generate-video, one mirror.
    const promptCeiling = effectiveVideoPromptCeiling(provider, negativePrompt)

    // The framing the cap is measured through — identical to generate-video's,
    // and gated the same way as the assembly below. The resolver runs AFTER the
    // fold and APPENDS binding text, so it must be inside the shed's budget
    // while staying un-sheddable. Pure: safe to call once per shed iteration.
    const connectedRefs = parsed.data.connectedReferences
    const frameWithReferences = (body: string | undefined): string | undefined =>
      connectedRefs && connectedRefs.length > 0
        ? assembleVideoConnectedReferences({
          prompt: body,
          provider,
          connectedReferences: connectedRefs,
          baseReferenceImageUrls: parsed.data.referenceImageUrls,
          referenceOrder: parsed.data.referenceOrder,
          referenceVideoCount: parsed.data.referenceVideoUrls?.length ?? 0,
          referenceAudioCount: parsed.data.referenceAudioUrls?.length ?? 0,
        }).prompt
        : body

    if (parsed.data.direction || parsed.data.subject) {
      // TRUNCATION ORDERING: hint clauses shed last-folded-first rather than the
      // order-blind clamp cutting whatever happens to be last. Under-cap runs
      // are byte-identical to the capless fold. Both catalog channels ride the
      // one sheddable list (subject ahead of direction, so direction leaves
      // first), which is why a subject-only fold needs no second budget.
      const composed = composeVideoPromptText(prompt, parsed.data.direction, undefined, {
        ...(parsed.data.subject !== undefined ? { subject: parsed.data.subject } : {}),
        cap: promptCeiling,
        frame: frameWithReferences,
      })
      if (composed !== undefined && composed !== prompt) {
        // `input_data.userPrompt` records the SOURCE, never the render.
        parsed.data.userPrompt ??= prompt
        prompt = composed
        parsed.data.prompt = prompt
      }
    }

    // Structured references (parity with generate-video / generate-image): assemble
    // connectedReferences server-side via the SAME shared resolver the canvas +
    // orchestrator use, so an MCP/SDK t2v run binds inline {image:N} references
    // identically. Absent → flat path untouched. Provider-gated by the cap map.
    if (parsed.data.connectedReferences && parsed.data.connectedReferences.length > 0) {
      const assembled = assembleVideoConnectedReferences({
        prompt,
        provider,
        connectedReferences: parsed.data.connectedReferences,
        baseReferenceImageUrls: referenceImageUrls,
        referenceOrder: parsed.data.referenceOrder,
        referenceVideoCount: referenceVideoUrls?.length ?? 0,
        referenceAudioCount: referenceAudioUrls?.length ?? 0,
      })
      prompt = assembled.prompt ?? prompt
      referenceImageUrls = assembled.referenceImageUrls
      // Mirror into parsed.data so buildJobInputData records what the worker gets.
      parsed.data.prompt = prompt
      parsed.data.referenceImageUrls = referenceImageUrls
    }

    // Truncation warning on the ASSEMBLED prompt — the string the shed budgeted
    // for and the one the clamp will cut. Reaching here means the overflow was
    // UNSHEDABLE (prose or bindings alone clear the ceiling). Mirrors
    // generate-video, including the fold gate — EITHER catalog channel, since a
    // subject-only fold renders text the platform is equally responsible for.
    if ((parsed.data.direction || parsed.data.subject) && prompt.length > promptCeiling) {
      req.log.warn(
        { provider, promptLength: prompt.length, promptCeiling },
        "[text-to-video] assembled prompt exceeds the provider ceiling after shedding every hint; the tail will be clamped",
      )
    }

    // B4b: apply any registered video PromptPolicy at the server-authoritative
    // final prompt (structured assembly + flat path). Mirror into parsed.data so
    // buildJobInputData records what the worker receives. Inert by default.
    prompt = applyPromptPolicies({ prompt, negativePrompt: "", kind: "video" }).prompt
    parsed.data.prompt = prompt

    // Determine model identifier for credit check (supports variable pricing by duration/audio/resolution/video-ref)
    const modelIdentifier = buildVideoCreditModelIdentifier(
      provider ?? "minimax",
      normDuration,
      sound,
      "text-to-video",
      mode,
      normResolution,
      (referenceVideoUrls?.length ?? 0) > 0,
    )

    const mcpClient = extractMcpClient(req.body)
    // job_type powers the reconcile cron's correct finalization path —
    // see lib/reconcile/replicate.ts (defaults to "generate-image" when
    // null, which mis-uploads videos as images).
    //
    // Race-proof INSERT via DB UNIQUE constraint on (user_id,
    // idempotency_key). See generate-image.ts for full rationale.
    let insertResult: { row: { id: string }; created: boolean }
    try {
      insertResult = await insertJobIdempotent<{ id: string }>(
        req,
        {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          job_type: "text-to-video",
          status: "pending",
          // R26: the normalized values are passed in rather than written back
          // onto `parsed.data` — the handler destructured above, so a mutation
          // would be invisible to every reader AND against the no-mutation rule.
          input_data: buildJobInputData(
            { ...parsed.data, aspectRatio: normAspectRatio, resolution: normResolution, duration: normDuration },
            "text-to-video",
          ),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        },
        req.idempotencyKey,
      )
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to create video generation job")
    }
    const job = insertResult.row

    if (!insertResult.created) {
      reply.header("X-Dedup-Hit", "1")
      return reply.code(200).send({ jobId: job.id, deduped: true })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("text-to-video", {
      jobId: job.id,
      prompt,
      provider,
      duration: normDuration,
      mode,
      sound,
      negativePrompt,
      cfgScale,
      aspectRatio: normAspectRatio,
      multiShot,
      shots,
      elements,
      seed,
      resolution: normResolution,
      generateAudio,
      referenceImageUrls,
      referenceVideoUrls,
      referenceAudioUrls,
      webSearch,
      nsfwChecker,
      enableTranslation,
      usageLogId,
    })

    // Disclose any lever the caller asked for and did not get. The route has no
    // pre-existing `warnings` vocabulary (unlike generate-video), so the
    // structured adjustments are the disclosure.
    return normalized.adjustments.length > 0
      ? { jobId: job.id, adjustments: normalized.adjustments }
      : { jobId: job.id }
  })
}
