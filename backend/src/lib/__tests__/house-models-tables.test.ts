/**
 * The house-model per-id tables and what the shipped catalog makes of them.
 *
 * - Every row of `HOUSE_MODEL_TIMEOUT_MS`, `HOUSE_MODEL_POLL_INTERVAL_MS` and
 *   `HOUSE_MODEL_LANES` is keyed by an own-label catalog id; every own-label
 *   model has a lane row, and every lane row declares the args that hold its
 *   input files' URLs (`inputUrlArgs`), so a lane cannot be added without them.
 * - The `house-model` reconcile kind's staleness threshold exceeds the longest
 *   poll budget by its margin, and stays inside the reconcile envelope
 *   (18 attempts on the 5-minute cron), so the cron can never take a job over
 *   while its worker still polls, and a job is still exhausted in time.
 * - The shipped catalog's house models, Nodaro Image Upscale and Nodaro Video
 *   Upscale, are the only models the house rule reaches: no other model is
 *   denied by it, only their own recommendations change, only their jobs
 *   count under the house name.
 */
import { describe, it, expect, vi } from "vitest"
import { LLM_MODELS } from "@nodaro/shared/llm-models"
import { IMAGE_MODEL_ROLE_DEFAULTS, MODEL_CATALOG, MODEL_RECOMMENDATIONS, safetyRetryPolicy } from "@nodaro/shared/model-catalog"
import { DEFAULT_TTS_PROVIDER, DEFAULT_VIDEO_PROVIDER } from "@nodaro/shared/models"
import { EDIT_IMAGE_DEFAULT_PROVIDER, NODE_MODEL_LEVERS } from "@nodaro/render-rules"
import {
  HOUSE_MODEL_POLL_INTERVAL_MS,
  HOUSE_MODEL_STALE_MARGIN_MS,
  HOUSE_MODEL_TIMEOUT_MS,
  houseModelStaleThresholdMs,
  longestHouseModelTimeoutMs,
} from "../house-model-timeouts.js"
import { HOUSE_MODEL_LANES, houseModelLane, houseModelLaneProblems } from "../house-model-lanes.js"
import { ownLabelModelIds } from "../house-models-served.js"
import { MAX_ATTEMPTS, STALE_THRESHOLD_MS, HOUSE_MODEL_RECOVER_KINDS, ASYNC_RECOVERABLE_KINDS, isReconcileRecoverable } from "../reconcile/types.js"
import { isHouseModelUnserved, modelRestrictionConfigured, recommendationsServedHere } from "../surface-deny.js"
import { RESOLVED_MODEL_OF_JOB } from "../job-resolved-model.js"
import { _resetPluginServicesForTests } from "../private-plugins/services-registry.js"
import { refreshHouseModelsServed, setHouseModelsServedSource, resetOwnLabelModelIdsForTests } from "../house-models-served.js"
import { buildPayloadWithSourceSize } from "../../services/workflow-engine/source-size-build.js"
import { primaryProviderOfJob } from "../concurrency-lanes/provider-of.js"

const CRON_CADENCE_MS = 5 * 60_000

describe("the per-id tables", () => {
  it("are keyed only by own-label catalog ids", () => {
    const own = ownLabelModelIds()
    for (const table of [HOUSE_MODEL_TIMEOUT_MS, HOUSE_MODEL_POLL_INTERVAL_MS, HOUSE_MODEL_LANES]) {
      for (const id of Object.keys(table)) expect(own.has(id), `${id} is not an own-label catalog id`).toBe(true)
    }
  })

  it("give every own-label model a lane row, and every row declares its input URLs", () => {
    for (const id of ownLabelModelIds()) expect(houseModelLaneProblems(houseModelLane(id)), `${id}'s lane row`).toEqual([])
    for (const [id, row] of Object.entries(HOUSE_MODEL_LANES)) expect(houseModelLaneProblems(row), `${id}'s lane row`).toEqual([])
  })

  it("give no own-label model the worker's inline safety retry: one start per job, and one honest message", () => {
    for (const id of ownLabelModelIds()) expect(safetyRetryPolicy(id).maxAttempts, id).toBe(1)
  })

  it("refuse a lane row that declares no input URLs (the validator, on fixtures)", () => {
    expect(houseModelLaneProblems(undefined)).toEqual(["no lane row"])
    expect(houseModelLaneProblems({})).toHaveLength(1)
    expect(houseModelLaneProblems({ inputUrlArgs: "imageUrl" })).toHaveLength(1)
    expect(houseModelLaneProblems({ inputUrlArgs: [""] })).toEqual(["inputUrlArgs[0] is not an arg name"])
    expect(houseModelLaneProblems({ inputUrlArgs: ["imageUrl", "imageUrl"] })).toEqual(["inputUrlArgs names an arg twice"])
    expect(houseModelLaneProblems({ inputUrlArgs: [], input: { media: "video" } })).toEqual(["has an input rule but names no input URL arg"])
    expect(houseModelLaneProblems({ inputUrlArgs: ["imageUrl"], input: { media: "image" } })).toEqual([])
    expect(houseModelLaneProblems({ inputUrlArgs: ["videoUrl"] })).toEqual([])
    // A model that reads no file says so.
    expect(houseModelLaneProblems({ inputUrlArgs: [] })).toEqual([])
  })

  it("refuse failure sentences of an unknown class or with no words (the validator, on fixtures)", () => {
    const row = { inputUrlArgs: ["imageUrl"] }
    expect(houseModelLaneProblems({ ...row, failureSentences: { contentPolicy: "Blocked.", inputRefused: "Unreadable." } })).toEqual([])
    expect(houseModelLaneProblems({ ...row, failureSentences: {} })).toEqual([])
    expect(houseModelLaneProblems({ ...row, failureSentences: "Blocked." })).toEqual(["failureSentences is not an object"])
    expect(houseModelLaneProblems({ ...row, failureSentences: null })).toEqual(["failureSentences is not an object"])
    expect(houseModelLaneProblems({ ...row, failureSentences: { contentPolicy: " " } })).toEqual(["failureSentences.contentPolicy is not a sentence"])
    expect(houseModelLaneProblems({ ...row, failureSentences: { inputRefused: 7 } })).toEqual(["failureSentences.inputRefused is not a sentence"])
    expect(houseModelLaneProblems({ ...row, failureSentences: { timeout: "Slow." } })).toEqual(["failureSentences.timeout is not a failure class"])
  })

  it("give failure sentences that carry no link, so a person reads plain words only", () => {
    for (const [id, row] of Object.entries(HOUSE_MODEL_LANES)) {
      for (const [cls, sentence] of Object.entries(row.failureSentences ?? {})) {
        expect(sentence, `${id} ${cls}`).not.toMatch(/https?:|www\.|\.(com|ai|io|net)\b/i)
      }
    }
  })

  it("hold positive budgets, each poll interval below its budget", () => {
    for (const [id, ms] of Object.entries(HOUSE_MODEL_TIMEOUT_MS)) expect(ms, id).toBeGreaterThan(0)
    for (const [id, ms] of Object.entries(HOUSE_MODEL_POLL_INTERVAL_MS)) {
      expect(ms, id).toBeGreaterThan(0)
      expect(ms, id).toBeLessThan(HOUSE_MODEL_TIMEOUT_MS[id] ?? Number.POSITIVE_INFINITY)
    }
  })
})

describe("the house-model reconcile kind", () => {
  it("is recoverable: dispatched by the cron and the inline re-pick, and left to the reconcile by the worker", () => {
    expect(HOUSE_MODEL_RECOVER_KINDS.has("house-model")).toBe(true)
    expect(ASYNC_RECOVERABLE_KINDS.has("house-model")).toBe(true)
    expect(isReconcileRecoverable({ provider_kind: "house-model", provider_task_id: "ref" })).toBe(true)
  })

  it("is taken over only after the longest poll budget plus the margin, and still within the reconcile envelope", () => {
    expect(STALE_THRESHOLD_MS["house-model"]).toBe(houseModelStaleThresholdMs())
    expect(STALE_THRESHOLD_MS["house-model"]).toBeGreaterThanOrEqual(longestHouseModelTimeoutMs() + HOUSE_MODEL_STALE_MARGIN_MS)
    // The exhaustion budget (MAX_ATTEMPTS ticks of the 5-min cron) keeps 15 min of headroom above the threshold.
    expect(STALE_THRESHOLD_MS["house-model"]).toBeLessThanOrEqual(MAX_ATTEMPTS * CRON_CADENCE_MS - 15 * 60_000)
  })

  it("a row moves the threshold with it: a 60-minute run makes it 70 minutes, still inside the envelope; past 65 minutes it would not be", () => {
    const envelope = MAX_ATTEMPTS * CRON_CADENCE_MS - 15 * 60_000
    expect(houseModelStaleThresholdMs({ "some-video-model": 60 * 60_000 })).toBe(70 * 60_000)
    expect(houseModelStaleThresholdMs({ "some-video-model": 60 * 60_000 })).toBeLessThanOrEqual(envelope)
    expect(houseModelStaleThresholdMs({ "some-video-model": 66 * 60_000 })).toBeGreaterThan(envelope)
    // The shipped rows obey the same bound.
    for (const [id, ms] of Object.entries(HOUSE_MODEL_TIMEOUT_MS)) expect(ms, id).toBeLessThanOrEqual(65 * 60_000)
  })
})

describe("the shipped catalog's house models, and nothing else, are reached by the house rule", () => {
  const HOUSE = "nodaro-image-upscale"
  const HOUSES: ReadonlySet<string> = new Set([HOUSE, "nodaro-video-upscale"])

  it("the shipped catalog marks exactly Nodaro Image Upscale and Nodaro Video Upscale own-label", () => {
    expect([...ownLabelModelIds()].sort()).toEqual([...HOUSES].sort())
  })

  it("where they are not served, the house rule denies them and no other catalog or LLM model", () => {
    _resetPluginServicesForTests()
    for (const id of [...Object.keys(MODEL_CATALOG), ...LLM_MODELS.map((m) => m.id)]) {
      expect(isHouseModelUnserved(id), id).toBe(HOUSES.has(id))
    }
  })

  it("where they are not served, only their own recommendations change; every other is returned as it came", () => {
    _resetPluginServicesForTests()
    const out = recommendationsServedHere(MODEL_RECOMMENDATIONS)
    const untouched = MODEL_RECOMMENDATIONS.filter((r) => !r.modelIds.some((id) => HOUSES.has(id)))
    expect(untouched.every((r) => out.includes(r))).toBe(true)
    for (const house of HOUSES) expect(out.flatMap((r) => r.modelIds)).not.toContain(house)
  })

  it("the orchestrator never asks its API for a node that names no house model: a plain build neither asks nor waits", async () => {
    _resetPluginServicesForTests()
    resetOwnLabelModelIdsForTests()
    const ask = vi.fn(async () => [] as string[])
    setHouseModelsServedSource(ask)
    try {
      const image = { id: "n-1", type: "generate-image", data: { prompt: "a lighthouse", provider: "gpt-image-2" } }
      const built = await buildPayloadWithSourceSize(image, "job-1", { prompt: "a lighthouse" }, undefined, { nodes: [image], edges: [], nodeStates: {} })
      expect(built.jobName).toBeTruthy()
      const upscale = { id: "n-2", type: "upscale-image", data: { provider: "recraft-upscale", upscaleFactor: "4" } }
      await buildPayloadWithSourceSize(upscale, "job-2", { imageUrl: "https://in.example/a.png" }, undefined, { nodes: [upscale], edges: [], nodeStates: {} })
      const video = { id: "n-3", type: "video-upscale", data: { provider: "topaz", targetResolution: "1080p" } }
      await buildPayloadWithSourceSize(video, "job-3", { videoUrl: "https://in.example/a.mp4" }, undefined, { nodes: [video], edges: [], nodeStates: {} })
      expect(ask).not.toHaveBeenCalled()
    } finally {
      resetOwnLabelModelIdsForTests()
    }
  })

  it.each([
    { id: "n-1", type: "upscale-image", data: { provider: HOUSE }, inputs: { imageUrl: "https://in.example/a.png" } },
    { id: "n-1", type: "video-upscale", data: { provider: "nodaro-video-upscale" }, inputs: { videoUrl: "https://in.example/a.mp4" } },
  ])("a $type node that names a house model asks once before its build, and the next build reuses the answer", async ({ inputs, ...named }) => {
    _resetPluginServicesForTests()
    resetOwnLabelModelIdsForTests()
    const ask = vi.fn(async () => [] as string[])
    setHouseModelsServedSource(ask)
    try {
      const build = (jobId: string) =>
        buildPayloadWithSourceSize(named, jobId, inputs, undefined, { nodes: [named], edges: [], nodeStates: {} })
      // The API answered "not served": the node is refused before anything is held.
      await expect(build("job-1")).rejects.toMatchObject({ code: "model_not_available" })
      expect(ask).toHaveBeenCalledTimes(1)
      await expect(build("job-2")).rejects.toMatchObject({ code: "model_not_available" })
      expect(ask).toHaveBeenCalledTimes(1)
    } finally {
      resetOwnLabelModelIdsForTests()
    }
  })

  it("only their jobs count under the house name", () => {
    for (const id of Object.keys(MODEL_CATALOG)) {
      expect(primaryProviderOfJob("edit-image", { provider: id }) === "house-models", id).toBe(HOUSES.has(id))
      expect(primaryProviderOfJob("video-upscale", { provider: id }) === "house-models", id).toBe(HOUSES.has(id))
    }
  })

  it("where they are not served, each withholds only itself: no model restriction", () => {
    _resetPluginServicesForTests()
    for (const house of HOUSES) expect(isHouseModelUnserved(house), house).toBe(true)
    expect(modelRestrictionConfigured()).toBe(false)
  })
})

/**
 * No default model is a house model, so a request or a node runs one only by
 * naming it — which is what lets an install that does not serve it judge
 * nothing but the house model (`namesHouseModel`, `withheldRunModels`).
 */
describe("no default model is a house model", () => {
  const own = (id: unknown) => typeof id === "string" && ownLabelModelIds().has(id)

  it("the model every job runs on when its request names none", () => {
    for (const [job, resolve] of Object.entries(RESOLVED_MODEL_OF_JOB)) expect(own(resolve({})), job).toBe(false)
  })

  it("the model every job runs on when its request names any OTHER model (an alias, a swap or a remap never lands on a house model)", () => {
    const REF = "https://cdn.example/ref.png"
    const others = [...Object.keys(MODEL_CATALOG), ...LLM_MODELS.map((m) => m.id)].filter((id) => !own(id))
    const reached: string[] = []
    for (const [job, resolve] of Object.entries(RESOLVED_MODEL_OF_JOB)) {
      for (const id of others) {
        for (const data of [{ provider: id }, { provider: id, imageUrl: REF, referenceImageUrls: [REF] }, { model: id }, { llmModel: id }]) {
          let runs: unknown
          try {
            runs = resolve(data)
          } catch {
            continue
          }
          if (own(runs)) reached.push(`${job}: ${String(runs)} for ${JSON.stringify(data)}`)
        }
      }
    }
    expect(reached).toEqual([])
  })

  it("the model every node's model lever runs from its empty data", () => {
    for (const [type, levers] of Object.entries(NODE_MODEL_LEVERS)) {
      for (const lever of levers) expect(own(lever.runs({})), `${type}.${lever.field}`).toBe(false)
    }
  })

  it("the named defaults", () => {
    const defaults = [
      EDIT_IMAGE_DEFAULT_PROVIDER,
      DEFAULT_VIDEO_PROVIDER,
      DEFAULT_TTS_PROVIDER,
      ...Object.values(IMAGE_MODEL_ROLE_DEFAULTS),
    ]
    expect(defaults.length).toBeGreaterThan(3)
    for (const id of defaults) expect(own(id), String(id)).toBe(false)
  })
})
