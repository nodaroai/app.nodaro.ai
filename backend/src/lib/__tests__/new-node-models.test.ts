/**
 * A node the server creates starts on a model the deployment offers
 * (lib/new-node-models.ts, decided 2026-11-10) — the editor's rule over the
 * same menu rows (`@nodaro/render-rules`), applied to the nodes a server path
 * writes: only where models are restricted, only to a node new to the stored
 * graph, only to a lever whose model the node does not name, and on the first
 * offered row the account can run.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"

const limits = vi.hoisted(() => ({ current: null as { enabled: boolean; maxSeconds: number } | null, asked: 0 }))
vi.mock("../../ee/lib/free-video-limits-for.js", () => ({
  freeVideoLimitsFor: async () => {
    limits.asked += 1
    return limits.current
  },
}))

import { DEFAULT_VIDEO_PROVIDER } from "@nodaro/shared/models"
import { LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { EXTEND_VIDEO_DEFAULT_PROVIDER, EXTEND_VIDEO_MODELS, NODE_MODEL_LEVERS, VIDEO_GEN_MODELS, freeVideoModelLock, nodeModelLevers } from "@nodaro/render-rules"
import { describeServerNodeModelMoves, withOfferedServerNodeModels } from "../new-node-models.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import { __availabilityUniverseReadyForTests, __resetAvailabilityOverridesForTests } from "../availability-override.js"
import { __resetModelSwitchForTests } from "../model-switch.js"
import { isHouseModelUnserved } from "../surface-deny.js"

beforeAll(() => __availabilityUniverseReadyForTests())

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  __resetAvailabilityOverridesForTests()
  limits.current = null
  limits.asked = 0
})

/** A deployment whose profile withholds exactly `models`. */
function withholding(models: readonly string[]): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: [...models] } })
  __resetSurfaceProfileCacheForTests()
}

const videoRows = () => VIDEO_GEN_MODELS.map((m) => m.value)

describe("withOfferedServerNodeModels", () => {
  it("a deployment that restricts nothing gets its nodes back as they came — the very same array, nothing read", async () => {
    const nodes = [{ id: "a", type: "generate-video", data: { prompt: "x" } }]
    const reader = vi.fn(async () => [])
    const out = await withOfferedServerNodeModels(nodes, { userId: "u1", storedIds: reader })
    expect(out.nodes).toBe(nodes)
    expect(out.moved).toEqual([])
    expect(reader).not.toHaveBeenCalled()
    expect(limits.asked).toBe(0)
  })

  it("an install that serves no house model, with an admin's switch-off of the default: nothing moves, nothing read, as on an install with no house model", async () => {
    expect(isHouseModelUnserved("nodaro-image-upscale")).toBe(true)
    __resetModelSwitchForTests([DEFAULT_VIDEO_PROVIDER])
    try {
      const nodes = [{ id: "a", type: "generate-video", data: { prompt: "x" } }]
      const reader = vi.fn(async () => [])
      const out = await withOfferedServerNodeModels(nodes, { userId: "u1", storedIds: reader })
      expect(out.nodes).toBe(nodes)
      expect(out.moved).toEqual([])
      expect(reader).not.toHaveBeenCalled()
    } finally {
      __resetModelSwitchForTests()
    }
  })

  it("a new node that names no model starts on the first row its menu offers when its default is withheld", async () => {
    withholding([DEFAULT_VIDEO_PROVIDER])
    const out = await withOfferedServerNodeModels([{ id: "v", type: "generate-video", data: { prompt: "x" } }], { userId: "u1" })
    const first = videoRows().find((v) => v !== DEFAULT_VIDEO_PROVIDER)!
    expect((out.nodes[0]!.data as Record<string, unknown>).provider).toBe(first)
    expect(out.moved).toEqual([{ nodeId: "v", type: "generate-video", field: "provider", from: DEFAULT_VIDEO_PROVIDER, to: first }])
  })

  it("an LLM node that names no model starts on the first LLM its menu offers", async () => {
    const def = LLM_FEATURE_DEFAULTS["image-to-text"]
    withholding([def])
    const out = await withOfferedServerNodeModels([{ id: "d", type: "image-to-text", data: {} }], { userId: "u1" })
    const rows = NODE_MODEL_LEVERS["image-to-text"]![0]!.rows({})
    expect((out.nodes[0]!.data as Record<string, unknown>).llmModel).toBe(rows.find((id) => id !== def))
  })

  it("a model the writer named is kept, even when it is withheld (the run refuses it)", async () => {
    withholding(["veo3"])
    const nodes = [{ id: "v", type: "generate-video", data: { provider: "veo3" } }]
    const out = await withOfferedServerNodeModels(nodes, { userId: "u1" })
    expect(out.nodes).toBe(nodes)
    expect(out.moved).toEqual([])
  })

  it("a node the stored graph already holds keeps what it holds; the stored ids are read only when something would move", async () => {
    withholding([DEFAULT_VIDEO_PROVIDER])
    const reader = vi.fn(async () => ["old"])
    const nodes = [
      { id: "old", type: "generate-video", data: {} },
      { id: "new", type: "generate-video", data: {} },
    ]
    const out = await withOfferedServerNodeModels(nodes, { userId: "u1", storedIds: reader })
    expect(reader).toHaveBeenCalledTimes(1)
    expect((out.nodes[0]!.data as Record<string, unknown>).provider).toBeUndefined()
    expect((out.nodes[1]!.data as Record<string, unknown>).provider).toBe(videoRows().find((v) => v !== DEFAULT_VIDEO_PROVIDER))
    expect(out.moved.map((m) => m.nodeId)).toEqual(["new"])

    const untouched = vi.fn(async () => [])
    await withOfferedServerNodeModels([{ id: "x", type: "generate-video", data: { provider: "veo3.1" } }], { userId: "u1", storedIds: untouched })
    expect(untouched).not.toHaveBeenCalled()
  })

  it("a stored graph that cannot be read moves nothing", async () => {
    withholding([DEFAULT_VIDEO_PROVIDER])
    const nodes = [{ id: "v", type: "generate-video", data: {} }]
    const out = await withOfferedServerNodeModels(nodes, { userId: "u1", storedIds: async () => Promise.reject(new Error("down")) })
    expect(out.nodes).toBe(nodes)
  })

  it("the first offered row the account can run is taken: a row the free-credit video limits lock is skipped", async () => {
    const FREE = { enabled: true, maxSeconds: 4 }
    limits.current = FREE
    const offered = videoRows().filter((v) => v !== DEFAULT_VIDEO_PROVIDER)
    const firstLocked = offered.find((v) => freeVideoModelLock(v, FREE) !== null)!
    const openBefore = offered.slice(0, offered.indexOf(firstLocked)).filter((v) => freeVideoModelLock(v, FREE) === null)
    withholding([DEFAULT_VIDEO_PROVIDER, ...openBefore])
    const out = await withOfferedServerNodeModels([{ id: "v", type: "generate-video", data: {} }], { userId: "u1" })
    const nowOffered = offered.filter((v) => !openBefore.includes(v))
    expect(nowOffered[0]).toBe(firstLocked)
    expect(out.moved[0]!.to).toBe(nowOffered.find((v) => freeVideoModelLock(v, FREE) === null))
    expect(limits.asked).toBe(1)
  })

  it("when every offered row is locked, the first offered row is taken, as in the editor", async () => {
    const FREE = { enabled: true, maxSeconds: 4 }
    limits.current = FREE
    const open = videoRows().filter((v) => v !== DEFAULT_VIDEO_PROVIDER && freeVideoModelLock(v, FREE) === null)
    withholding([DEFAULT_VIDEO_PROVIDER, ...open])
    const out = await withOfferedServerNodeModels([{ id: "v", type: "generate-video", data: {} }], { userId: "u1" })
    expect(out.moved[0]!.to).toBe(videoRows().filter((v) => v !== DEFAULT_VIDEO_PROVIDER && !open.includes(v))[0])
  })

  it("an Extend Video node is judged as an extension: no row is runnable on free credits, LTX 2.3 Pro included", async () => {
    // A free clip may be 10 s here, so LTX's generation model (shortest clip 6 s) is open on its own.
    const ROOMY = { enabled: true, maxSeconds: 10 }
    limits.current = ROOMY
    const offered = EXTEND_VIDEO_MODELS.map((m) => m.value).filter((v) => v !== EXTEND_VIDEO_DEFAULT_PROVIDER)
    // LTX 2.3 Pro extends under its generation id: judged as that model alone, it would look open.
    expect(offered).toContain("ltx-2.3-pro")
    expect(freeVideoModelLock("ltx-2.3-pro", ROOMY)).toBeNull()
    withholding([EXTEND_VIDEO_DEFAULT_PROVIDER])
    const out = await withOfferedServerNodeModels([{ id: "e", type: "extend-video", data: { prompt: "x" } }], { userId: "u1" })
    // Every offered row is locked, so the first offered row is taken — never LTX as the "runnable" one.
    expect(out.moved).toEqual([{ nodeId: "e", type: "extend-video", field: "provider", from: EXTEND_VIDEO_DEFAULT_PROVIDER, to: offered[0] }])
    expect(limits.asked).toBe(1)
  })

  it("a lever whose menu marks no lock takes its first offered row, whatever the limits (Grok on an image node is no video model)", async () => {
    limits.current = { enabled: true, maxSeconds: 4 }
    const rows = NODE_MODEL_LEVERS["generate-image"]![0]!.rows({})
    const def = NODE_MODEL_LEVERS["generate-image"]![0]!.runs({})!
    const before = rows.slice(0, rows.indexOf("grok")).filter((v) => v !== def)
    withholding([def, ...before])
    const out = await withOfferedServerNodeModels([{ id: "i", type: "generate-image", data: {} }], { userId: "u1" })
    expect(out.moved[0]!.to).toBe("grok")
    // Nor is Generate Video Pro's menu one that marks locks: its first offered row is taken.
    const gvp = NODE_MODEL_LEVERS["generate-video-pro"]![0]!
    withholding([gvp.runs({})!])
    const pro = await withOfferedServerNodeModels([{ id: "p", type: "generate-video-pro", data: {} }], { userId: "u1" })
    expect(pro.moved[0]!.to).toBe(gvp.rows({}).find((v) => v !== gvp.runs({})))
  })

  it("a menu that offers nothing keeps the default", async () => {
    withholding([DEFAULT_VIDEO_PROVIDER, ...videoRows()])
    const nodes = [{ id: "v", type: "generate-video", data: {} }]
    expect((await withOfferedServerNodeModels(nodes, { userId: "u1" })).nodes).toBe(nodes)
  })

  it("a node type with no model menu, and a malformed node, pass through", async () => {
    withholding([DEFAULT_VIDEO_PROVIDER])
    const nodes = [{ id: "s", type: "sticky-note", data: {} }, { id: "m", type: "generate-video" }, { type: 3 }]
    expect((await withOfferedServerNodeModels(nodes, { userId: "u1" })).nodes).toBe(nodes)
  })

  it("says what it moved, for the writer's answer", () => {
    expect(describeServerNodeModelMoves([])).toBeUndefined()
    expect(describeServerNodeModelMoves([{ nodeId: "v", type: "generate-video", field: "provider", from: "a", to: "b" }])).toMatch(/node v \(generate-video\): provider "b".*"a" is not offered/)
  })
})

describe("the shared levers know the default every lever runs when a node names none", () => {
  /** Levers whose model depends on other data, or that run none as the defaults stand. */
  const NO_DEFAULT_WITH_EMPTY_DATA = new Set([
    // The legacy single-mode video nodes: their default differs by lane.
    "image-to-video",
    "text-to-video",
    // Analysis runs a model only while it is on; Choose Best only with its LLM judge.
    "instagram-scrape",
    "meta-ads-scrape",
    "reduce",
  ])

  it("every other lever answers a model for a node that names none", () => {
    for (const [type, levers] of Object.entries(NODE_MODEL_LEVERS)) {
      if (NO_DEFAULT_WITH_EMPTY_DATA.has(type)) continue
      for (const lever of nodeModelLevers(type)) expect(lever.runs({}), `${type}.${lever.field}`).toBeTypeOf("string")
      expect(levers.length, type).toBeGreaterThan(0)
    }
  })

  it("and names no model for empty data", () => {
    for (const levers of Object.values(NODE_MODEL_LEVERS)) for (const lever of levers) expect(lever.named({})).toBe(false)
  })
})
