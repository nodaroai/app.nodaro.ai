/** The cover's own limit: a fixed window per user, refused once full, open again when it ends. */
import { beforeEach, describe, expect, it } from "vitest"
import { JOB_COVER_WRITE_LIMIT, resetCoverWriteLimitForTests, takeCoverWrite } from "../cover-rate-limit.js"

beforeEach(() => resetCoverWriteLimitForTests())

describe("takeCoverWrite", () => {
  it("allows the limit in one window, refuses the next with the seconds left, and opens again when the window ends", () => {
    const t0 = 1_000_000
    for (let i = 0; i < JOB_COVER_WRITE_LIMIT.max; i++) expect(takeCoverWrite("u1", t0 + i).allowed).toBe(true)
    expect(takeCoverWrite("u1", t0 + 30_000)).toEqual({ allowed: false, retryAfterSec: 30 })
    expect(takeCoverWrite("u2", t0 + 30_000).allowed).toBe(true)
    expect(takeCoverWrite("u1", t0 + JOB_COVER_WRITE_LIMIT.windowMs).allowed).toBe(true)
  })
})
