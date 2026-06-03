import { describe, it, expect, vi, beforeEach } from "vitest"

// Guard for the shared dispatch envelope. The per-provider tests mock
// `../client.js` wholesale (so they exercise a faithful stand-in, not the real
// helper) — this test pins the REAL helper's contract: create → fireOnTaskCreated
// BEFORE wait (crash-recovery invariant) → wait → extractCost.

const { mockCreate, mockWait, mockFire } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockWait: vi.fn(),
  mockFire: vi.fn(async () => {}),
}))

vi.mock("replicate", () => ({
  default: class {
    predictions = { create: mockCreate }
    wait = mockWait
  },
}))
vi.mock("@/lib/config.js", () => ({ config: { REPLICATE_API_TOKEN: "test-token" } }))
vi.mock("@/lib/reconcile/fire-on-task-created.js", () => ({ fireOnTaskCreated: mockFire }))

import { runReplicatePrediction } from "../client.js"

describe("runReplicatePrediction", () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockWait.mockReset()
    mockFire.mockReset()
    mockFire.mockResolvedValue(undefined)
  })

  it("create(version) → fireOnTaskCreated BEFORE wait → returns raw output + cost + id", async () => {
    const order: string[] = []
    mockCreate.mockImplementation(async () => {
      order.push("create")
      return { id: "pred-1" }
    })
    mockFire.mockImplementation(async () => {
      order.push("fire")
    })
    mockWait.mockImplementation(async () => {
      order.push("wait")
      return { output: "https://x/out.mp4", metrics: { predict_time: 4 } }
    })

    const res = await runReplicatePrediction({
      version: "v123",
      input: { a: 1 },
      label: "[replicate:test]",
      reconcileOpts: {} as never,
    })

    expect(mockCreate).toHaveBeenCalledWith({ version: "v123", input: { a: 1 } })
    expect(mockFire).toHaveBeenCalledWith(expect.anything(), "pred-1", "[replicate:test]")
    // The crash-recovery invariant: the reconcile hook fires before we block on wait.
    expect(order).toEqual(["create", "fire", "wait"])
    expect(res.output).toBe("https://x/out.mp4")
    expect(res.predictionId).toBe("pred-1")
    expect(res.cost === null || typeof res.cost === "number").toBe(true)
  })

  it("uses {model} create-options when version is absent, preserves array output", async () => {
    mockCreate.mockResolvedValue({ id: "p2" })
    mockWait.mockResolvedValue({ output: ["https://x/a.png"], metrics: {} })

    const res = await runReplicatePrediction({
      model: "owner/model",
      input: { prompt: "hi" },
      label: "[replicate:img]",
    })

    expect(mockCreate).toHaveBeenCalledWith({ model: "owner/model", input: { prompt: "hi" } })
    expect(res.output).toEqual(["https://x/a.png"])
    expect(res.predictionId).toBe("p2")
  })
})
