/**
 * Probe 6 — THE CONCURRENCY BENCHMARK.
 *
 * `--users 1|2|4` simultaneous Pro runs, `--repeats N` times, with each run's
 * phase timings kept separately and p50/p95 taken across all of them.
 *
 * Three things this is careful about.
 *
 * ONE — the per-run numbers come from the JOB's own timestamps (queued at,
 * started at, completed at), not from the poller's clock. A 3-second poll
 * interval would otherwise quantise every measurement to 3 seconds and a
 * "cold start" would be indistinguishable from a slow first poll.
 *
 * TWO — concurrency is REAL concurrency. Each run gets its own idempotency key
 * derived from the run id and its slot, because N byte-identical bodies
 * submitted under one key would collapse into one job and the harness would
 * report a concurrency figure it never produced.
 *
 * THREE — the server-side fields (peak RAM, CPU, cold/warm process state) are
 * present in the summary and EMPTY. They belong to whoever reads the builder
 * service's own metrics for the same window; a client-side harness cannot see
 * them, and inventing them would be the one number in this file nobody could
 * trace.
 */
import { join } from "node:path"
import { toInt, toNumber } from "../lib/args.mjs"
import { HarnessError, idempotencyKeyFor, makeClient, readBalance, readCapabilities, requireProCapability, stampPrompt } from "../lib/client.mjs"
import { resolvePrompt } from "../lib/harness.mjs"
import { shortHash } from "../lib/parity.mjs"
import { followJob, percentile, phaseTimings, readJobRecord } from "../lib/poll.mjs"
import { promptSourceParams, quoteAndRun, summarizeProOutput, summarizeQuote } from "../lib/pro.mjs"

export const NAME = "benchmark"

/**
 * The procedural-vehicle brief.
 *
 * Written here rather than fetched: unlike the table prompt this is not an
 * acceptance fixture with a published verdict, it is a load shape — a short
 * scene with a moving rigid body, a parked reference and one cut, which is
 * what section 6B's generic-object gate exercises. Override it with
 * `--prompt-file` to benchmark anything else.
 */
export const VEHICLE_PROMPT =
  "Blocking: two differently coloured cars on a neutral grey street. One car follows a spline path, "
  + "passing a short row of traffic cones and turning at the end; the other stays parked at the kerb as a "
  + "foreground reference. Simple grey buildings and a flat road, one light. Camera: a wide tracking shot "
  + "that follows the moving car, then one hard cut to a closer shot with the parked car in the foreground. "
  + "No people, no text."

export const FIXTURES = Object.freeze({
  vehicle: { prompt: VEHICLE_PROMPT, durationSeconds: 6, aspectRatio: "16:9" },
  table: { prompt: null, durationSeconds: 30, aspectRatio: "21:9" },
})

export async function main(ctx) {
  const { values, args, receipt } = ctx
  const users = toInt(values.users, "users", { min: 1, max: 4 })
  if (![1, 2, 4].includes(users)) throw new HarnessError(`--users must be 1, 2 or 4, got ${users}`, { code: "bad_users" })
  const repeats = toInt(values.repeats, "repeats", { min: 1, max: 20 })
  const fixtureName = String(values.fixture ?? "vehicle")
  const fixture = FIXTURES[fixtureName]
  if (!fixture) throw new HarnessError(`--fixture must be one of ${Object.keys(FIXTURES).join(", ")}`, { code: "bad_fixture" })

  // The table fixture's brief is the acceptance prompt, fetched into
  // `fixtures/` — the same file `table-fixture` reads, so benchmarking "the
  // table" cannot quietly become benchmarking a paraphrase of it.
  const brief = fixture.prompt && !values["prompt-file"]
    ? { text: fixture.prompt, source: `built-in ${fixtureName} fixture` }
    : await resolvePrompt({
        promptFile: values["prompt-file"],
        fallbackFile: fixtureName === "table" ? join(process.cwd(), "tools/scene3d-acceptance/fixtures/table-prompt.txt") : undefined,
        what: `a ${fixtureName} brief`,
      })

  const durationSeconds = toNumber(values.duration, "duration", { min: 1, max: 600 }) ?? fixture.durationSeconds
  const fps = toInt(values.fps, "fps", { min: 1, max: 60 })
  const aspectRatio = values.aspect ?? fixture.aspectRatio
  const maxRepairPasses = toInt(values["repair-passes"], "repair-passes", { min: 0, max: 2 })

  receipt.inputs = {
    ...receipt.inputs,
    users, repeats, fixture: fixtureName,
    promptSource: brief.source,
    promptSha: shortHash(brief.text),
    promptChars: brief.text.length,
    durationSeconds, fps, aspectRatio, maxRepairPasses,
    totalRuns: users * repeats,
  }
  ctx.save()
  if (ctx.dryRun) return

  const { client } = await makeClient({ baseUrl: args.baseUrl })
  const caps = await readCapabilities(client)
  receipt.inputs.capabilities = caps.raw
  requireProCapability(caps, { aspectRatio, repairPasses: maxRepairPasses })
  receipt.credits.balanceBefore = await readBalance(client)
  ctx.save()

  const runs = []
  const repeatSummaries = []
  for (let repeat = 0; repeat < repeats; repeat++) {
    ctx.log(`repeat ${repeat + 1}/${repeats} — ${users} concurrent run${users === 1 ? "" : "s"}`)
    const repeatStarted = Date.now()
    const slots = Array.from({ length: users }, (_, slot) => ({ repeat, slot }))
    const results = await Promise.all(slots.map((slotInfo) => runOne(ctx, client, {
      ...slotInfo,
      brief,
      durationSeconds,
      fps,
      aspectRatio,
      maxRepairPasses,
    })))
    const repeatWallMs = Date.now() - repeatStarted
    runs.push(...results)
    repeatSummaries.push({
      repeat,
      users,
      wallMs: repeatWallMs,
      completed: results.filter((r) => r.terminalStatus === "completed").length,
      failed: results.filter((r) => r.terminalStatus !== "completed").length,
      creditsCommitted: results.reduce((total, r) => total + (r.creditStatus === "committed" && typeof r.credits === "number" ? r.credits : 0), 0),
    })
    receipt.measurements.repeats = repeatSummaries
    receipt.measurements.runs = runs
    ctx.save()
  }

  const completed = runs.filter((r) => r.terminalStatus === "completed")
  const summary = {
    users,
    repeats,
    fixture: fixtureName,
    totalRuns: runs.length,
    completedRuns: completed.length,
    wallMsPerRepeat: repeatSummaries.map((r) => r.wallMs),
    percentiles: {
      queueMs: percentiles(completed.map((r) => r.timings?.queueMs)),
      workMs: percentiles(completed.map((r) => r.timings?.workMs)),
      totalMs: percentiles(completed.map((r) => r.timings?.totalMs)),
      observedWallMs: percentiles(completed.map((r) => r.timings?.observedWallMs)),
    },
    creditsCommitted: runs.reduce((total, r) => total + (r.creditStatus === "committed" && typeof r.credits === "number" ? r.credits : 0), 0),
    // Deliberately empty. See the file header: these come from the builder
    // service's own metrics for this window, read by whoever has them.
    server: {
      peakRssMb: null,
      cpuPercent: null,
      processState: null,
      builderVersion: null,
      renderBackend: null,
      notes: "",
    },
  }
  receipt.measurements.summary = summary
  receipt.credits.balanceAfter = await readBalance(client)
  receipt.credits.committed = summary.creditsCommitted
  ctx.save()

  ctx.assert("every benchmark run completed", {
    expected: runs.length,
    actual: completed.length,
    pass: completed.length === runs.length,
    detail: runs.filter((r) => r.terminalStatus !== "completed").map((r) => `${r.jobId}: ${r.terminalStatus} ${r.errorMessage ?? ""}`).join("; ") || undefined,
  })
  ctx.assert("every completed run reported its own timestamps", {
    expected: "queue and work durations on every run",
    actual: completed.filter((r) => typeof r.timings?.workMs === "number").length,
    pass: completed.every((r) => typeof r.timings?.workMs === "number"),
    detail: "p50/p95 over runs missing server timestamps would be a poll-interval measurement, not a service one",
  })
  ctx.log(`p50 total ${summary.percentiles.totalMs.p50 ?? "n/a"}ms, p95 total ${summary.percentiles.totalMs.p95 ?? "n/a"}ms across ${completed.length} runs`)
}

/** One slot: quote, submit, follow, and reduce to timings. */
async function runOne(ctx, client, { repeat, slot, brief, durationSeconds, fps, aspectRatio, maxRepairPasses }) {
  const { args, receipt } = ctx
  const label = `bench-r${repeat}-u${slot}`
  // Each slot's prompt carries its own slot marker so two concurrent runs are
  // two distinct requests all the way down, not one deduplicated body.
  const prompt = `${stampPrompt(brief.text, ctx.runId)} [slot ${repeat}.${slot}]`
  const params = promptSourceParams({ prompt, durationSeconds, fps, aspectRatio, maxRepairPasses })
  const key = idempotencyKeyFor(ctx.runId, label)
  const submittedAt = Date.now()
  try {
    const { quote, jobId } = await quoteAndRun(client, { params, idempotencyKey: key })
    ctx.recordJob({ jobId, role: label, quoteId: quote.quoteId, idempotencyKey: key, maxCredits: quote.maxCredits })
    const follow = await followJob(client, jobId, { pollMs: args.pollMs, timeoutMs: args.timeoutMs })
    const job = await readJobRecord(client, jobId)
    const timings = phaseTimings(job, follow)
    receipt.timings[label] = timings
    ctx.recordJob({ jobId, role: label, terminalStatus: follow.terminalStatus, credits: job?.credits ?? null, creditStatus: job?.credit_status ?? null })
    ctx.log(`  ${label} ${follow.terminalStatus} in ${Math.round((Date.now() - submittedAt) / 1000)}s`)
    return {
      label, repeat, slot, jobId,
      quote: summarizeQuote(quote),
      terminalStatus: follow.terminalStatus,
      credits: job?.credits ?? null,
      creditStatus: job?.credit_status ?? null,
      errorMessage: job?.error_message ?? null,
      timings,
      phasesSeen: follow.phasesSeen,
      output: summarizeProOutput(follow.output ?? job?.output_data ?? null),
    }
  } catch (error) {
    ctx.log(`  ${label} ERROR ${error?.message ?? error}`)
    return {
      label, repeat, slot, jobId: null,
      terminalStatus: "submit-failed",
      errorMessage: String(error?.message ?? error),
      idempotencyKey: key,
      timings: null,
    }
  }
}

function percentiles(values) {
  const usable = values.filter((v) => typeof v === "number" && Number.isFinite(v))
  return {
    samples: usable.length,
    min: usable.length === 0 ? null : Math.min(...usable),
    p50: percentile(usable, 50),
    p95: percentile(usable, 95),
    max: usable.length === 0 ? null : Math.max(...usable),
  }
}

export { HarnessError }
