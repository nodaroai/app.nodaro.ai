import { describe, expect, it } from "vitest"
import { jobCreditsShown } from "../job-credits"

describe("jobCreditsShown — the charge once settled, the hold until then", () => {
  it("shows the charge of a job settled below its hold", () => {
    expect(jobCreditsShown({ credits: 888, credits_charged: 444 })).toEqual({ shown: 444, held: 888, charged: 444 })
  })
  it("shows the hold while the job is still running", () => {
    expect(jobCreditsShown({ credits: 120, credits_charged: null })).toEqual({ shown: 120, held: 120, charged: null })
  })
  it("shows 0 for a refunded job, not its hold", () => {
    expect(jobCreditsShown({ credits: 55, credits_charged: 0 }).shown).toBe(0)
  })
  it("falls back to the admin-only settled figure", () => {
    expect(jobCreditsShown({ credits: 1080, credits_actual: 126 }).shown).toBe(126)
  })
  it("knows nothing when neither figure is there", () => {
    expect(jobCreditsShown({}).shown).toBeNull()
  })
})
