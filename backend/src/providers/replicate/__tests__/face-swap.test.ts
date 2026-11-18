/**
 * Face Swap (arabyai-replicate/roop_face_swap) prices its prediction at its own
 * hardware's rate, so the job records what Replicate billed for the run
 * (`jobs.provider_cost`). Recorded only: the run commits its reservation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const runReplicatePrediction = vi.fn()
vi.mock("../client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client.js")>()),
  runReplicatePrediction: (...args: unknown[]) => runReplicatePrediction(...args),
}))

import { replicateFaceSwap, FACE_SWAP_COST_MODEL_KEY } from "../face-swap.js"
import { REPLICATE_MODEL_USD_PER_SEC, extractCost } from "../client.js"

describe("replicateFaceSwap", () => {
  beforeEach(() => {
    runReplicatePrediction.mockReset()
    runReplicatePrediction.mockResolvedValue({ output: "https://r/out.mp4", cost: 0.2, predictionId: "p1" })
  })

  it("prices its prediction with the model's own rate-table key", async () => {
    await replicateFaceSwap("https://in/face.png", "https://in/clip.mp4")
    expect(runReplicatePrediction.mock.calls[0]![0]).toMatchObject({ costModelKey: FACE_SWAP_COST_MODEL_KEY })
  })

  it("returns the prediction's cost, nothing that would make the commit metered", async () => {
    const result = await replicateFaceSwap("https://in/face.png", "https://in/clip.mp4")
    expect(result).toEqual({ videoUrl: "https://r/out.mp4", cost: 0.2 })
  })

  it("the key is in the GPU-time rate table, so the cost is its GPU seconds at that rate (not the fallback)", () => {
    const rate = REPLICATE_MODEL_USD_PER_SEC[FACE_SWAP_COST_MODEL_KEY]
    expect(rate).toBeGreaterThan(0)
    expect(extractCost({ predict_time: 40 }, FACE_SWAP_COST_MODEL_KEY)).toBeCloseTo(40 * rate!, 10)
  })
})
