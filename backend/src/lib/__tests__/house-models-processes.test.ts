// @test-watches backend/src/orchestrator.ts backend/src/services/workflow-engine/source-size-build.ts
/**
 * House models in the two kinds of process (docs/design/house-models.md):
 *
 *   (a) a process that loaded the plugins (the API, the video worker): the
 *       plugin's `ids()` answers `houseModelServed`, and `plan` works;
 *   (b) the standalone orchestrator (no plugin): a source registered at boot
 *       asks the container's API; with it answering, `houseModelServed` is true
 *       and a workflow build of a house model is NOT refused — and `plan` is a
 *       programming error there, never "invalid run";
 *   (c) the orchestrator with its API unreachable: the answer is UNKNOWN, not
 *       "not served" — a build on a house model is handed back
 *       (`HouseModelsServedUnknownError`, a `DrainAbortError`), never refused
 *       for good; a drain during the ask rejects with the drain itself; the
 *       API saying "not served" is a refusal (`model_not_available`);
 *   (d) no source registered: not served;
 *   (e) the answer is made current before every build while the catalog has a
 *       house model, whether or not the node names one (its model may arrive
 *       through a FieldMapping, an app input or a retired model's remap).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

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
// The build reads no photo for an upscale; keep the probe off the network all the same.
vi.mock("@/lib/image-source-size.js", () => ({ probeImageDisplaySize: vi.fn(async () => undefined) }))

import { _resetPluginServicesForTests, setPluginServices } from "../private-plugins/services-registry.js"
import type { PluginHouseModelsService } from "../private-plugins/types.js"
import {
  HOUSE_MODELS_SERVED_FAILURE_TTL_MS,
  HOUSE_MODELS_SERVED_TTL_MS,
  HouseModelsNotLoadedError,
  houseModelServed,
  planHouseModelRun,
  refreshHouseModelsServed,
  runHouseModelTask,
  setHouseModelsServedSource,
} from "../house-models.js"
import {
  HOUSE_MODELS_SERVED_STALE_LIMIT_MS,
  HOUSE_MODELS_UNKNOWN_HAND_BACK_MS,
  HouseModelsServedUnknownError,
  HouseModelsTemporarilyUnavailableError,
  houseRuleWithholdsAModel,
  ownLabelModelIds,
  resetOwnLabelModelIdsForTests,
  servesEveryHouseModel,
} from "../house-models-served.js"
import { DrainAbortError } from "../worker-drain.js"
import { isModelDenied } from "../surface-deny.js"
import { buildPayloadWithSourceSize } from "../../services/workflow-engine/source-size-build.js"
import type { SimpleNode } from "../../services/workflow-engine/types.js"

const ID = "house-fixture"
let clock = 1_000_000

function fakeService(plan = vi.fn(() => ({ providerCostUsd: 0.25 }))): PluginHouseModelsService {
  return { ids: () => [ID], plan, start: vi.fn(async () => ({ taskRef: "r" })), poll: vi.fn(async () => ({ state: "running" as const })) }
}

/** A workflow build of an Upscale Image node on the house model, as the engine runs it. */
function buildUpscale() {
  const node: SimpleNode = { id: "n-1", type: "upscale-image", data: { provider: ID, upscaleFactor: "2" } }
  return buildPayloadWithSourceSize(node, "job-1", { imageUrl: "https://in.example/a.png" }, undefined, { nodes: [node], edges: [], nodeStates: {} })
}

/** An Upscale Image node that names no house model. */
function buildUpscaleMapped() {
  const node: SimpleNode = { id: "n-2", type: "upscale-image", data: { upscaleFactor: "2" } }
  return buildPayloadWithSourceSize(node, "job-2", { imageUrl: "https://in.example/a.png" }, undefined, { nodes: [node], edges: [], nodeStates: {} })
}

beforeEach(() => {
  clock = 1_000_000
  _resetPluginServicesForTests()
  resetOwnLabelModelIdsForTests(() => clock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  _resetPluginServicesForTests()
  resetOwnLabelModelIdsForTests()
  vi.restoreAllMocks()
})

describe("(a) a process that loaded the plugins", () => {
  it("reads the plugin's ids directly, and plan works", () => {
    const plan = vi.fn(() => ({ providerCostUsd: 0.25 }))
    setPluginServices({ houseModels: fakeService(plan) })
    expect(houseModelServed(ID)).toBe(true)
    expect(isModelDenied(ID)).toBe(false)
    expect(planHouseModelRun(ID, {})).toEqual({ providerCostUsd: 0.25 })
    expect(plan).toHaveBeenCalledTimes(1)
  })

  it("a load without the service (a community install) serves nothing, and plan answers null", () => {
    setPluginServices({})
    expect(houseModelServed(ID)).toBe(false)
    expect(planHouseModelRun(ID, {})).toBeNull()
  })
})

describe("(b) the standalone orchestrator, its API answering", () => {
  it("serves what the API answers once the answer is current, and a workflow build of the model is not refused", async () => {
    const ask = vi.fn(async () => [ID])
    setHouseModelsServedSource(ask)
    // Cold: no answer yet — unknown, never "not served" (a refresh is kicked).
    expect(() => houseModelServed(ID)).toThrow(HouseModelsServedUnknownError)
    await refreshHouseModelsServed()
    expect(houseModelServed(ID)).toBe(true)
    expect(isModelDenied(ID)).toBe(false)
    await expect(buildUpscale()).resolves.toMatchObject({ jobName: "edit-image", payload: { provider: ID } })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it("the engine makes the answer current itself before it builds (no warm-up needed)", async () => {
    setHouseModelsServedSource(async () => [ID])
    await expect(buildUpscale()).resolves.toMatchObject({ payload: { provider: ID } })
  })

  it("plan and run are programming errors here, never 'invalid run' — nothing is asked of a plugin", async () => {
    setHouseModelsServedSource(async () => [ID])
    await refreshHouseModelsServed()
    expect(() => planHouseModelRun(ID, {})).toThrow(HouseModelsNotLoadedError)
    await expect(runHouseModelTask(ID, {}, { jobId: "j", pollIntervalMs: 0, timeoutMs: 1 })).rejects.toBeInstanceOf(HouseModelsNotLoadedError)
  })

  it("reuses the answer for its TTL, then asks again", async () => {
    const ask = vi.fn(async () => [ID])
    setHouseModelsServedSource(ask)
    await refreshHouseModelsServed()
    clock += HOUSE_MODELS_SERVED_TTL_MS - 1
    await refreshHouseModelsServed()
    expect(ask).toHaveBeenCalledTimes(1)
    clock += 2
    await refreshHouseModelsServed()
    expect(ask).toHaveBeenCalledTimes(2)
  })
})

describe("(c) the orchestrator with its API unreachable", () => {
  it("is unknown, not unserved: a build on the model is handed back, nothing refused for good, and it runs once the API answers", async () => {
    let reachable = false
    setHouseModelsServedSource(async () => {
      if (!reachable) throw new Error("ECONNREFUSED")
      return [ID]
    })
    await refreshHouseModelsServed()
    expect(() => houseModelServed(ID)).toThrow(HouseModelsServedUnknownError)
    const err = await buildUpscale().catch((e: unknown) => e)
    // Handed back to the queue (the orchestrator parks a DrainAbortError), never `model_not_available`.
    expect(err).toBeInstanceOf(HouseModelsServedUnknownError)
    expect(err).toBeInstanceOf(DrainAbortError)
    expect((err as { code?: unknown }).code).toBeUndefined()
    // Any other model is answered as before.
    expect(isModelDenied("z-image")).toBe(false)

    reachable = true
    clock += HOUSE_MODELS_SERVED_FAILURE_TTL_MS
    await refreshHouseModelsServed()
    expect(houseModelServed(ID)).toBe(true)
    await expect(buildUpscale()).resolves.toMatchObject({ payload: { provider: ID } })
  })

  it("asks again no sooner than the failure window", async () => {
    const ask = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    })
    setHouseModelsServedSource(ask)
    await refreshHouseModelsServed()
    await refreshHouseModelsServed()
    expect(ask).toHaveBeenCalledTimes(1)
    clock += HOUSE_MODELS_SERVED_FAILURE_TTL_MS
    await refreshHouseModelsServed()
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it("a drain during the ask rejects the refresh with the drain, and the build is handed back", async () => {
    setHouseModelsServedSource(async () => {
      throw new DrainAbortError()
    })
    await expect(refreshHouseModelsServed()).rejects.toBeInstanceOf(DrainAbortError)
    clock += HOUSE_MODELS_SERVED_FAILURE_TTL_MS
    await expect(buildUpscale()).rejects.toBeInstanceOf(DrainAbortError)
  })

  it("the API saying \"not served\" is a refusal, as it always was", async () => {
    setHouseModelsServedSource(async () => [])
    await refreshHouseModelsServed()
    expect(houseModelServed(ID)).toBe(false)
    await expect(buildUpscale()).rejects.toMatchObject({ code: "model_not_available" })
  })
})

describe("(e) a house model the node does not name", () => {
  it("is not asked about before the build of a node that names none: every other model runs as on an install with no house model", async () => {
    const ask = vi.fn(async () => [ID])
    setHouseModelsServedSource(ask)
    await expect(buildUpscaleMapped()).resolves.toBeDefined()
    expect(ask).not.toHaveBeenCalled()
  })

  it("is made current before the build of a node that names one, in its data or in the provider it was handed", async () => {
    const ask = vi.fn(async () => [ID])
    setHouseModelsServedSource(ask)
    const node: SimpleNode = { id: "n-3", type: "upscale-image", data: { provider: ID, upscaleFactor: "2" } }
    await buildPayloadWithSourceSize(node, "job-3", { imageUrl: "https://in.example/a.png" }, undefined, { nodes: [node], edges: [], nodeStates: {} }).catch(() => undefined)
    expect(ask).toHaveBeenCalledTimes(1)
    // Current, so the synchronous answer the build's availability rule reads is the API's.
    expect(houseModelServed(ID)).toBe(true)
  })

  it("servesEveryHouseModel: known from the loaded plugin, or from a held answer — never asked for", async () => {
    // The plugin process.
    setPluginServices({ houseModels: { ...fakeService(), ids: () => [ID] } })
    expect(servesEveryHouseModel()).toBe(false)
    // Every own-label model: the fixture and the shipped catalog's own.
    setPluginServices({ houseModels: { ...fakeService(), ids: () => [...ownLabelModelIds()] } })
    expect(servesEveryHouseModel()).toBe(true)
    // The orchestrator: no answer yet is not knowing — and reading it starts no ask.
    _resetPluginServicesForTests()
    const ask = vi.fn(async () => [...ownLabelModelIds()])
    setHouseModelsServedSource(ask)
    expect(servesEveryHouseModel()).toBe(false)
    expect(ask).not.toHaveBeenCalled()
    await refreshHouseModelsServed()
    expect(servesEveryHouseModel()).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it("the house rule counts as a model restriction only while a house model is not known to be served", async () => {
    setPluginServices({ houseModels: { ...fakeService(), ids: () => [] } })
    expect(houseRuleWithholdsAModel()).toBe(true)
    // Every house model of the catalog served (the fixture and the shipped ones).
    setPluginServices({ houseModels: { ...fakeService(), ids: () => [...ownLabelModelIds()] } })
    expect(houseRuleWithholdsAModel()).toBe(false)
  })
})

describe("(c2) a held answer, and a bounded hand-back", () => {
  it("an answer is held through a failed ask (stale-while-error): no hand-back while the API restarts", async () => {
    let reachable = true
    const ask = vi.fn(async () => {
      if (!reachable) throw new Error("ECONNREFUSED")
      return [ID]
    })
    setHouseModelsServedSource(ask)
    await refreshHouseModelsServed()
    reachable = false
    clock += HOUSE_MODELS_SERVED_TTL_MS + 1 // expired: the next build asks again, and the ask fails
    await expect(buildUpscale()).resolves.toMatchObject({ payload: { provider: ID } })
    expect(ask).toHaveBeenCalledTimes(2)
    expect(houseModelServed(ID)).toBe(true)
  })

  it("past the stale limit a held answer is no longer used: the run is handed back", async () => {
    let reachable = true
    setHouseModelsServedSource(async () => {
      if (!reachable) throw new Error("ECONNREFUSED")
      return [ID]
    })
    await refreshHouseModelsServed()
    reachable = false
    clock += HOUSE_MODELS_SERVED_STALE_LIMIT_MS + 1
    await expect(buildUpscale()).rejects.toBeInstanceOf(HouseModelsServedUnknownError)
  })

  it("the hand-back is bounded: past the limit the node fails as temporarily unavailable — nothing held, no drain — and runs again once the API answers", async () => {
    let reachable = false
    setHouseModelsServedSource(async () => {
      if (!reachable) throw new Error("ECONNREFUSED")
      return [ID]
    })
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(buildUpscale()).rejects.toBeInstanceOf(HouseModelsServedUnknownError)
    clock += HOUSE_MODELS_UNKNOWN_HAND_BACK_MS - 1
    await expect(buildUpscale()).rejects.toBeInstanceOf(HouseModelsServedUnknownError)
    clock += 1
    const failed = await buildUpscale().catch((e: unknown) => e)
    expect(failed).toBeInstanceOf(HouseModelsTemporarilyUnavailableError)
    expect(failed).not.toBeInstanceOf(DrainAbortError)
    expect(failed).toMatchObject({ code: "model_temporarily_unavailable", message: "House Fixture is temporarily unavailable. Try again in a few minutes." })
    const logged = error.mock.calls.map((c) => String(c[0])).join("\n")
    expect(logged).toContain("fails as temporarily unavailable")
    expect(logged).not.toContain("worker drain")

    // The API answers: the run goes through, and a later outage starts its own clock.
    reachable = true
    clock += HOUSE_MODELS_SERVED_FAILURE_TTL_MS
    await expect(buildUpscale()).resolves.toMatchObject({ payload: { provider: ID } })
    reachable = false
    clock += HOUSE_MODELS_SERVED_STALE_LIMIT_MS + 1
    await expect(buildUpscale()).rejects.toBeInstanceOf(HouseModelsServedUnknownError)
  })
})

describe("(d) no source registered", () => {
  it("is not served, and a refresh does nothing", async () => {
    await refreshHouseModelsServed()
    expect(houseModelServed(ID)).toBe(false)
    expect(isModelDenied(ID)).toBe(true)
  })
})

describe("wiring", () => {
  const backend = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  it("the orchestrator registers the API source at boot, beside the other two, and asks nothing at boot", () => {
    const boot = readFileSync(join(backend, "src/orchestrator.ts"), "utf8")
    expect(boot).toMatch(/setHouseModelsServedSource\(\(\) => askApiHouseModelsServed\(\)\)/)
    expect(boot).toMatch(/setEditPlanPerMinuteSource\(/)
    expect(boot).not.toMatch(/refreshHouseModelsServed\(/)
  })

  it("the engine's payload build makes the answer current before it builds a node that names a house model, and only then", () => {
    const build = readFileSync(join(backend, "src/services/workflow-engine/source-size-build.ts"), "utf8")
    const refresh = build.indexOf("if (namesHouseModel([node.data, resolvedInputs.provider])) await refreshHouseModelsServed()")
    expect(refresh).toBeGreaterThan(-1)
    expect(refresh).toBeLessThan(build.indexOf("buildPayload(node"))
    expect(build.match(/refreshHouseModelsServed\(\)/g)).toHaveLength(1)
  })
})
