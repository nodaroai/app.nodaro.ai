/**
 * A continuation keeps the speakers' names its run kept (decided 2026-11-17):
 * the new wrapper's input carries them, so its output names the speakers too.
 */
import { describe, it, expect } from "vitest"
import { ID, failedWrapper, m, post, src } from "./helpers/use-case-continue-harness.js"

const inputOf = () => (m.insertJob.mock.calls[0]![1] as { input_data: Record<string, unknown> }).input_data

describe("POST /v1/tighten-episode/continue and the speakers' names", () => {
  it("from-failed: the new wrapper keeps the names the run kept", async () => {
    src.wrapper = { ...failedWrapper, input_data: { ...failedWrapper.input_data, speakerNames: { speaker_0: "Dana", speaker_1: "Avi" } } }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(202)
    expect(inputOf().speakerNames).toEqual({ speaker_0: "Dana", speaker_1: "Avi" })
  })
  it("a run that kept none: the continuation keeps none", async () => {
    await post({ jobId: ID, mode: "from-failed" })
    expect(inputOf()).not.toHaveProperty("speakerNames")
  })
})
