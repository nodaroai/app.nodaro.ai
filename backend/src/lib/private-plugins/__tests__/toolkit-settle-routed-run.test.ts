// @test-units-by-name it names only the generate-video-pro service, never a node unit
/**
 * `tk.jobs.settleRoutedRun`: a routed run's settlement that is left pending
 * (no verified bill yet) or held for an admin is not a failed run. Thrown out
 * of the plugin's handler after the job completed, it would fail the handler
 * and send a finished job back to the queue. Any other error still throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ settle: vi.fn() }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", async () => ({ ...(await vi.importActual<typeof import("@/lib/config.js")>("@/lib/config.js")), hasCredits: () => true }))
vi.mock("../../../ee/billing/video-route-runs.js", () => ({ settleRoutedRunJob: h.settle, prepareRoutedRunSettlement: vi.fn() }))

import { buildToolkit } from "../toolkit.js"
const { RoutedSettleRetry, RoutedSettleHeld } = await import("../../../ee/billing/video-route-receipt.js")

beforeEach(() => { h.settle.mockReset() })

describe("tk.jobs.settleRoutedRun", () => {
  it.each([["pending", () => new RoutedSettleRetry("no verified bill")], ["held", () => new RoutedSettleHeld("await a decision")]])("a %s settlement resolves: the completed run is not failed or re-run", async (_name, error) => {
    h.settle.mockRejectedValueOnce(error())
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(buildToolkit().jobs.settleRoutedRun!("log", "job-1", "token")).resolves.toBeUndefined()
    expect(h.settle).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it("any other failure still throws", async () => {
    h.settle.mockRejectedValueOnce(new Error("its routed run token does not verify"))
    await expect(buildToolkit().jobs.settleRoutedRun!("log", "job-1", "token")).rejects.toThrow(/does not verify/)
  })
})
