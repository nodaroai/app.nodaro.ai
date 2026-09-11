/**
 * Probe 2 — LIFECYCLE.
 *
 * One durable Pro parent, watched all the way through, optionally cancelled
 * part-way, and then watched some MORE.
 *
 * The grace window after the terminal state is the whole reason this probe is
 * separate from `authoring`. "Cancelled" is cheap to report and expensive to
 * mean: a parent that cancels its own bookkeeping but leaves a stage running
 * publishes its video a minute later, over the top of a job the user was told
 * was dead — and a poller that stops at the first terminal tick can never see
 * it. So this one keeps reading, and a late status flip or a changed output
 * hash is a recorded failure, not an unnoticed one.
 *
 * `--observe` attaches to a job someone else started. That is the supported
 * answer to an ambiguous paid submit: never resubmit, attach.
 */
import { parseCancelAt, toInt, toNumber } from "../lib/args.mjs"
import { HarnessError, idempotencyKeyFor, makeClient, readBalance, readCapabilities, requireProCapability, stampPrompt } from "../lib/client.mjs"
import { resolvePrompt } from "../lib/harness.mjs"
import { shortHash } from "../lib/parity.mjs"
import { followJob, phaseTimings, readJobRecord } from "../lib/poll.mjs"
import { promptSourceParams, quoteAndRun, summarizeProOutput, summarizeQuote } from "../lib/pro.mjs"

export const NAME = "lifecycle"

export async function main(ctx) {
  const { values, args, receipt } = ctx
  const observeJobId = values.observe
  const cancelTrigger = parseCancelAt(values["cancel-at"])
  const graceMs = (toNumber(values.grace, "grace", { min: 0, max: 3600 }) ?? 90) * 1000

  receipt.inputs = { ...receipt.inputs, mode: observeJobId ? "observe" : "run", observeJobId: observeJobId ?? null, cancelAt: values["cancel-at"] ?? null, cancelTrigger, graceSeconds: graceMs / 1000 }

  if (observeJobId) {
    ctx.save()
    if (ctx.dryRun) return
    const { client } = await makeClient({ baseUrl: args.baseUrl })
    await observe(ctx, client, observeJobId, graceMs)
    return
  }

  const brief = await resolvePrompt({ prompt: values.prompt, promptFile: values["prompt-file"], what: "brief" })
  const durationSeconds = toNumber(values.duration, "duration", { min: 1, max: 600 })
  const fps = toInt(values.fps, "fps", { min: 1, max: 60 })
  const aspectRatio = values.aspect
  const maxRepairPasses = toInt(values["repair-passes"], "repair-passes", { min: 0, max: 2 })
  const stampedPrompt = stampPrompt(brief.text, ctx.runId)
  const params = promptSourceParams({ prompt: stampedPrompt, durationSeconds, fps, aspectRatio, maxRepairPasses })

  receipt.inputs = {
    ...receipt.inputs,
    promptSource: brief.source,
    promptSha: shortHash(stampedPrompt),
    promptChars: stampedPrompt.length,
    durationSeconds, fps, aspectRatio, maxRepairPasses,
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

  const key = idempotencyKeyFor(ctx.runId, "lifecycle")
  const { quote, jobId } = await quoteAndRun(client, {
    params,
    idempotencyKey: key,
    onQuote: (q) => { receipt.quote = summarizeQuote(q); ctx.save() },
  })
  ctx.recordJob({ jobId, role: "lifecycle", quoteId: quote.quoteId, idempotencyKey: key })
  ctx.log(`job ${jobId}${cancelTrigger ? ` — will cancel at ${JSON.stringify(cancelTrigger)}` : ""}`)

  const follow = await followJob(client, jobId, {
    pollMs: args.pollMs,
    timeoutMs: args.timeoutMs,
    cancelTrigger,
    graceMs,
    onTransition: (t) => ctx.log(`  ${t.status}${t.phase ? `/${t.phase}` : ""}${t.progress === null ? "" : ` ${t.progress}%`} @${Math.round(t.elapsedMs / 1000)}s`),
  })
  const job = await readJobRecord(client, jobId)
  const balanceAfter = await readBalance(client)
  const output = follow.output ?? job?.output_data ?? null

  receipt.timings.lifecycle = phaseTimings(job, follow)
  receipt.measurements.transitions = follow.transitions
  receipt.measurements.phasesSeen = follow.phasesSeen
  receipt.measurements.cancel = follow.cancel
  receipt.measurements.lateChange = follow.lateChange
  receipt.outputs.job = summarizeProOutput(output)
  receipt.credits.balanceAfter = balanceAfter
  receipt.credits.committed = job?.credit_status === "committed" ? job?.credits ?? null : 0
  ctx.recordJob({ jobId, role: "lifecycle", terminalStatus: follow.terminalStatus, credits: job?.credits ?? null, creditStatus: job?.credit_status ?? null, errorMessage: job?.error_message ?? null, errorHint: job?.error_hint ?? null })
  ctx.save()

  ctx.assert("the job reached a terminal state", {
    expected: "completed|failed|cancelled",
    actual: follow.terminalStatus,
    pass: follow.terminalStatus !== null,
    detail: follow.timedOut ? `gave up after ${Math.round(follow.elapsedMs / 1000)}s` : undefined,
  })
  ctx.assert("exactly one terminal state was observed", {
    expected: 1,
    actual: follow.distinctTerminalStates,
    pass: follow.distinctTerminalStates === 1,
  })
  ctx.assert("no late change after the terminal state", {
    expected: null,
    actual: follow.lateChange,
    pass: follow.lateChange === null,
    detail: `watched for a further ${graceMs / 1000}s`,
  })

  if (cancelTrigger) {
    ctx.assert("the cancel trigger fired", {
      expected: values["cancel-at"],
      actual: follow.cancel ? { at: follow.cancel.observedStatus, phase: follow.cancel.observedPhase ?? null, elapsedMs: follow.cancel.elapsedMs } : null,
      pass: Boolean(follow.cancel),
      detail: follow.cancel ? undefined : `phases actually observed: ${follow.phasesSeen.join(", ") || "none published"}`,
    })
    ctx.assert("the cancel request was accepted", { expected: true, actual: follow.cancel?.ok ?? null, pass: follow.cancel?.ok === true })
    ctx.assert("the cancelled job ended cancelled or honestly failed", {
      expected: "cancelled|failed",
      actual: follow.terminalStatus,
      pass: follow.terminalStatus === "cancelled" || follow.terminalStatus === "failed",
      detail: follow.terminalStatus === "failed" ? `error: ${job?.error_message ?? "none"}` : undefined,
    })
    ctx.assert("the credit reservation was released", {
      expected: "refunded",
      actual: job?.credit_status ?? null,
      detail: `balance ${receipt.credits.balanceBefore} → ${balanceAfter}; other work on this account moves it independently, so the credit_status is the verdict`,
    })
    ctx.assert("no output was published for the cancelled run", {
      expected: "no videoUrl",
      actual: receipt.outputs.job?.videoUrl ? "a videoUrl" : "none",
      pass: !receipt.outputs.job?.videoUrl,
    })
  } else {
    ctx.assert("the uninterrupted run completed", { expected: "completed", actual: follow.terminalStatus })
    ctx.assert("credits committed", { expected: "committed", actual: job?.credit_status ?? null })
  }
}

/**
 * Attach to an existing job.
 *
 * Deliberately makes no claim about how the job STARTED — it may have been
 * submitted by a call whose response was lost. What it can honestly check is
 * that from here on the job settles once and delivers once.
 */
async function observe(ctx, client, jobId, graceMs) {
  const { args, receipt } = ctx
  ctx.log(`observing ${jobId}`)
  const follow = await followJob(client, jobId, {
    pollMs: args.pollMs,
    timeoutMs: args.timeoutMs,
    graceMs,
    onTransition: (t) => ctx.log(`  ${t.status}${t.phase ? `/${t.phase}` : ""}${t.progress === null ? "" : ` ${t.progress}%`} @${Math.round(t.elapsedMs / 1000)}s`),
  })
  const job = await readJobRecord(client, jobId)
  receipt.timings.observed = phaseTimings(job, follow)
  receipt.measurements.transitions = follow.transitions
  receipt.measurements.phasesSeen = follow.phasesSeen
  receipt.measurements.lateChange = follow.lateChange
  receipt.outputs.job = summarizeProOutput(follow.output ?? job?.output_data ?? null)
  ctx.recordJob({ jobId, role: "observed", terminalStatus: follow.terminalStatus, credits: job?.credits ?? null, creditStatus: job?.credit_status ?? null, jobType: job?.job_type ?? null, errorMessage: job?.error_message ?? null })
  ctx.save()

  ctx.assert("the observed job reached a terminal state", { expected: "completed|failed|cancelled", actual: follow.terminalStatus, pass: follow.terminalStatus !== null })
  ctx.assert("exactly one terminal state was observed", { expected: 1, actual: follow.distinctTerminalStates, pass: follow.distinctTerminalStates === 1 })
  ctx.assert("the delivery did not change after the terminal state", {
    expected: null,
    actual: follow.lateChange,
    pass: follow.lateChange === null,
    detail: `watched for a further ${graceMs / 1000}s; output sha ${follow.outputHash ?? "none"}`,
  })
  ctx.assert("the settled job carries one consistent credit status", {
    expected: "committed|refunded|null",
    actual: job?.credit_status ?? null,
    pass: [null, undefined, "committed", "refunded"].includes(job?.credit_status),
    detail: "a settled job still reading `reserved` is a stuck reservation",
  })
}

export { HarnessError }
