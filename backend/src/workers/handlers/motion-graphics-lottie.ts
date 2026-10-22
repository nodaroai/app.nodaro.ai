/**
 * Worker handler for the `motion-graphics-lottie` job (Lottie engine, design §3).
 *
 * Async LLM path: the route (P1.8) / payload-builder (P1.9) enqueue a
 * MotionGraphicsLottiePayload; this handler calls the LLM to author a COMPLETE
 * Lottie (Bodymovin) document, validates + auto-fixes it via the pure
 * `validateLottieGraphic` layer, and persists the assembled render plan.
 *
 * Failure semantics (charge-for-nothing guard): a parse/validation failure that
 * survives ONE bounded retry throws a plain Error BEFORE `markJobCompleted`, so
 * the worker's final-attempt catch marks the job failed and refunds the
 * reserved credits. The handler NEVER writes `provider_kind` — the worker's
 * generic "pre-task" pickup is the stale-sweep contract.
 *
 * Metered (a hold reserved under `motion-graphics-lottie:<model>`): the first
 * answer AND the repair attempt are both charged what they cost — the hold
 * covers the first only (D1) — settled before the completion; a failed run is
 * charged its billed calls through the failure net (the spend rides the
 * thrown error), never refunded for them.
 */

import { applySlots } from "@nodaro/shared/media"
import { llmComplete } from "../../lib/llm-client.js"
import { extractJsonFromAIResponse } from "../../lib/json-utils.js"
import { validateLottieGraphic } from "../../lib/lottie-graphic-validator.js"
import { uploadBufferToR2 } from "../../lib/storage.js"
import { buildLottieRequest, buildLottieUserMessage, lottieModelId, type MotionGraphicsLottiePayload } from "../../lib/lottie-request.js"
import {
  type HandlerFn,
  attachLlmSpend,
  markJobCompleted,
  commitJobCredits,
  setJobProgress,
  shouldSaveJobResult,
  workerLlmBilling,
} from "../shared.js"

const handleMotionGraphicsLottie: HandlerFn = async function handleMotionGraphicsLottie(job, ctx) {
  const payload = job.data as MotionGraphicsLottiePayload
  const { prompt, fps, width, height, durationInFrames, backgroundColor, previousSids } = payload
  const modelId = lottieModelId(payload)
  console.log(`[worker] motion-graphics-lottie ${ctx.jobId} (model: ${modelId})`)

  const expected = { fps, width, height, durationInFrames, backgroundColor }
  const userMessage = buildLottieUserMessage({ prompt, fps, width, height, durationInFrames, previousSids })
  const billing = await workerLlmBilling(ctx, job)

  let totalProviderCost = 0
  let lastUsage: unknown

  const attempt = async (messages: Array<{ role: "user" | "assistant"; content: string }>) => {
    const request = buildLottieRequest(payload, messages)
    let response: Awaited<ReturnType<typeof llmComplete>>
    try {
      response = await llmComplete(request)
    } catch (err) {
      billing.recorder.add(modelId, request, { error: err })
      throw err
    }
    billing.recorder.add(modelId, request, { response })
    await billing.noteSpend()
    totalProviderCost += response.providerCost ?? 0
    lastUsage = response.usage
    let parsed: unknown
    let parseError: string | undefined
    try {
      parsed = JSON.parse(extractJsonFromAIResponse(response.text))
    } catch {
      parseError = "Response was not valid JSON."
    }
    const validation = parseError ? null : validateLottieGraphic(parsed, expected)
    return { responseText: response.text, parseError, validation }
  }

  try {
    await authorAndFinish()
  } catch (err) {
    // Every billed call (the first answer, the repair) is recorded on the row
    // (a cancel during a retry's backoff sees it; the retry carries it) and
    // rides the error to the failure net, which charges them on a metered hold.
    await billing.noteSpend()
    throw attachLlmSpend(err, billing.spend)
  }

  async function authorAndFinish(): Promise<void> {
    // R38: the first call is next — the row stops being "pre-call" (a row
    // cancelled first throws here and is never sent the call).
    await billing.callStarting()
    let result = await attempt([{ role: "user", content: userMessage }])

    if (result.parseError || result.validation!.rejected) {
      const problems = result.parseError ?? result.validation!.errors.join("\n")
      console.log(`[worker] motion-graphics-lottie ${ctx.jobId} retry after validation failure`)
      result = await attempt([
        { role: "user", content: userMessage },
        { role: "assistant", content: result.responseText },
        {
          role: "user",
          content: `Your Lottie JSON failed validation:\n${problems}\n\nReturn the corrected COMPLETE JSON object only.`,
        },
      ])
      if (result.parseError) {
        throw new Error("AI returned invalid JSON for the Lottie animation. Please try again.")
      }
      if (result.validation!.rejected) {
        throw new Error(`Lottie validation failed: ${result.validation!.errors.join("; ")}`)
      }
    }

    const validation = result.validation!
    if (validation.autoFixed.length > 0) {
      console.log(`[worker] motion-graphics-lottie ${ctx.jobId} auto-fixes: ${validation.autoFixed.join(", ")}`)
    }

    await setJobProgress(job, ctx.jobId, 100)
    if (!(await shouldSaveJobResult(ctx.jobId))) {
      // R38: cancelled mid-run — the result is discarded, but the hold is
      // still settled (what the calls billed charged, nothing billed refunded;
      // the row stays cancelled). A tier hold: no-op, the cancel refunded it.
      await billing.settle()
      return
    }

    // Persist the authored Lottie JSON to R2 so it can flow over the `lottie`
    // source handle into lottie-overlay (Phase 4). This is ADDITIVE — the inline
    // plan in output_data is fully usable for preview + render without it, so a
    // failed upload NEVER fails the job (no refund, no throw). The deterministic
    // key (`lottie/<jobId>.json`) is never deleted on failure (repo invariant).
    // Placed after the shouldSaveJobResult gate so cancelled jobs skip the upload.
    let lottieUrl: string | undefined
    try {
      // Bake the slot manifest into the document before export. The validator
      // hoists root slots into `plan.slots` and leaves `{"sid": "..."}` reference
      // nodes inside `plan.lottie`; uploading that raw document ships UNRESOLVED
      // refs that render broken wherever a slot is referenced (Phase-4 bug). The
      // baked document is the standalone asset the `lottie` source handle feeds to
      // lottie-overlay. (No overrides here — the engine's own UI applies those.)
      const bakedLottie = applySlots(
        validation.plan!.lottie as Record<string, unknown>,
        validation.plan!.slots as Record<string, unknown>,
        {},
      )
      const lottieBuffer = Buffer.from(JSON.stringify(bakedLottie), "utf-8")
      lottieUrl = await uploadBufferToR2(lottieBuffer, `lottie/${ctx.jobId}.json`, "application/json", ctx.jobUserId)
    } catch (err) {
      console.warn(
        `[worker] motion-graphics-lottie ${ctx.jobId} lottie JSON upload failed (plan still delivered):`,
        err,
      )
    }

    // Metered: settle BEFORE the completion (an unconfirmed settle leaves the
    // row for the reconcile sweep). The settle writes provider_cost and the
    // billing ledger (its own server-only column — never output_data, R32).
    const settled = await billing.settle()
    if (settled.metered && settled.outcome === "unsettled") return

    const ok = await markJobCompleted(ctx.jobId, {
      output_data: {
        motionPlan: validation.plan,
        validationErrors: validation.errors,
        autoFixes: validation.autoFixed,
        usage: lastUsage,
        ...(lottieUrl ? { lottieUrl } : {}),
      },
      ...(settled.metered ? {} : { provider_cost: totalProviderCost || null }),
      // The receipt's charge rides the completion too (the settle wrote it; a lost write never reports the hold).
      ...(settled.metered && settled.charged !== undefined ? { credits_actual: settled.charged } : {}),
    })
    if (!ok) return

    if (!settled.metered) await commitJobCredits(ctx.usageLogId, ctx.jobId, totalProviderCost || undefined)
    const layerCount = (validation.plan!.lottie as { layers?: unknown[] }).layers?.length ?? 0
    console.log(`[worker] Job ${ctx.jobId} completed: lottie-graphic plan (${layerCount} layers)`)
  }
}

export const motionGraphicsLottieHandlers: Record<string, HandlerFn> = {
  "motion-graphics-lottie": handleMotionGraphicsLottie,
}

export { buildLottieRequest, type MotionGraphicsLottiePayload } from "../../lib/lottie-request.js"
