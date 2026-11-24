// @test-reads-none mocks the claim RPC; reads no files
/**
 * Holding the finalize claim through a long delivery (lib/finalize-claim-hold.ts):
 * re-stamped while the work runs; with `stopOnLoss`, a refresh that finds the
 * claim taken by another finalizer stops the holder before it stores or
 * finalizes. Without it (the exclusive-node relay), behaviour is as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ claim: vi.fn(), release: vi.fn() }))
vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../job-finalize.js", () => ({ claimJobFinalize: mocks.claim, releaseJobFinalizeClaim: mocks.release }))

import { CLAIM_REFRESH_MS, holdingFinalizeClaim, isFinalizeClaimLost } from "../finalize-claim-hold.js"

/** A work step that stores only after the claim has been refreshed once. */
async function storeAfterARefresh(hold: { assertHeld(): void }, stored: string[]): Promise<string> {
  await vi.advanceTimersByTimeAsync(CLAIM_REFRESH_MS + 1)
  hold.assertHeld()
  stored.push("stored")
  return "done"
}

describe("holdingFinalizeClaim", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.claim.mockReset()
    mocks.release.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it("keeps the claim fresh while the work runs and returns its result", async () => {
    mocks.claim.mockResolvedValue({ won: true, ts: "t2" })
    const stored: string[] = []
    await expect(holdingFinalizeClaim("j", "worker", "t1", (hold) => storeAfterARefresh(hold, stored), { stopOnLoss: true })).resolves.toBe("done")
    expect(mocks.claim).toHaveBeenCalledWith("j", "worker")
    expect(stored).toEqual(["stored"])
  })

  it("stopOnLoss: a claim taken by another finalizer stops the holder before it stores, and is never released by it", async () => {
    mocks.claim.mockResolvedValue({ won: false, ts: null })
    const stored: string[] = []
    const err = await holdingFinalizeClaim("j", "worker", "t1", (hold) => storeAfterARefresh(hold, stored), { stopOnLoss: true }).catch((e: unknown) => e)
    expect(isFinalizeClaimLost(err)).toBe(true)
    expect(stored).toEqual([])
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it("stopOnLoss: a loss the work does not check still ends in the loss, never a result to finalize", async () => {
    mocks.claim.mockResolvedValue({ won: false, ts: null })
    const err = await holdingFinalizeClaim("j", "cron", "t1", async () => {
      await vi.advanceTimersByTimeAsync(CLAIM_REFRESH_MS + 1)
      return "done"
    }, { stopOnLoss: true }).catch((e: unknown) => e)
    expect(isFinalizeClaimLost(err)).toBe(true)
  })

  it("without stopOnLoss (the relay's copy), a refresh that loses changes nothing: the work finishes and returns", async () => {
    mocks.claim.mockResolvedValue({ won: false, ts: null })
    const stored: string[] = []
    await expect(holdingFinalizeClaim("j", "worker", "t1", (hold) => storeAfterARefresh(hold, stored))).resolves.toBe("done")
    expect(stored).toEqual(["stored"])
  })

  it("a failed step releases the latest stamp, as before", async () => {
    mocks.claim.mockResolvedValue({ won: true, ts: "t2" })
    await expect(holdingFinalizeClaim("j", "worker", "t1", async () => {
      await vi.advanceTimersByTimeAsync(CLAIM_REFRESH_MS + 1)
      throw new Error("upload failed")
    }, { stopOnLoss: true })).rejects.toThrow("upload failed")
    expect(mocks.release).toHaveBeenCalledWith("j", "t2")
  })
})
