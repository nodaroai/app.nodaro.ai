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
 * - With no own-label catalog entry, every house-model branch is unreachable:
 *   no model is denied by the rule, no recommendation changes, no job is
 *   attributed to the house name.
 */
import { describe, it, expect, vi } from "vitest"
import { LLM_MODELS } from "@nodaro/shared/llm-models"
import { MODEL_CATALOG, MODEL_RECOMMENDATIONS, safetyRetryPolicy } from "@nodaro/shared/model-catalog"
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
import { isHouseModelUnserved, recommendationsServedHere } from "../surface-deny.js"
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

describe("with no own-label catalog entry, every house-model branch is unreachable", () => {
  it("the shipped catalog marks no model own-label", () => {
    expect([...ownLabelModelIds()]).toEqual([])
  })

  it("no catalog or LLM model is denied by the house rule", () => {
    for (const id of [...Object.keys(MODEL_CATALOG), ...LLM_MODELS.map((m) => m.id)]) {
      expect(isHouseModelUnserved(id), id).toBe(false)
    }
  })

  it("every recommendation is returned as it came", () => {
    const out = recommendationsServedHere(MODEL_RECOMMENDATIONS)
    expect(out).toHaveLength(MODEL_RECOMMENDATIONS.length)
    out.forEach((r, i) => expect(r).toBe(MODEL_RECOMMENDATIONS[i]))
  })

  it("the orchestrator never asks its API: no refresh, and no node build waits on it", async () => {
    _resetPluginServicesForTests()
    resetOwnLabelModelIdsForTests()
    const ask = vi.fn(async () => [] as string[])
    setHouseModelsServedSource(ask)
    try {
      await refreshHouseModelsServed()
      const node = { id: "n-1", type: "upscale-image", data: { provider: "recraft-upscale" } }
      await buildPayloadWithSourceSize(node, "job-1", { imageUrl: "https://in.example/a.png" }, undefined, { nodes: [node], edges: [], nodeStates: {} })
      expect(ask).not.toHaveBeenCalled()
    } finally {
      resetOwnLabelModelIdsForTests()
    }
  })

  it("no job is attributed to the house name", () => {
    for (const id of Object.keys(MODEL_CATALOG)) {
      expect(primaryProviderOfJob("edit-image", { provider: id }), id).not.toBe("house-models")
    }
  })
})
