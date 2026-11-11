// @test-watches backend/src/workers/video-worker.ts
/**
 * One delivery, two paths (lib/house-model-delivery.ts). A lane's worker
 * (`runHouseModelTask`, then `deliverHouseModelRun`) and the reconcile kind
 * that finishes a job whose worker died (`reconcileHouseModelJob`) hand the
 * shared finalize the SAME inputs for the same run, field by field; a lane
 * with its own `deliver` gets the same delivery from both.
 *
 * Then the failure side: an upstream failure carrying its own words, an
 * `internalDetails`, a `cause` naming a host and a URL in its message leaves
 * none of them in `error_message`, `error_detail` or `error_hint` — on the
 * worker path (the fields the video worker's catch writes) and on the
 * reconcile path (what `markJobFailed` receives). Only the one server log
 * line carries the words, redacted. The same for a delivery that fails: the
 * result files sit on the upstream's host, and a re-host failure that names
 * it reaches neither path's row.
 *
 * The worker path's fields are computed here as the video worker's final
 * catch computes them (workers/video-worker.ts); a source check below fails
 * when that catch stops writing them that way.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const m = vi.hoisted(() => ({
  finalize: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const })),
  markJobFailed: vi.fn(async (_id: string, _fields: Record<string, unknown>) => true),
  refund: vi.fn(async () => {}),
  bump: vi.fn(async (_id: string, _err: unknown) => {}),
  /** The fixture model's lane row. */
  lane: {} as Record<string, unknown>,
  /** The provider cost each reference save wrote. */
  savedCosts: [] as Array<number | undefined>,
}))

vi.mock("@nodaro/shared/model-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared/model-catalog")>()
  return {
    ...actual,
    MODEL_CATALOG: {
      ...actual.MODEL_CATALOG,
      "house-fixture": {
        id: "house-fixture", kind: "image", modes: ["upscale"], family: "House Fixture", ownLabel: true,
        label: "House Fixture", series: "House Fixture", description: "A fixture.", useCases: [], pricing: [{ identifier: "house-fixture", credits: 1 }],
      },
    },
  }
})
vi.mock("@/lib/house-model-claim.js", () => ({
  HOUSE_MODEL_CLAIM_REF: "house-model:claimed",
  isHouseModelReference: (t: unknown) => typeof t === "string" && t.length > 0 && t !== "house-model:claimed",
  // Every run in this file is its own job: unclaimed.
  claimHouseModelStart: async () => ({ state: "claimed" }),
  saveHouseModelReference: async (_jobId: string, _ref: string, cost: number) => {
    m.savedCosts.push(cost)
    return "saved"
  },
}))
vi.mock("@/lib/job-cancellation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../job-cancellation.js")>()),
  throwIfJobCancelled: async () => {},
}))
vi.mock("@/lib/job-finalize.js", () => ({
  finalizeJobWithMedia: m.finalize,
  isFinalizeJobType: (t: unknown) => t === "edit-image",
}))
vi.mock("@/lib/house-model-lanes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../house-model-lanes.js")>()),
  houseModelLane: (id: string) => (id === "house-fixture" ? m.lane : undefined),
}))
vi.mock("@/lib/reconcile/bump-attempts.js", () => ({ bumpAttemptsOrExhaust: m.bump }))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailed: m.markJobFailed }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: m.refund }))

import { setPluginServices } from "../private-plugins/services-registry.js"
import type { PluginHouseModelPoll, PluginHouseModelsService } from "../private-plugins/types.js"
import { HOUSE_MODEL_MAX_POLL_READ_FAILURES, runHouseModelTask } from "../house-models.js"
import { resetOwnLabelModelIdsForTests } from "../house-models-served.js"
import { deliverHouseModelRun } from "../house-model-delivery.js"
import { reconcileHouseModelJob } from "../reconcile/house-model.js"
import { providerDetailOf, redactProviderDetail } from "../provider-error-detail.js"
import { isPostProcessingError } from "../post-processing-error.js"
import { userFacingMessage } from "../user-facing-error.js"
import {
  audioRefusedOf,
  creditsHintOf,
  fallbackLabelOf,
  inputImageRefusedOf,
  inputVideoRefusedOf,
  jobBlockHintOf,
  jobModelIdOf,
  promptRefusedOf,
  queueTimeoutHintOf,
  refusalHintFor,
  requestRefusedHintOf,
  safetyBlockMessage,
  safetyBlockOf,
  sentVideoInput,
} from "../safety-block.js"

const ID = "house-fixture"
const JOB_ID = "job-7"
const INPUT = { provider: ID, imageUrl: "https://in.example/a.png", targetResolution: "4K" }
const ROW = { id: JOB_ID, provider_task_id: "ref-7", reconcile_attempts: 0, job_type: "edit-image", input_data: INPUT }
const RUN_OPTS = { jobId: JOB_ID, pollIntervalMs: 0, timeoutMs: 60_000 }

function serve(
  poll: () => Promise<PluginHouseModelPoll>,
  start?: PluginHouseModelsService["start"],
  plan: PluginHouseModelsService["plan"] = () => ({ providerCostUsd: 0.5 }),
): void {
  setPluginServices({
    houseModels: {
      ids: () => [ID],
      plan,
      start: start ?? (async () => ({ taskRef: "ref-7" })),
      poll,
    },
  })
}

/**
 * The worker's payload, as a route enqueues it: the request as stored in
 * `input_data` plus the queue's own keys. What the recovery reads is
 * `input_data` alone (ROW), so a lane hook that read a queue-only key would
 * answer differently on the two paths.
 */
const PAYLOAD = { ...INPUT, jobId: JOB_ID, usageLogId: "log-7", userId: "user-7" }

/** The worker path: the run, then the one delivery (what a lane's worker does). */
async function workerPath(): Promise<void> {
  const run = await runHouseModelTask(ID, { scale: 2 }, RUN_OPTS)
  await deliverHouseModelRun({ id: ID, jobId: JOB_ID, jobType: "edit-image", job: PAYLOAD, ...run, claimant: "worker" })
}

/** The fields the video worker's catch writes on the final attempt (workers/video-worker.ts). */
function workerFailureFields(err: unknown): Record<string, unknown> {
  const message = err instanceof Error ? err.message : "Unknown error"
  const block = safetyBlockOf(err, jobModelIdOf(INPUT))
  const errorMessage =
    block && block.class === "safety"
      ? safetyBlockMessage(block.fallback ? fallbackLabelOf(block.fallback) : undefined, false)
      : userFacingMessage(err, message)
  const hint =
    refusalHintFor(block, false, inputVideoRefusedOf(err) && sentVideoInput(INPUT), inputImageRefusedOf(err), requestRefusedHintOf(err, INPUT), promptRefusedOf(err), audioRefusedOf(err)) ??
    creditsHintOf(err) ??
    queueTimeoutHintOf(err) ??
    jobBlockHintOf(err)
  return { error_message: errorMessage, error_detail: providerDetailOf(err), ...(hint ? { error_hint: hint } : {}) }
}

/** No forbidden word in the fields a person or the job's owner can read. */
function expectNone(fields: Record<string, unknown>, forbidden: readonly string[], where: string): void {
  const text = JSON.stringify(fields).toLowerCase()
  for (const word of forbidden) expect(text, `${where}: ${word}`).not.toContain(word.toLowerCase())
}

let warn: MockInstance<typeof console.warn>

beforeEach(() => {
  vi.clearAllMocks()
  m.lane = { inputUrlArgs: ["imageUrl"] }
  m.savedCosts = []
  setPluginServices({})
  resetOwnLabelModelIdsForTests()
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  setPluginServices({})
  vi.restoreAllMocks()
})

describe("one delivery on both paths", () => {
  const DONE = {
    state: "done" as const,
    resultUrls: ["https://out.example/1.png", "https://out.example/2.png"],
    width: 4096,
    height: 2304,
    providerCostUsd: 0.0123,
  }

  it("the default delivery: the worker (its payload) and the reconcile (the stored input_data) hand finalize the same inputs, field by field", async () => {
    // Priced from the request, as a lane does: the same figure from the payload and from input_data.
    const settledBase = vi.fn(async (job: Readonly<Record<string, unknown>>) => (job.targetResolution === "4K" ? 7 : 3))
    m.lane = { inputUrlArgs: ["imageUrl"], settledBase }
    serve(async () => DONE)

    await workerPath()
    await reconcileHouseModelJob(ROW, { claimant: "worker" }) // the stall re-pick's inline reconcile
    await reconcileHouseModelJob(ROW) // the cron

    expect(m.finalize).toHaveBeenCalledTimes(3)
    const [worker, repick, cron] = m.finalize.mock.calls.map((call) => call[0])
    expect(worker).toEqual({
      jobId: JOB_ID,
      jobType: "edit-image",
      claimant: "worker",
      meteredBaseCredits: 7,
      result: {
        url: "https://out.example/1.png",
        extraUrls: ["https://out.example/2.png"],
        cost: 0.0123,
        providerUsed: ID,
      },
    })
    // Field by field, the result's own fields included.
    const keys = new Set([...Object.keys(worker!), ...Object.keys(repick!), ...Object.keys(cron!)])
    for (const key of keys) {
      expect(repick![key], key).toEqual(worker![key])
      if (key !== "claimant") expect(cron![key], key).toEqual(worker![key])
    }
    const resultKeys = new Set([...Object.keys(worker!.result as object), ...Object.keys(cron!.result as object)])
    for (const key of resultKeys) {
      expect((cron!.result as Record<string, unknown>)[key], `result.${key}`).toEqual((worker!.result as Record<string, unknown>)[key])
    }
    // Only who finalizes differs, and only for the cron.
    expect(cron!.claimant).toBe("cron")
    // The held run's settle reads the worker's payload on one path and the stored request on the
    // other, with the same delivered file — and settles to the same figure (7, above).
    expect(settledBase.mock.calls).toEqual([
      [PAYLOAD, { url: "https://out.example/1.png", width: 4096, height: 2304 }],
      [INPUT, { url: "https://out.example/1.png", width: 4096, height: 2304 }],
      [INPUT, { url: "https://out.example/1.png", width: 4096, height: 2304 }],
    ])
  })

  it("a lane's own deliver: both paths call it with the same delivery, and the seam finalizes nothing itself", async () => {
    const deliver = vi.fn(async (_delivery: unknown) => ({ ok: true as const }))
    const settledBase = vi.fn(async () => 7)
    m.lane = { inputUrlArgs: ["imageUrl"], deliver, settledBase }
    serve(async () => DONE)

    await workerPath()
    await reconcileHouseModelJob(ROW, { claimant: "worker" })

    expect(deliver).toHaveBeenCalledTimes(2)
    const [fromWorker, fromReconcile] = deliver.mock.calls.map((call) => call[0])
    // The same delivery but for the request it carries: the worker's payload, the stored input_data.
    expect({ ...(fromReconcile as object), job: PAYLOAD }).toEqual(fromWorker)
    expect((fromReconcile as { job: unknown }).job).toEqual(INPUT)
    expect(fromWorker).toEqual({
      id: ID,
      jobId: JOB_ID,
      jobType: "edit-image",
      job: PAYLOAD,
      resultUrls: DONE.resultUrls,
      width: 4096,
      height: 2304,
      providerCostUsd: 0.0123,
      claimant: "worker",
    })
    expect(m.finalize).not.toHaveBeenCalled()
    expect(settledBase).not.toHaveBeenCalled()
  })

  /**
   * What `jobs.provider_cost` ends up holding after a delivery: the completion
   * write's figure, or — when it passes none, which it skips — the planned
   * figure the reference save wrote.
   */
  function recordedCost(finalizeInput: Record<string, unknown>): unknown {
    return (finalizeInput.result as { cost: unknown }).cost ?? m.savedCosts[0]
  }

  it("the same recorded cost in every case: the upstream's figure, a re-plan on what was delivered, or the planned one", async () => {
    // The upstream reports none and the lane prices nothing on delivery: the planned figure, saved with the reference.
    serve(async () => ({ state: "done", resultUrls: ["https://out.example/1.png"] }))
    await workerPath()
    await reconcileHouseModelJob(ROW)
    expect(m.savedCosts).toEqual([0.5])
    let [worker, cron] = m.finalize.mock.calls.map((call) => call[0]!)
    expect([recordedCost(worker!), recordedCost(cron!)]).toEqual([0.5, 0.5])

    // A lane that prices what was delivered: both paths re-plan from the job's request.
    m.finalize.mockClear()
    m.savedCosts = []
    const deliveredPlanArgs = vi.fn((job: Readonly<Record<string, unknown>>, delivered: { width?: number }) => ({ target: job.targetResolution, width: delivered.width }))
    m.lane = { inputUrlArgs: ["imageUrl"], deliveredPlanArgs }
    serve(
      async () => ({ state: "done", resultUrls: ["https://out.example/1.png"], width: 4096, height: 2304 }),
      undefined,
      (_id, args) => ({ providerCostUsd: args.width === 4096 ? 0.9 : 0.5 }),
    )
    await workerPath()
    await reconcileHouseModelJob(ROW)
    ;[worker, cron] = m.finalize.mock.calls.map((call) => call[0]!)
    expect([recordedCost(worker!), recordedCost(cron!)]).toEqual([0.9, 0.9])
    expect(deliveredPlanArgs.mock.calls).toEqual([
      [PAYLOAD, { url: "https://out.example/1.png", width: 4096, height: 2304 }],
      [INPUT, { url: "https://out.example/1.png", width: 4096, height: 2304 }],
    ])

    // The upstream's own figure wins on both paths.
    m.finalize.mockClear()
    serve(async () => ({ state: "done", resultUrls: ["https://out.example/1.png"], width: 4096, height: 2304, providerCostUsd: 0.07 }))
    await workerPath()
    await reconcileHouseModelJob(ROW)
    ;[worker, cron] = m.finalize.mock.calls.map((call) => call[0]!)
    expect([recordedCost(worker!), recordedCost(cron!)]).toEqual([0.07, 0.07])
  })
})

describe("an upstream failure's words stay out of the row", () => {
  const WORDS = "QUOKKA-UPSTREAM-WORDS"
  const URL_HOST = "upstream-host.example"
  const SECRET = "s3cret-token-value"
  const INTERNAL = "QUOKKA-INTERNAL-DETAILS"
  const CAUSE_HOST = "cause-host.example"
  const MESSAGE = `${WORDS} at https://${URL_HOST}/v1/task/abc?token=${SECRET}`
  const FORBIDDEN = [WORDS, URL_HOST, SECRET, INTERNAL, CAUSE_HOST, "/v1/task/abc"]

  /** An upstream failure as a plugin might hand it over: more than the contract asks. */
  function leaky(flags: Record<string, unknown>): Record<string, unknown> {
    return {
      message: MESSAGE,
      internalDetails: INTERNAL,
      cause: Object.assign(new Error(`connect ECONNREFUSED ${CAUSE_HOST}:443`), { internalDetails: `${INTERNAL} via ${CAUSE_HOST}` }),
      ...flags,
    }
  }

  function expectClean(fields: Record<string, unknown>, where: string): void {
    const text = JSON.stringify({ m: fields.error_message, d: fields.error_detail, h: fields.error_hint ?? null })
    for (const word of FORBIDDEN) expect(text, `${where}: ${word}`).not.toContain(word)
  }

  /** The upstream's words reached the server log — once, redacted (the URL cut to its host, the secret gone). */
  function expectLoggedOnce(): void {
    const lines = warn.mock.calls.map((call) => call.map(String).join(" "))
    const withWords = lines.filter((line) => line.includes(WORDS))
    expect(withWords).toHaveLength(1)
    expect(withWords[0]).toContain(JOB_ID)
    for (const line of lines) expect(line).not.toContain(SECRET)
  }

  const FLAGS: Array<[string, Record<string, unknown>]> = [
    ["no flag", {}],
    ["refused as sent", { requestRefused: true }],
    ["content policy", { contentPolicy: true }],
    ["input image refused", { inputImageRefused: true }],
  ]

  it.each(FLAGS)("a start rejection (%s), worker path — the only path: no reference was saved", async (_name, flags) => {
    serve(
      async () => ({ state: "running" }),
      async () => {
        throw Object.assign(new Error(MESSAGE), leaky(flags))
      },
    )
    const err = await runHouseModelTask(ID, { scale: 2 }, RUN_OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).cause).toBeUndefined()
    expectClean(workerFailureFields(err), "worker")
    expectLoggedOnce()
  })

  it.each(FLAGS)("a failed poll (%s), worker path", async (_name, flags) => {
    serve(async () => ({ state: "failed", ...leaky(flags) }) as PluginHouseModelPoll)
    const err = await runHouseModelTask(ID, { scale: 2 }, RUN_OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expectClean(workerFailureFields(err), "worker")
    expectLoggedOnce()
  })

  it("a content-policy failure: the worker and the recovery write the same error_message and error_hint", async () => {
    serve(async () => ({ state: "failed", message: "flagged", contentPolicy: true }))
    const err = await runHouseModelTask(ID, { scale: 2 }, RUN_OPTS).catch((e: unknown) => e)
    const worker = workerFailureFields(err)
    await reconcileHouseModelJob(ROW)
    const recovery = m.markJobFailed.mock.calls[0]![1]
    expect(recovery.error_message).toBe(worker.error_message)
    expect(recovery.error_hint).toEqual(worker.error_hint)
    expect(recovery.error_detail).toBe(worker.error_detail)
  })

  it.each(FLAGS)("a failed poll (%s), reconcile path", async (_name, flags) => {
    serve(async () => ({ state: "failed", ...leaky(flags) }) as PluginHouseModelPoll)
    await reconcileHouseModelJob(ROW)
    expect(m.markJobFailed).toHaveBeenCalledTimes(1)
    expectClean(m.markJobFailed.mock.calls[0]![1], "reconcile")
    expectLoggedOnce()
  })

  it("a status read that throws the same words: neither path's error carries them", async () => {
    const readError = (): Error => Object.assign(new Error(MESSAGE), leaky({}))
    serve(async () => {
      throw readError()
    })
    // Worker: the reads run out and the run is given up for now with a neutral sentence.
    const err = await runHouseModelTask(ID, { scale: 2 }, RUN_OPTS).catch((e: unknown) => e)
    expect(warn.mock.calls.filter((call) => String(call[0]).includes(WORDS))).toHaveLength(HOUSE_MODEL_MAX_POLL_READ_FAILURES)
    expectClean(workerFailureFields(err), "worker")
    // Reconcile: the bump (its `reconcile_last_error`, and `error_detail` once exhausted) gets a neutral error.
    await reconcileHouseModelJob(ROW)
    expect(m.bump).toHaveBeenCalledTimes(1)
    const bumped = m.bump.mock.calls[0]![1]
    expectClean({ error_message: (bumped as Error).message, error_detail: providerDetailOf(bumped) }, "reconcile bump")
    for (const call of warn.mock.calls) expect(call.map(String).join(" ")).not.toContain(SECRET)
  })
})

describe("a failed delivery's words stay out of the row", () => {
  const HOST = "upstream-host.example"
  const SECRET = "s3cret-token-value"
  const RESULT = `https://${HOST}/out/1.png?token=${SECRET}`
  const DONE = { state: "done" as const, resultUrls: [RESULT], providerCostUsd: 0.01 }
  // Hosts and addresses the result URLs do NOT name: a redirect's target, a certificate's names, an address.
  const REDIRECT = "edge.redirect-target.example"
  const ALT_NAME = "alt-name.cert.example"
  const IPV6 = "2001:db8::7"
  const FORBIDDEN = [HOST, SECRET, "/out/1.png", REDIRECT, ALT_NAME, IPV6, "2001:db8", "upstream-host%2E"]

  const FAILURES: Array<[string, () => Error]> = [
    ["a URL in the message", () => new Error(`Failed to download: ${RESULT} (503)`)],
    ["a DNS failure naming the host", () => new Error(`safeFetch: DNS lookup failed for ${HOST}`)],
    [
      "a cause carrying its own detail",
      () => new Error("fetch failed", { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${HOST.toUpperCase()}`), { internalDetails: `${HOST}:443 refused` }) }),
    ],
    ["a redirect target not among the results", () => new Error(`safeFetch: blocked — redirect to ${REDIRECT} (private/reserved IP)`)],
    ["a certificate's alt names", () => new Error(`Hostname/IP does not match certificate's altnames: DNS:${ALT_NAME}`)],
    ["an unbracketed IPv6 literal", () => new Error(`connect ECONNREFUSED ${IPV6}:443`)],
    ["a percent-encoded URL", () => new Error(`bad source https%3A%2F%2Fupstream-host%2Eexample%2Fout%2F1.png`)],
  ]

  it.each(FAILURES)("%s, worker path: the same error, rethrown with a fixed sentence", async (_name, make) => {
    serve(async () => DONE)
    const thrown = make()
    m.finalize.mockRejectedValueOnce(thrown)
    const err = await workerPath().catch((e: unknown) => e)
    expect(err).toBe(thrown)
    expectNone(workerFailureFields(err), FORBIDDEN, "worker")
    const logged = warn.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.includes("delivery failed"))
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain(JOB_ID)
    expect(logged[0]).not.toContain(SECRET)
  })

  it.each(FAILURES)("%s, reconcile path: the bump gets the same error, with a fixed sentence", async (_name, make) => {
    serve(async () => DONE)
    const thrown = make()
    m.finalize.mockRejectedValueOnce(thrown)
    await reconcileHouseModelJob(ROW)
    expect(m.bump).toHaveBeenCalledTimes(1)
    const bumped = m.bump.mock.calls[0]![1] as Error
    expect(bumped).toBe(thrown)
    // What bumpAttemptsOrExhaust writes: reconcile_last_error, then at exhaustion error_detail.
    expectNone(
      {
        reconcile_last_error: bumped.message,
        error_detail: providerDetailOf(bumped) ?? redactProviderDetail(`reconcile_exhausted: ${bumped.message}`),
      },
      FORBIDDEN,
      "reconcile",
    )
  })

  it("keeps what classifies the error: its marker and its message prefix", async () => {
    serve(async () => DONE)
    const thrown = Object.assign(new Error(`upload-size-exceeded: ${RESULT}`), { postProcessing: true })
    m.finalize.mockRejectedValueOnce(thrown)
    const err = await workerPath().catch((e: unknown) => e)
    expect(err).toBe(thrown)
    expect(isPostProcessingError(err)).toBe(true)
    // The class prefix the reconcile's classifier reads survives; nothing else of the original does.
    expect((err as Error).message).toBe("upload-size-exceeded: the result of House Fixture is larger than storage takes.")
  })
})

describe("the worker path's fields are the video worker's own", () => {
  it("its final catch still writes error_message, error_detail and error_hint as this test computes them", () => {
    const src = readFileSync(fileURLToPath(new URL("../../workers/video-worker.ts", import.meta.url)), "utf8")
    expect(src).toContain(": userFacingMessage(err, message)")
    expect(src).toContain("error_detail: providerDetailOf(err),")
    expect(src).toContain(
      "refusalHintFor(block, safetyRetried, inputVideoRefused, inputImageRefusedOf(err), requestRefusedHintOf(err, job.data), promptRefusedOf(err), audioRefusedOf(err)) ?? creditsHintOf(err) ?? queueTimeoutHintOf(err) ?? jobBlockHintOf(err)",
    )
    expect(src).toContain("const block = safetyBlockOf(err, modelId)")
    expect(src).toContain("safetyBlockMessage(block.fallback ? fallbackLabelOf(block.fallback) : undefined, safetyRetried)")
  })
})
