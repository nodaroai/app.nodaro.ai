/**
 * A Nodaro Motion run's price records are server-only. The engine writes its
 * quote (`input_data.__castSwapQuote`), what it reused
 * (`output_data.__castSwapReuse`) and which quoted extras ran
 * (`output_data.__castSwapExtras`) for the admin's Motion price check, which
 * reads them through its own database functions with the service role. A job
 * read anywhere else drops them with every other top-level `__` key: pinned
 * here, so a change to that strip cannot quietly hand a person the quote's
 * lines or what the run took from a cache.
 */
import { describe, expect, it } from "vitest"
import { redactPrivateJobData } from "../public-job-data.js"

const JOB = "00000000-0000-4000-8000-0000000000a1"

describe("the Motion price records never leave the server", () => {
  it("a job read keeps the run's own fields and drops its quote, reuse and extras records", () => {
    const row = {
      id: JOB,
      input_data: {
        type: "cast-swap",
        __castSwapQuote: { v: 1, totalCredits: 1200, expectedCredits: 900, breakdown: { base: 40, motion: 1000, references: 160 }, privacyCredits: 50 },
      },
      output_data: {
        videoUrl: "https://x.test/v.mp4",
        __castSwapReuse: { v: 1, entries: [{ step: "reference-sheet", role: 0 }, { step: "clip", ref: "0123456789ab" }] },
        __castSwapExtras: { v: 1, ran: ["privacyCredits"] },
      },
    }
    expect(redactPrivateJobData(row)).toEqual({
      id: JOB,
      input_data: { type: "cast-swap" },
      output_data: { videoUrl: "https://x.test/v.mp4" },
    })
  })

  it("drops them from every row of a list too", () => {
    const rows = [{ input_data: { type: "cast-swap", __castSwapQuote: { v: 1 } }, output_data: { __castSwapReuse: { v: 1 }, __castSwapExtras: { v: 1 } } }]
    expect(redactPrivateJobData({ data: rows })).toEqual({ data: [{ input_data: { type: "cast-swap" }, output_data: {} }] })
  })
})
