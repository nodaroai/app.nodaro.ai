import { describe, expect, it } from "vitest"
import { DUBBING_ERROR_CODES } from "@nodaro/shared/media"
import { DUBBING_PROBLEMS, dubbingAnswer, dubbingProblemBody, dubbingRefusal } from "../dubbing-problems.js"

const rows = Object.values(DUBBING_PROBLEMS)

describe("DUBBING_PROBLEMS", () => {
  it("answers every public dubbing error code, and no code the public list lacks", () => {
    const answered = rows.map((row) => row.code).filter((code) => code !== "not_found")

    expect([...answered].sort()).toEqual([...DUBBING_ERROR_CODES].sort())
  })

  it("tells each refusal once", () => {
    const codes = rows.map((row) => row.code)

    expect(new Set(codes).size).toBe(codes.length)
  })

  it("answers each refusal with a client or gateway status and words of its own", () => {
    for (const row of rows) {
      expect(row.status === 502 || (row.status >= 400 && row.status < 500)).toBe(true)
      expect(row.message.trim()).not.toBe("")
    }
  })

  it("tells a job that may not be read in the words a missing job is told in", () => {
    expect(DUBBING_PROBLEMS.notFound).toEqual({ status: 404, code: "not_found", message: "Job not found" })
  })
})

describe("dubbing outcomes", () => {
  it("carries a value", () => {
    expect(dubbingAnswer(7)).toEqual({ ok: true, value: 7 })
  })

  it("carries a refusal, and its cause only when there is one", () => {
    expect(dubbingRefusal(DUBBING_PROBLEMS.notReady)).toEqual({ ok: false, problem: DUBBING_PROBLEMS.notReady })
    const cause = new Error("gateway")
    expect(dubbingRefusal(DUBBING_PROBLEMS.readFailed, cause)).toEqual({ ok: false, problem: DUBBING_PROBLEMS.readFailed, cause })
  })

  it("sends the code and the words, never the cause", () => {
    expect(dubbingProblemBody(DUBBING_PROBLEMS.unavailable)).toEqual({
      error: { code: "dubbing_unavailable", message: "This dub is no longer held by the dubbing service." },
    })
  })
})
