/**
 * Probe 1 — AUTHORING.
 *
 * One paid Pro run from a brief and its references, then two things that must
 * cost nothing extra: a deterministic edit, and a render-only re-export of the
 * revision the run produced.
 *
 * The pairing is the point. "Authoring works" is easy to demonstrate; what the
 * contract actually promises is that authoring is a ONE-TIME cost — that an
 * existing revision can be edited arithmetically and re-exported without
 * re-planning it. A probe that only measured the first run would pass on a
 * deployment that silently re-authors on every export, which is the exact
 * regression the source union exists to prevent.
 */
import { parseReference, toInt, toNumber } from "../lib/args.mjs"
import { HarnessError, idempotencyKeyFor, makeClient, readBalance, readCapabilities, requireProCapability, stampPrompt } from "../lib/client.mjs"
import { applyDeterministicEdit } from "../lib/edit.mjs"
import { resolvePrompt } from "../lib/harness.mjs"
import { shortHash } from "../lib/parity.mjs"
import { followJob, phaseTimings, readJobRecord } from "../lib/poll.mjs"
import { authoringLines, promptSourceParams, quoteAndRun, renderOnlyParams, repairEvidence, summarizeProOutput, summarizeQuote } from "../lib/pro.mjs"

export const NAME = "authoring"

export async function main(ctx) {
  const { values, args, receipt } = ctx
  const brief = await resolvePrompt({ prompt: values.prompt, promptFile: values["prompt-file"], what: "brief" })
  const references = [
    ...(values.ref ?? []).map((spec, index) => parseReference(spec, index, { defaultRole: "appearance", kind: "image" })),
    ...(values["motion-ref"] ? [parseReference(`${values["motion-ref"]}#motion`, 90, { kind: "video" })] : []),
  ]
  const durationSeconds = toNumber(values.duration, "duration", { min: 1, max: 600 })
  const fps = toInt(values.fps, "fps", { min: 1, max: 60 })
  const aspectRatio = values.aspect
  const maxRepairPasses = toInt(values["repair-passes"], "repair-passes", { min: 0, max: 2 })

  const stampedPrompt = stampPrompt(brief.text, ctx.runId)
  const params = promptSourceParams({
    prompt: stampedPrompt,
    references,
    engine: values.engine,
    durationSeconds,
    fps,
    aspectRatio,
    maxRepairPasses,
  })

  receipt.inputs = {
    ...receipt.inputs,
    promptSource: brief.source,
    promptSha: shortHash(stampedPrompt),
    promptChars: stampedPrompt.length,
    promptFirstLine: brief.text.split("\n")[0].slice(0, 120),
    references: references.map((r) => ({ id: r.id, kind: r.kind, role: r.role, urlHost: hostOf(r.url), urlSha: shortHash(r.url) })),
    durationSeconds, fps, aspectRatio, maxRepairPasses,
    engine: values.engine ?? null,
    request: params,
  }
  ctx.save()
  if (ctx.dryRun) return

  const { client } = await makeClient({ baseUrl: args.baseUrl })
  const caps = await readCapabilities(client)
  receipt.inputs.capabilities = caps.raw
  requireProCapability(caps, { aspectRatio, repairPasses: maxRepairPasses })
  receipt.credits.balanceBefore = await readBalance(client)
  ctx.save()

  // ---- the paid authoring run -------------------------------------------
  ctx.log("quoting the authoring run")
  const { quote, jobId } = await quoteAndRun(client, {
    params,
    idempotencyKey: idempotencyKeyFor(ctx.runId, "authoring"),
    onQuote: (q) => { receipt.quote = summarizeQuote(q); ctx.save() },
  })
  ctx.recordJob({ jobId, role: "authoring", quoteId: quote.quoteId, idempotencyKey: idempotencyKeyFor(ctx.runId, "authoring"), submittedAt: new Date().toISOString() })
  ctx.log(`authoring job ${jobId}`)

  const follow = await followJob(client, jobId, {
    pollMs: args.pollMs,
    timeoutMs: args.timeoutMs,
    onTransition: (t) => ctx.log(`  ${t.status}${t.phase ? `/${t.phase}` : ""}${t.progress === null ? "" : ` ${t.progress}%`} @${Math.round(t.elapsedMs / 1000)}s`),
  })
  const job = await readJobRecord(client, jobId)
  const output = follow.output ?? job?.output_data ?? null
  const summary = summarizeProOutput(output)
  receipt.timings.authoring = phaseTimings(job, follow)
  receipt.outputs.authoring = summary
  ctx.recordJob({ jobId, role: "authoring", terminalStatus: follow.terminalStatus, credits: job?.credits ?? null, creditStatus: job?.credit_status ?? null, errorMessage: job?.error_message ?? null, errorHint: job?.error_hint ?? null })
  receipt.measurements.repairs = repairEvidence({ output, quote, requested: maxRepairPasses })
  receipt.measurements.validation = summary?.validation ?? null
  ctx.save()

  const completed = ctx.assert("authoring run completed", { expected: "completed", actual: follow.terminalStatus })
  if (!completed) {
    ctx.note(`authoring failed: ${job?.error_message ?? "no error message"}`)
    return
  }
  ctx.assert("credits committed for the authoring run", { expected: "committed", actual: job?.credit_status ?? null })
  ctx.assert("scene plan is schema version 2", { expected: 2, actual: summary?.plan?.schemaVersion ?? null })
  ctx.assert("scene revision id present", { expected: "a revision id", actual: summary?.sceneRevisionId ?? null, pass: Boolean(summary?.sceneRevisionId) })
  ctx.assert("poster asset id present", { expected: "an asset id", actual: summary?.posterAssetId ?? null, pass: Boolean(summary?.posterAssetId) })
  ctx.assert("validation report asset id present", { expected: "an asset id", actual: summary?.validation?.reportAssetId ?? null, pass: Boolean(summary?.validation?.reportAssetId) })
  ctx.assert("validation status passed", { expected: "passed", actual: summary?.validation?.status ?? null })
  ctx.assert("renderer named", { expected: "a renderer id", actual: summary?.renderer ?? null, pass: typeof summary?.renderer === "string" && summary.renderer.length > 0 })
  ctx.assert("metadata reports the requested fps", { expected: fps, actual: summary?.metadata?.fps ?? null })
  ctx.assert("metadata reports the requested duration", {
    expected: durationSeconds,
    actual: summary?.metadata?.duration ?? null,
    pass: typeof summary?.metadata?.duration === "number" && Math.abs(summary.metadata.duration - durationSeconds) <= 1 / fps,
    detail: "within one frame of the request",
  })
  ctx.assert("video url published", { expected: "a video url", actual: summary?.videoUrl ? hostOf(summary.videoUrl) : null, pass: Boolean(summary?.videoUrl) })

  const revisionId = summary?.sceneRevisionId
  const plan = output?.scenePlan ?? null

  // ---- the deterministic edit, which must cost nothing --------------------
  if (values["skip-edit"] !== true && plan) {
    const balanceBeforeEdit = await readBalance(client)
    try {
      const edit = await applyDeterministicEdit(client, { plan, runId: ctx.runId, pollMs: args.pollMs, timeoutMs: args.timeoutMs })
      const balanceAfterEdit = await readBalance(client)
      receipt.outputs.deterministicEdit = {
        lane: edit.lane,
        description: edit.description,
        jobId: edit.jobId,
        elapsedMs: edit.elapsedMs,
        newRevisionId: edit.plan?.revisionId ?? null,
        parentRevisionId: edit.plan?.parentRevisionId ?? null,
        schemaVersion: edit.plan?.schemaVersion ?? null,
        changeSummary: edit.changeSummary ?? null,
        credits: edit.credits,
        creditStatus: edit.creditStatus,
        balanceBefore: balanceBeforeEdit,
        balanceAfter: balanceAfterEdit,
        balanceDelta: balanceBeforeEdit !== null && balanceAfterEdit !== null ? balanceAfterEdit - balanceBeforeEdit : null,
      }
      ctx.save()
      // What is asserted differs by lane because what is OBSERVABLE differs.
      // The retained lane queues no job, so "no job id came back" is the whole
      // proof that nothing could be reserved; asserting a credits field the
      // harness itself filled in with 0 would be a tautology. The node lane
      // does create a job, so its own credits/credit_status are the evidence.
      if (edit.lane === "retained-revision") {
        ctx.assert("deterministic edit created no job, so nothing could be reserved", {
          expected: null,
          actual: edit.jobId,
          pass: edit.jobId === null,
          detail: "the retained-revision endpoint applies overlays arithmetically and returns the new plan inline",
        })
      } else {
        ctx.assert("deterministic edit charged nothing", {
          expected: 0,
          actual: edit.credits,
          pass: edit.credits === 0 || edit.credits === null,
          detail: "the ops lane prices under the platform's zero-credit deterministic identifier",
        })
      }
      ctx.assert("deterministic edit produced a new revision", {
        expected: `something other than ${revisionId}`,
        actual: edit.plan?.revisionId ?? null,
        pass: Boolean(edit.plan?.revisionId) && edit.plan.revisionId !== revisionId,
      })
      ctx.note("balance around the free edit is recorded, not asserted: other paid work on the same account moves it independently")
    } catch (error) {
      ctx.assert("deterministic edit applied", { expected: "an applied edit", actual: String(error?.message ?? error), pass: false })
    }
  }

  // ---- the render-only re-run, which must not re-author -------------------
  if (values["skip-render-only"] !== true && revisionId) {
    const renderParams = renderOnlyParams({ revisionId, sourceJobId: jobId, engine: values.engine })
    receipt.inputs.renderOnlyRequest = renderParams
    ctx.log("quoting the render-only re-run")
    const renderKey = idempotencyKeyFor(ctx.runId, "render-only")
    const { quote: renderQuote, jobId: renderJobId } = await quoteAndRun(client, {
      params: renderParams,
      idempotencyKey: renderKey,
      onQuote: (q) => { receipt.quotes = { ...(receipt.quotes ?? {}), renderOnly: summarizeQuote(q) }; ctx.save() },
    })
    ctx.recordJob({ jobId: renderJobId, role: "render-only", quoteId: renderQuote.quoteId, idempotencyKey: renderKey })
    const offending = authoringLines(renderQuote.breakdown)
    ctx.assert("render-only quote carries no authoring line", {
      expected: [],
      actual: offending.map((line) => line.code),
      pass: offending.length === 0,
      detail: `full breakdown: ${JSON.stringify(summarizeQuote(renderQuote).breakdown)}`,
    })
    ctx.assert("render-only costs less than authoring", {
      expected: `< ${quote.maxCredits}`,
      actual: renderQuote.maxCredits,
      pass: typeof renderQuote.maxCredits === "number" && renderQuote.maxCredits < quote.maxCredits,
    })

    const renderFollow = await followJob(client, renderJobId, {
      pollMs: args.pollMs,
      timeoutMs: args.timeoutMs,
      onTransition: (t) => ctx.log(`  render-only ${t.status}${t.phase ? `/${t.phase}` : ""} @${Math.round(t.elapsedMs / 1000)}s`),
    })
    const renderJob = await readJobRecord(client, renderJobId)
    const renderSummary = summarizeProOutput(renderFollow.output ?? renderJob?.output_data ?? null)
    receipt.timings.renderOnly = phaseTimings(renderJob, renderFollow)
    receipt.outputs.renderOnly = renderSummary
    ctx.recordJob({ jobId: renderJobId, role: "render-only", terminalStatus: renderFollow.terminalStatus, credits: renderJob?.credits ?? null, creditStatus: renderJob?.credit_status ?? null })
    ctx.save()
    ctx.assert("render-only run completed", { expected: "completed", actual: renderFollow.terminalStatus })
    ctx.assert("render-only exported the same revision", { expected: revisionId, actual: renderSummary?.sceneRevisionId ?? null })
    ctx.assert("render-only published a video", { expected: "a video url", actual: renderSummary?.videoUrl ? hostOf(renderSummary.videoUrl) : null, pass: Boolean(renderSummary?.videoUrl) })
  }

  receipt.credits.balanceAfter = await readBalance(client)
  receipt.credits.committed = receipt.jobs.reduce((total, entry) => total + (typeof entry.credits === "number" && entry.creditStatus === "committed" ? entry.credits : 0), 0)
  ctx.save()
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export { HarnessError }
