import { describe, expect, it } from "vitest"
import { jobCreditsShown } from "../job-credits"

describe("jobCreditsShown — the charge once settled, the hold until then", () => {
  it("shows the charge of a job settled below its hold", () => {
    expect(jobCreditsShown({ credits: 888, credits_charged: 444 })).toEqual({ shown: 444, held: 888, charged: 444, released: null, open: false })
  })
  it("shows the hold while the job is still running", () => {
    expect(jobCreditsShown({ credits: 120, credits_charged: null, credit_status: "reserved" })).toEqual({ shown: 120, held: 120, charged: null, released: null, open: true })
  })
  it("shows 0 for a refunded job, not its hold", () => {
    expect(jobCreditsShown({ credits: 55, credits_charged: 0 }).shown).toBe(0)
  })
  it("falls back to the admin-only settled figure", () => {
    expect(jobCreditsShown({ credits: 1080, credits_actual: 126 }).shown).toBe(126)
  })
  it("a run with steps: the run's charge and hold (its steps' included), and what went back", () => {
    // The production Nodaro Motion preview: the job's own hold 44, the run's 3,773.
    expect(jobCreditsShown({ credits: 44, credits_charged: 1063, credits_held: 3773, credits_released: 2710 })).toEqual({
      shown: 1063, held: 3773, charged: 1063, released: 2710, open: false,
    })
  })
  it("a run still held shows the run's hold, and nothing as released", () => {
    expect(jobCreditsShown({ credit_status: "reserved", credits: 44, credits_charged: null, credits_held: 3773, credits_released: null })).toEqual({
      shown: 3773, held: 3773, charged: null, released: null, open: true,
    })
  })
  it("a finished job with no usage log is not an open hold", () => {
    expect(jobCreditsShown({ credits: 0, credits_charged: null, credit_status: null }).open).toBe(false)
  })
  it("knows nothing when neither figure is there", () => {
    expect(jobCreditsShown({}).shown).toBeNull()
  })
})
