import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  enabled: true,
  rows: [] as { id: string }[],
  error: null as { message: string } | null,
  settle: vi.fn(),
  calls: [] as unknown[][],
}))
vi.mock("../../../lib/config.js", () => ({ hasCredits: () => mocks.enabled }))
vi.mock("../credits.js", () => ({ CreditsService: { trySettleManagedCredits: mocks.settle } }))
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: vi.fn((table) => {
  mocks.calls.push(["from", table])
  const chain: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: mocks.rows, error: mocks.error }).then(resolve),
  }
  for (const method of ["select", "eq", "in", "order", "limit", "gt"]) {
    chain[method] = (...args: unknown[]) => { mocks.calls.push([method, ...args]); return chain }
  }
  return chain
}) } }))

beforeEach(() => {
  vi.resetModules()
  mocks.enabled = true; mocks.rows = []; mocks.error = null; mocks.calls = []
  mocks.settle.mockReset().mockResolvedValue(true)
})
describe("terminal managed settlement recovery", () => {
  it("scans only terminal managed reservations and isolates per-job failures", async () => {
    const { recoverManagedJobSettlements } = await import("../managed-job-recovery.js")
    mocks.rows = [{ id: "broken" }, { id: "recoverable" }]
    mocks.settle.mockRejectedValueOnce(new Error("decision missing"))
    expect(await recoverManagedJobSettlements()).toEqual({ scanned: 2, recovered: 1, errors: 1 })
    expect(mocks.calls).toContainEqual(["eq", "status", "reserved"])
    expect(mocks.calls).toContainEqual(["eq", "metadata->>reservation_mode", "job-once"])
    expect(mocks.calls).toContainEqual(["in", "jobs.status", ["completed", "failed", "cancelled"]])
    expect(mocks.settle).toHaveBeenNthCalledWith(2, "recoverable")
  })
  it("rotates past a full batch of invalid holds and eventually revisits them", async () => {
    const { recoverManagedJobSettlements } = await import("../managed-job-recovery.js")
    mocks.rows = Array.from({ length: 100 }, (_, i) => ({ id: `hold-${String(i).padStart(3, "0")}` }))
    mocks.settle.mockResolvedValue(false)
    await recoverManagedJobSettlements()
    mocks.rows = [{ id: "next-hold" }]; mocks.calls = []
    await recoverManagedJobSettlements()
    expect(mocks.calls).toContainEqual(["gt", "id", "hold-099"])
    mocks.calls = []
    await recoverManagedJobSettlements()
    expect(mocks.calls.some(([method]) => method === "gt")).toBe(false)
  })
  it("retries a failed scan without settling or advancing its position", async () => {
    const { recoverManagedJobSettlements } = await import("../managed-job-recovery.js")
    mocks.error = { message: "database offline" }
    await expect(recoverManagedJobSettlements()).rejects.toThrow("database offline")
    expect(mocks.settle).not.toHaveBeenCalled()
    mocks.error = null; mocks.rows = [{ id: "retry" }]
    expect(await recoverManagedJobSettlements()).toEqual({ scanned: 1, recovered: 1, errors: 0 })
  })
  it("does no database work in editions without credits", async () => {
    const { recoverManagedJobSettlements } = await import("../managed-job-recovery.js")
    mocks.enabled = false
    expect(await recoverManagedJobSettlements()).toEqual({ scanned: 0, recovered: 0, errors: 0 })
    expect(mocks.calls).toEqual([])
  })
  it("does not overlap an in-progress sweep in the same process", async () => {
    const { recoverManagedJobSettlements } = await import("../managed-job-recovery.js")
    let finish!: (value: boolean) => void
    mocks.rows = [{ id: "slow" }]
    mocks.settle.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve }))
    const first = recoverManagedJobSettlements()
    await vi.waitFor(() => expect(mocks.settle).toHaveBeenCalledOnce())
    expect(await recoverManagedJobSettlements()).toEqual({ scanned: 0, recovered: 0, errors: 0 })
    finish(true)
    expect(await first).toEqual({ scanned: 1, recovered: 1, errors: 0 })
  })
})
