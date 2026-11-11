/**
 * The house-model seam (lib/house-models.ts) against a FAKE plugin service:
 * what is served, `plan` through the seam, and the runner — refusal before
 * start, the claim that holds one `start` per job, the checkpoint before the
 * first status read, the poll loop, the cost it records, cancellation, a
 * drain, bounded read retries and the poll budget. The claim itself (the
 * row's compare-and-set) is faked here and tested in house-model-claim.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const harness = vi.hoisted(() => ({
  events: [] as string[],
  cancelled: false,
  /** Whether saving the run's reference on the job lands. */
  saves: true,
  /** The fixture model's lane row (undefined: the table has none). */
  lane: { inputUrlArgs: ["imageUrl", "referenceUrls"] } as Record<string, unknown> | undefined,
  /** The provider cost each reference save wrote, in order. */
  savedCosts: [] as Array<number | undefined>,
  /** What claiming the job finds (the row's compare-and-set, faked). */
  claim: { state: "claimed" } as { state: "claimed" } | { state: "started"; taskRef: string } | { state: "taken" } | { state: "error"; message: string },
  claims: 0,
  draining: false,
  /** Overrides what saving the reference finds (else: `saves` true → saved, false → error). */
  saveOutcome: undefined as "saved" | "not-live" | "error" | undefined,
}))

// A catalog with one entry offered under the deployment's own label.
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
  claimHouseModelStart: async () => {
    harness.claims++
    const claim = harness.claim
    // Once claimed, the row holds the claim: a second claim finds it taken (or the reference, once saved).
    harness.claim = { state: "taken" }
    return claim
  },
  saveHouseModelReference: async (jobId: string, taskRef: string, cost: number) => {
    harness.events.push(`checkpoint:${jobId}:house-model:${taskRef}`)
    harness.savedCosts.push(cost)
    const outcome = harness.saveOutcome ?? (harness.saves ? "saved" : "error")
    if (outcome === "saved") harness.claim = { state: "started", taskRef }
    return outcome
  },
}))
vi.mock("@/lib/worker-drain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worker-drain.js")>()),
  isWorkerDraining: () => harness.draining,
}))
vi.mock("@/lib/house-model-lanes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../house-model-lanes.js")>()),
  houseModelLane: (id: string) => (id === "house-fixture" ? harness.lane : undefined),
}))
vi.mock("@/lib/job-cancellation.js", () => ({
  throwIfJobCancelled: async () => {
    if (harness.cancelled) throw Object.assign(new Error("cancelled"), { name: "JobCancelledError" })
  },
}))

import { setPluginServices } from "../private-plugins/services-registry.js"
import type { PluginHouseModelPoll, PluginHouseModelsService } from "../private-plugins/types.js"
import {
  HOUSE_MODEL_MAX_POLL_READ_FAILURES,
  HouseModelInputNotStoredError,
  HouseModelRunPendingError,
  houseModelInputRuleProblems,
  houseModelInputsNotStored,
  houseModelUndeclaredUrlArgs,
  isHouseModelRunFinal,
  isHouseModelRunPending,
  HouseModelStartRefusedError,
  HouseModelJobEndedError,
  houseModelServed,
  planHouseModelRun,
  runHouseModelTask,
} from "../house-models.js"
import { isOwnLabelModel, ownLabelModelIds, resetOwnLabelModelIdsForTests } from "../house-models-served.js"
import { HouseModelRunError } from "../house-model-failure.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"
import { DrainAbortError } from "../worker-drain.js"

const ID = "house-fixture"
const OPTS = { jobId: "job-1", pollIntervalMs: 0, timeoutMs: 60_000 }

/** A fake service for a fresh job: the job starts unclaimed. */
function fakeService(overrides: Partial<PluginHouseModelsService> & { polls?: Array<PluginHouseModelPoll | Error> } = {}): PluginHouseModelsService {
  harness.claim = { state: "claimed" }
  const polls = [...(overrides.polls ?? [{ state: "done", resultUrls: ["https://out.example/1.png"], width: 2048, height: 2048 }])]
  return {
    ids: overrides.ids ?? (() => [ID]),
    plan: overrides.plan ?? (() => ({ providerCostUsd: 0.25 })),
    start: overrides.start ?? (async () => {
      harness.events.push("start")
      return { taskRef: "ref-1" }
    }),
    poll: overrides.poll ?? (async () => {
      harness.events.push("poll")
      const next = polls.length > 1 ? polls.shift()! : polls[0]!
      if (next instanceof Error) throw next
      return next
    }),
  }
}

beforeEach(() => {
  // A process that loaded the plugins (the video worker): no service until a test serves one.
  setPluginServices({})
  harness.events = []
  harness.cancelled = false
  harness.saves = true
  harness.lane = { inputUrlArgs: ["imageUrl", "referenceUrls"] }
  harness.savedCosts = []
  harness.claim = { state: "claimed" }
  harness.claims = 0
  harness.draining = false
  harness.saveOutcome = undefined
  resetOwnLabelModelIdsForTests()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  setPluginServices({})
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("houseModelServed", () => {
  it("is false without a plugin service, and for a model the catalog does not mark own-label", () => {
    expect(isOwnLabelModel(ID)).toBe(true)
    expect(ownLabelModelIds().has(ID)).toBe(true)
    expect(houseModelServed(ID)).toBe(false)
    setPluginServices({ houseModels: fakeService({ ids: () => [ID, "z-image"] }) })
    expect(houseModelServed(ID)).toBe(true)
    // A plugin can only narrow the set: a model the catalog does not mark is never a house model.
    expect(houseModelServed("z-image")).toBe(false)
  })

  it("is false when the plugin does not list the id, or its ids() throws", () => {
    setPluginServices({ houseModels: fakeService({ ids: () => [] }) })
    expect(houseModelServed(ID)).toBe(false)
    setPluginServices({ houseModels: fakeService({ ids: () => { throw new Error("boom") } }) })
    expect(houseModelServed(ID)).toBe(false)
  })
})

describe("planHouseModelRun", () => {
  it("is the plugin's figure when served; null when not served, invalid, or the plugin throws", () => {
    expect(planHouseModelRun(ID, {})).toBeNull()
    setPluginServices({ houseModels: fakeService() })
    expect(planHouseModelRun(ID, { a: 1 })).toEqual({ providerCostUsd: 0.25 })
    setPluginServices({ houseModels: fakeService({ plan: () => null }) })
    expect(planHouseModelRun(ID, {})).toBeNull()
    setPluginServices({ houseModels: fakeService({ plan: () => ({ providerCostUsd: Number.NaN }) }) })
    expect(planHouseModelRun(ID, {})).toBeNull()
    setPluginServices({ houseModels: fakeService({ plan: () => { throw new Error("bad") } }) })
    expect(planHouseModelRun(ID, {})).toBeNull()
  })
})

describe("runHouseModelTask: input files only from this install's storage", () => {
  const STORE = "https://cdn.house.example"
  const OWN = `${STORE}/images/a.png`
  const OUTSIDE = "https://elsewhere.example/a.png"

  function served(): { start: ReturnType<typeof vi.fn>; plan: ReturnType<typeof vi.fn> } {
    const start = vi.fn(async () => ({ taskRef: "ref-1" }))
    const plan = vi.fn(() => ({ providerCostUsd: 0.25 }))
    setPluginServices({ houseModels: fakeService({ start, plan }) })
    return { start, plan }
  }

  beforeEach(() => {
    vi.stubEnv("R2_PUBLIC_URL", STORE)
  })

  it("refuses an outside URL before start: final, nothing submitted, nothing saved", async () => {
    const { start, plan } = served()
    const err = await runHouseModelTask(ID, { imageUrl: OUTSIDE }, OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HouseModelInputNotStoredError)
    expect((err as HouseModelInputNotStoredError).houseModelRefusal).toBe("input-not-stored")
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("House Fixture could not use this input file, so the run was not started.")
    expect(start).not.toHaveBeenCalled()
    expect(plan).not.toHaveBeenCalled()
    expect(harness.events).toEqual([])
  })

  it("passes a file on this install's storage, and hands it to start as it is", async () => {
    const { start } = served()
    await expect(runHouseModelTask(ID, { imageUrl: OWN, referenceUrls: [OWN] }, OPTS)).resolves.toMatchObject({ resultUrls: ["https://out.example/1.png"] })
    expect(start).toHaveBeenCalledWith(ID, { imageUrl: OWN, referenceUrls: [OWN] }, { jobId: "job-1" })
  })

  it("holds every declared arg, every URL of a list, and only those", async () => {
    const lane = { inputUrlArgs: ["imageUrl", "referenceUrls"] }
    expect(houseModelInputsNotStored(lane, { imageUrl: OWN, referenceUrls: [OWN, OUTSIDE] })).toEqual(["referenceUrls"])
    expect(houseModelInputsNotStored(lane, { imageUrl: 42 })).toEqual(["imageUrl"])
    // The shapes the platform stores files under pass: a finished job's file
    // (`r2Url(mediaObjectKey(…))`, lib/storage.ts) and an upload (routes/upload.ts).
    const uuid = "0b7c2f4e-9a51-4c1e-8d33-5f0e6a7b9c21"
    for (const key of [`images/${uuid}.png`, `videos/${uuid}.mp4`, `uploads/images/${uuid}.png`, `uploads/${uuid}.mp4`]) {
      expect(houseModelInputsNotStored(lane, { imageUrl: `${STORE}/${key}` }), key).toEqual([])
    }
    // An absent arg is skipped; an arg the lane did not declare is not its to hold.
    expect(houseModelInputsNotStored(lane, { imageUrl: null, maskUrl: OUTSIDE })).toEqual([])
    // A content-network transform on our own host can name a remote source; another bucket is not ours.
    expect(houseModelInputsNotStored(lane, { imageUrl: `${STORE}/cdn-cgi/image/width=9/${OUTSIDE}` })).toEqual(["imageUrl"])
    expect(houseModelInputsNotStored(lane, { imageUrl: "https://cdn.house.example.evil/a.png" })).toEqual(["imageUrl"])
    vi.stubEnv("R2_PUBLIC_URL", "")
    expect(houseModelInputsNotStored(lane, { imageUrl: OWN })).toEqual(["imageUrl"])
  })

  it("refuses a model with no lane row, or a row that declares no input URLs — nothing started", async () => {
    const { start } = served()
    harness.lane = undefined
    const noRow = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(isDeterministicJobError(noRow)).toBe(true)
    harness.lane = { input: { media: "image" } }
    const undeclared = await runHouseModelTask(ID, { imageUrl: OWN }, OPTS).catch((e: unknown) => e)
    expect(isDeterministicJobError(undeclared)).toBe(true)
    expect(start).not.toHaveBeenCalled()
  })
})

describe("runHouseModelTask: no URL outside the declared input args", () => {
  const STORE = "https://cdn.house.example"
  const OWN = `${STORE}/images/a.png`
  const lane = { inputUrlArgs: ["imageUrl", "referenceUrls"] }

  beforeEach(() => {
    vi.stubEnv("R2_PUBLIC_URL", STORE)
  })

  it("finds a URL in a nested object, in an array under an undeclared key, and in running text", () => {
    expect(houseModelUndeclaredUrlArgs(lane, { imageUrl: OWN, options: { style: { ref: "https://elsewhere.example/s.png" } } })).toEqual(["options.style.ref"])
    expect(houseModelUndeclaredUrlArgs(lane, { extras: ["plain", OWN, { u: "HTTPS://x.example/y" }] })).toEqual(["extras[1]", "extras[2].u"])
    expect(houseModelUndeclaredUrlArgs(lane, { note: "match the look of http://x.example/a.png please" })).toEqual(["note"])
  })

  it("lets a string that only contains the letters \"http\" through, and every value under a declared arg", () => {
    expect(houseModelUndeclaredUrlArgs(lane, { note: "an http-style look", mode: "https", tag: "httpbin", scheme: "http:" })).toEqual([])
    expect(houseModelUndeclaredUrlArgs(lane, { imageUrl: OWN, referenceUrls: [OWN, OWN], scale: 2 })).toEqual([])
  })

  it("refuses the run before start: final, nothing submitted, and the log names the arg", async () => {
    const start = vi.fn(async () => ({ taskRef: "ref-1" }))
    setPluginServices({ houseModels: fakeService({ start }) })
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const err = await runHouseModelTask(ID, { imageUrl: OWN, extras: [{ src: "https://elsewhere.example/s.png" }] }, OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HouseModelInputNotStoredError)
    expect((err as HouseModelInputNotStoredError).houseModelRefusal).toBe("undeclared-url")
    expect((err as Error).message).toBe("House Fixture could not use this input file, so the run was not started.")
    expect(isHouseModelRunFinal(err)).toBe(true)
    expect(start).not.toHaveBeenCalled()
    expect(harness.events).toEqual([])
    expect(logged.mock.calls.map((c) => String(c[0])).join("\n")).toContain("extras[0].src")
  })
})

describe("runHouseModelTask: the input rule, held against the one measurement", () => {
  const STORE = "https://cdn.house.example"
  const OWN = `${STORE}/images/a.png`
  const RULE = { media: "image" as const, acceptedFormats: ["png", "jpeg"], maxBytes: 50_000_000 }

  beforeEach(() => {
    vi.stubEnv("R2_PUBLIC_URL", STORE)
    harness.lane = { inputUrlArgs: ["imageUrl"], input: RULE }
  })

  it("checks the facts the lane passes, to the byte, and measures nothing itself", () => {
    const lane = { inputUrlArgs: ["imageUrl"], input: RULE }
    const args = { imageUrl: OWN }
    expect(houseModelInputRuleProblems(lane, args, { [OWN]: { bytes: 50_000_000, format: "png" } })).toEqual({ unmeasured: [], refused: [] })
    expect(houseModelInputRuleProblems(lane, args, { [OWN]: { bytes: 50_000_001, format: "png" } })).toEqual({ unmeasured: [], refused: [OWN] })
    expect(houseModelInputRuleProblems(lane, args, { [OWN]: { bytes: 10, format: "WEBP" } })).toEqual({ unmeasured: [], refused: [OWN] })
    expect(houseModelInputRuleProblems(lane, args, { [OWN]: { bytes: 10, format: "JPEG" } })).toEqual({ unmeasured: [], refused: [] })
    expect(houseModelInputRuleProblems(lane, args, undefined)).toEqual({ unmeasured: [OWN], refused: [] })
    expect(houseModelInputRuleProblems(lane, args, { [OWN]: { bytes: -1, format: "png" } })).toEqual({ unmeasured: [OWN], refused: [] })
    // A size-only rule needs only the size: the one measurement, no format.
    const sizeOnly = { inputUrlArgs: ["imageUrl"], input: { media: "video" as const, maxBytes: 50_000_000 } }
    expect(houseModelInputRuleProblems(sizeOnly, args, { [OWN]: { bytes: 50_000_000 } })).toEqual({ unmeasured: [], refused: [] })
    expect(houseModelInputRuleProblems(sizeOnly, args, { [OWN]: { bytes: 50_000_001 } })).toEqual({ unmeasured: [], refused: [OWN] })
    // A rule that names formats needs the format too.
    expect(houseModelInputRuleProblems(lane, args, { [OWN]: { bytes: 10 } })).toEqual({ unmeasured: [OWN], refused: [] })
    // No rule, nothing to hold; no input in this run, nothing to measure.
    expect(houseModelInputRuleProblems({ inputUrlArgs: ["imageUrl"] }, args, undefined)).toEqual({ unmeasured: [], refused: [] })
    expect(houseModelInputRuleProblems(lane, {}, undefined)).toEqual({ unmeasured: [], refused: [] })
  })

  it("refuses before start an input file with no measurement, or one the rule does not take", async () => {
    const start = vi.fn(async () => ({ taskRef: "ref-1" }))
    setPluginServices({ houseModels: fakeService({ start }) })
    vi.spyOn(console, "error").mockImplementation(() => {})
    const unmeasured = await runHouseModelTask(ID, { imageUrl: OWN }, OPTS).catch((e: unknown) => e)
    expect((unmeasured as HouseModelInputNotStoredError).houseModelRefusal).toBe("input-unmeasured")
    const tooLarge = await runHouseModelTask(ID, { imageUrl: OWN }, { ...OPTS, inputFacts: { [OWN]: { bytes: 50_000_001, format: "png" } } }).catch((e: unknown) => e)
    expect((tooLarge as HouseModelInputNotStoredError).houseModelRefusal).toBe("input-rule")
    expect(isHouseModelRunFinal(tooLarge)).toBe(true)
    expect(start).not.toHaveBeenCalled()
    // Within the rule, the run starts.
    await expect(runHouseModelTask(ID, { imageUrl: OWN }, { ...OPTS, inputFacts: { [OWN]: { bytes: 50_000_000, format: "png" } } })).resolves.toMatchObject({ plannedCostUsd: 0.25 })
    expect(start).toHaveBeenCalledTimes(1)
  })
})

describe("runHouseModelTask", () => {
  it("refuses before start when the model is not served, or plan finds no valid run (final, nothing started)", async () => {
    const notServed = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(isDeterministicJobError(notServed)).toBe(true)
    expect((notServed as Error).message).toBe("House Fixture is not available on this deployment.")
    setPluginServices({ houseModels: fakeService({ plan: () => null }) })
    const invalid = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(isDeterministicJobError(invalid)).toBe(true)
    expect(harness.events).toEqual([])
  })

  it("saves the reference on the job before the first status read, then polls to the result", async () => {
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "running" }, { state: "running" }, { state: "done", resultUrls: ["https://out.example/1.png", "https://out.example/2.png"], width: 2048, height: 1024 }] }) })
    const onProgress = vi.fn()
    const result = await runHouseModelTask(ID, { a: 1 }, { ...OPTS, onProgress })
    expect(harness.events).toEqual(["start", "checkpoint:job-1:house-model:ref-1", "poll", "poll", "poll"])
    expect(result).toEqual({ resultUrls: ["https://out.example/1.png", "https://out.example/2.png"], width: 2048, height: 1024, reportedCostUsd: null, plannedCostUsd: 0.25 })
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it("saves the start's planned cost with the reference, and hands back what the upstream reported beside it", async () => {
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "done", resultUrls: ["https://out.example/1.png"], providerCostUsd: 0.06 }] }) })
    const result = await runHouseModelTask(ID, {}, OPTS)
    expect(harness.savedCosts).toEqual([0.25])
    expect(result.reportedCostUsd).toBe(0.06)
    expect(result.plannedCostUsd).toBe(0.25)
  })

  it("start is called once per job: a rejected start is FINAL even without the deterministic flag (no retry submits again)", async () => {
    const start = vi.fn(async () => { throw new Error("submit timed out") })
    setPluginServices({ houseModels: fakeService({ start }) })
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(start).toHaveBeenCalledTimes(1)
    // Final: the worker fails and refunds the job on this attempt (workers/video-worker.ts), no queue retry.
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as HouseModelRunError).message).toBe("House Fixture could not complete this run.")
    expect(harness.events).toEqual([])
  })

  it("a rejected start fails with the mapped error: flags kept, the upstream's words never its message", async () => {
    setPluginServices({
      houseModels: fakeService({
        start: async () => { throw Object.assign(new Error("UPSTREAM SAID: bad input https://x.example/a?token=s3cr3t"), { requestRefused: true, deterministic: true }) },
      }),
    })
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HouseModelRunError)
    expect((err as HouseModelRunError).message).toBe("House Fixture refused this request as it was sent.")
    expect((err as HouseModelRunError).requestRefused).toBe(true)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).cause).toBeUndefined()
    expect(harness.events).toEqual([])
  })

  it("a failed poll is the run's end: the mapped error, final, after the checkpoint", async () => {
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "failed", message: "nsfw", contentPolicy: true }] }) })
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect((err as HouseModelRunError).contentPolicyClass).toBe("safety")
    expect(isDeterministicJobError(err)).toBe(true)
    expect(harness.events[1]).toBe("checkpoint:job-1:house-model:ref-1")
  })

  it("a failed poll with no flags (a success with no usable file) is final too", async () => {
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "failed", message: "no file" }] }) })
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HouseModelRunError)
    expect(isDeterministicJobError(err)).toBe(true)
  })

  it("a done poll with no result file is a final failure, not a delivery", async () => {
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "done", resultUrls: [] }] }) })
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HouseModelRunError)
    expect(isDeterministicJobError(err)).toBe(true)
  })

  it("reports the delivered size only as a pair", async () => {
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "done", resultUrls: ["https://out.example/1.png"], width: 2048 }] }) })
    const result = await runHouseModelTask(ID, {}, OPTS)
    expect(result).not.toHaveProperty("width")
    expect(result).not.toHaveProperty("height")
  })

  it("when the reference could not be saved, a later failure is final: a retry could not find the run and would start a second one", async () => {
    harness.saves = false
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "running" }] }) })
    const timedOut = await runHouseModelTask(ID, {}, { ...OPTS, timeoutMs: 0 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(timedOut)).toBe(true)
    setPluginServices({ houseModels: fakeService({ polls: [new Error("down")] }) })
    const unreadable = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(isDeterministicJobError(unreadable)).toBe(true)
    // …while a run whose reference was saved still delivers.
    setPluginServices({ houseModels: fakeService() })
    await expect(runHouseModelTask(ID, {}, OPTS)).resolves.toMatchObject({ resultUrls: ["https://out.example/1.png"] })
  })

  it("tells final rejections from the ones the queue re-picks", async () => {
    // Re-picked: a timeout or failed reads with the reference saved.
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "running" }] }) })
    const timedOut = await runHouseModelTask(ID, {}, { ...OPTS, timeoutMs: 0 }).catch((e: unknown) => e)
    expect(timedOut).toBeInstanceOf(HouseModelRunPendingError)
    expect([isHouseModelRunPending(timedOut), isHouseModelRunFinal(timedOut)]).toEqual([true, false])
    setPluginServices({ houseModels: fakeService({ polls: [new Error("down")] }) })
    const unreadable = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect([isHouseModelRunPending(unreadable), isHouseModelRunFinal(unreadable)]).toEqual([true, false])
    // Final: a refusal before start, a rejected start, a returned failure, and any of the above without a saved reference.
    const finals: unknown[] = []
    setPluginServices({ houseModels: fakeService({ plan: () => null }) })
    finals.push(await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e))
    setPluginServices({ houseModels: fakeService({ start: async () => { throw new Error("no") } }) })
    finals.push(await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e))
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "failed", message: "no" }] }) })
    finals.push(await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e))
    harness.saves = false
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "running" }] }) })
    finals.push(await runHouseModelTask(ID, {}, { ...OPTS, timeoutMs: 0 }).catch((e: unknown) => e))
    for (const err of finals) expect([isHouseModelRunPending(err), isHouseModelRunFinal(err)]).toEqual([false, true])
    // A cancel is neither: it ends the job through the cancel path.
    harness.saves = true
    harness.cancelled = true
    const cancelled = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect([isHouseModelRunPending(cancelled), isHouseModelRunFinal(cancelled)]).toEqual([false, false])
  })

  it("retries a status read that throws, and gives up after the bound with a plain (retryable) error", async () => {
    setPluginServices({ houseModels: fakeService({ polls: [new Error("socket hang up"), { state: "done", resultUrls: ["https://out.example/1.png"] }] }) })
    await expect(runHouseModelTask(ID, {}, OPTS)).resolves.toMatchObject({ resultUrls: ["https://out.example/1.png"] })

    harness.events = []
    setPluginServices({ houseModels: fakeService({ polls: [new Error("down")] }) })
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(harness.events.filter((e) => e === "poll")).toHaveLength(HOUSE_MODEL_MAX_POLL_READ_FAILURES)
    expect(isDeterministicJobError(err)).toBe(false)
    expect((err as Error).message).toBe("House Fixture stopped answering; the run will be checked again.")
  })

  it("gives the run up past its poll budget with a plain (retryable) error", async () => {
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "running" }] }) })
    const err = await runHouseModelTask(ID, {}, { ...OPTS, timeoutMs: 0 }).catch((e: unknown) => e)
    expect((err as Error).message).toBe("House Fixture did not finish within 0 minutes; the run will be checked again.")
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("a job cancelled before start is never claimed or started", async () => {
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "running" }] }) })
    harness.cancelled = true
    await expect(runHouseModelTask(ID, {}, OPTS)).rejects.toThrow("cancelled")
    expect(harness.claims).toBe(0)
    expect(harness.events).toEqual([])
  })

  it("stops on a cancel at the next tick", async () => {
    setPluginServices({
      houseModels: fakeService({
        polls: [{ state: "running" }],
        start: async () => {
          harness.events.push("start")
          harness.cancelled = true
          return { taskRef: "ref-1" }
        },
      }),
    })
    await expect(runHouseModelTask(ID, {}, OPTS)).rejects.toThrow("cancelled")
    expect(harness.events).toEqual(["start", "checkpoint:job-1:house-model:ref-1"])
  })

  it("a start that resolves without a reference is a failure, and nothing is saved", async () => {
    setPluginServices({ houseModels: fakeService({ start: async () => ({ taskRef: "" }) }) })
    await expect(runHouseModelTask(ID, {}, OPTS)).rejects.toBeInstanceOf(HouseModelRunError)
    expect(harness.events).toEqual([])
  })
})

describe("runHouseModelTask: one start per job", () => {
  it("claims the job before start, once", async () => {
    setPluginServices({ houseModels: fakeService() })
    await runHouseModelTask(ID, {}, OPTS)
    expect(harness.claims).toBe(1)
    expect(harness.events[0]).toBe("start")
  })

  it("the worker's inline safety retry runs the lane again in-process: the second run reads the first run, never starts again", async () => {
    const start = vi.fn(async () => ({ taskRef: "ref-1" }))
    const poll = vi.fn(async () => ({ state: "failed" as const, message: "nsfw", contentPolicy: true }))
    setPluginServices({ houseModels: fakeService({ start, poll }) })
    const first = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    const second = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(start).toHaveBeenCalledTimes(1)
    expect(poll).toHaveBeenCalledTimes(2)
    expect(poll).toHaveBeenLastCalledWith(ID, "ref-1")
    // The same failure, the same classification: final.
    expect((second as HouseModelRunError).contentPolicyClass).toBe("safety")
    expect((second as Error).message).toBe((first as Error).message)
    expect(isHouseModelRunFinal(second)).toBe(true)
  })

  it("a process death between start and the save: the lane run again finds the claim with no reference and refuses, final", async () => {
    const start = vi.fn(async () => ({ taskRef: "ref-2" }))
    setPluginServices({ houseModels: fakeService({ start }) })
    // What the dead worker left: the row claimed, no reference.
    harness.claim = { state: "taken" }
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HouseModelStartRefusedError)
    expect(isHouseModelRunFinal(err)).toBe(true)
    expect((err as Error).message).toBe("House Fixture could not complete this run.")
    expect(start).not.toHaveBeenCalled()
  })

  it("a failed save followed by another run of the lane: refused, never a second start", async () => {
    harness.saves = false
    const start = vi.fn(async () => ({ taskRef: "ref-3" }))
    setPluginServices({ houseModels: fakeService({ start, polls: [{ state: "running" }] }) })
    const first = await runHouseModelTask(ID, {}, { ...OPTS, timeoutMs: 0 }).catch((e: unknown) => e)
    expect(isHouseModelRunFinal(first)).toBe(true)
    const again = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(again).toBeInstanceOf(HouseModelStartRefusedError)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it("a claim the database could not answer starts nothing and is not final (a retry asks again)", async () => {
    const start = vi.fn(async () => ({ taskRef: "ref-4" }))
    setPluginServices({ houseModels: fakeService({ start }) })
    harness.claim = { state: "error", message: "connection reset" }
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(start).not.toHaveBeenCalled()
    expect(isHouseModelRunFinal(err)).toBe(false)
    expect(isHouseModelRunPending(err)).toBe(false)
  })

  it("a job ended while its start ran (this worker's lock lapsed, a re-pick refunded it): no poll, final, the row left as it is", async () => {
    harness.saveOutcome = "not-live"
    const poll = vi.fn(async () => ({ state: "running" as const }))
    setPluginServices({ houseModels: fakeService({ poll }) })
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HouseModelJobEndedError)
    expect(isHouseModelRunFinal(err)).toBe(true)
    expect(poll).not.toHaveBeenCalled()
    expect(harness.events).toEqual(["start", "checkpoint:job-1:house-model:ref-1"])
  })

  it("a start that hands back the claim's own value is no reference: final", async () => {
    setPluginServices({ houseModels: fakeService({ start: async () => ({ taskRef: "house-model:claimed" }) }) })
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HouseModelRunError)
    expect(isHouseModelRunFinal(err)).toBe(true)
    expect(harness.events).toEqual([])
  })
})

describe("runHouseModelTask: a drain", () => {
  it("hands the job back once the reference is saved (the re-pick reads the run)", async () => {
    const poll = vi.fn(async () => ({ state: "running" as const }))
    setPluginServices({ houseModels: fakeService({ poll }) })
    harness.draining = true
    const err = await runHouseModelTask(ID, {}, OPTS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DrainAbortError)
    expect(harness.events).toEqual(["start", "checkpoint:job-1:house-model:ref-1"])
    expect(poll).not.toHaveBeenCalled()
  })

  it("keeps polling a run whose reference could not be saved: handing it back could not resume it", async () => {
    harness.saves = false
    harness.draining = true
    setPluginServices({ houseModels: fakeService({ polls: [{ state: "running" }, { state: "done", resultUrls: ["https://out.example/1.png"] }] }) })
    await expect(runHouseModelTask(ID, {}, OPTS)).resolves.toMatchObject({ resultUrls: ["https://out.example/1.png"] })
  })
})
