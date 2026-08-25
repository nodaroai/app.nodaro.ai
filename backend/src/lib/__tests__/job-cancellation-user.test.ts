import { describe, it, expect } from "vitest"
import { runWithJobCancellation, getJobUserId } from "../job-cancellation.js"

describe("job-cancellation identity (getJobUserId)", () => {
  it("returns the userId bound by the surrounding context", async () => {
    const seen = await runWithJobCancellation("job-1", "user-abc", async () => getJobUserId())
    expect(seen).toBe("user-abc")
  })

  it("returns undefined outside any context", () => {
    expect(getJobUserId()).toBeUndefined()
  })

  it("returns undefined when the job has no user id (orchestrator/internal path)", async () => {
    const seen = await runWithJobCancellation("job-2", undefined, async () => getJobUserId())
    expect(seen).toBeUndefined()
  })
})
