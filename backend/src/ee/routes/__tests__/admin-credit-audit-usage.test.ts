import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { usageByBaseModelKey } = await import("../admin-credit-audit.js")

describe("credit audit (actual mode) — sums what runs were CHARGED", () => {
  it("counts a run settled below its hold at its charge, not its hold", () => {
    const usage = usageByBaseModelKey([
      // 1080 held, settled at 126: the audit must compare 126 to the provider's cost.
      { action: "seedance-2-5:720p", credits_used: 1080, credits_charged: 126, status: "committed" },
      { action: "seedance-2-5:480p", credits_used: 300, credits_charged: 300, status: "committed" },
      // A run still running counts its hold (that is what the payer is out right now).
      { action: "seedance-2-5", credits_used: 200, credits_charged: null, status: "reserved" },
    ])
    expect(usage.get("seedance-2-5")).toEqual({ count: 3, totalCredits: 126 + 300 + 200, min: 126, max: 300 })
  })

  it("a legacy commit without credits_charged counts its hold", () => {
    const usage = usageByBaseModelKey([{ action: "flux", credits_used: 20, credits_charged: null, status: "committed" }])
    expect(usage.get("flux")?.totalCredits).toBe(20)
  })
})
