import { beforeEach, describe, expect, it, vi } from "vitest"

const kie = vi.hoisted(() => ({
  calls: [] as Array<{ model: string; input: Record<string, unknown> }>,
  impl: (async () => ({ resultJson: { resultUrls: ["https://kie.example/hd.mp4"] }, taskId: "task-final" })) as () => Promise<unknown>,
}))
vi.mock("../client.js", async (orig) => {
  const actual = await orig<typeof import("../client.js")>()
  return {
    ...actual,
    runKieTask: async (model: string, input: Record<string, unknown>) => {
      kie.calls.push({ model, input })
      return kie.impl()
    },
  }
})

import { KieError } from "../client.js"
import {
  SEEDANCE_DRAFT_FINALIZE_KIE_MODEL,
  SEEDANCE_DRAFT_UNAVAILABLE_MESSAGE,
  buildSeedanceDraftFinalizeInput,
  isSeedanceDraftUnavailableError,
  runSeedanceDraftFinalize,
} from "../seedance-draft.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

beforeEach(() => {
  kie.calls = []
  kie.impl = async () => ({ resultJson: { resultUrls: ["https://kie.example/hd.mp4"] }, taskId: "task-final" })
  delete process.env.KIE_SEEDANCE_25_OUTPUT_FORMAT
})

describe("Seedance draft finalize — KIE wire", () => {
  it("names the draft and nothing creative; 1080p; output_format is always sent", () => {
    expect(buildSeedanceDraftFinalizeInput("task-draft")).toEqual({
      draft_task_id: "task-draft",
      resolution: "1080p",
      output_format: "mp4",
    })
  })

  it("runs the draft model and returns the 1080p clip", async () => {
    const r = await runSeedanceDraftFinalize("task-draft")
    expect(kie.calls).toEqual([{ model: SEEDANCE_DRAFT_FINALIZE_KIE_MODEL, input: buildSeedanceDraftFinalizeInput("task-draft") }])
    expect(SEEDANCE_DRAFT_FINALIZE_KIE_MODEL).toBe("bytedance/seedance-2-5-draft")
    expect(r).toMatchObject({ url: "https://kie.example/hd.mp4", kieTaskId: "task-final" })
  })
})

describe("Seedance draft finalize — an expired / unknown draft", () => {
  const kieErr = (internal: string, upstream = false) => new KieError("Generation failed", internal, "Generation", upstream)

  it("a message naming the draft reference or an expiry fails deterministically with a clear message", async () => {
    for (const internal of [
      'createTask error (code 422): draft_task_id is invalid',
      'createTask error (code 400): the draft has expired',
      'createTask error (code 400): expired draft, please create a new one',
      'createTask error (code 404): Task not found',
      'createTask error (code 404): task id does not exist',
    ]) {
      kie.impl = async () => { throw kieErr(internal) }
      const err = await runSeedanceDraftFinalize("gone").catch((e: unknown) => e)
      expect(isDeterministicJobError(err), internal).toBe(true)
      expect((err as Error).message).toBe(SEEDANCE_DRAFT_UNAVAILABLE_MESSAGE)
    }
  })

  it("leaves every other failure on the normal path — generic text, a bare 'draft', network, content policy", async () => {
    for (const internal of [
      'createTask failed: 500 - {"code":500,"msg":"This field is required"}',
      "createTask failed: 500 - internal error while rendering the draft",
      "Resource not found",
      "fetch failed: ECONNRESET",
      "createTask failed: 401 - token expired",
      "createTask failed: 401 - API key has expired",
      "upload failed: the request signature expired",
    ]) {
      expect(isSeedanceDraftUnavailableError(kieErr(internal)), internal).toBe(false)
    }
    expect(isSeedanceDraftUnavailableError(new Error("draft_task_id expired"))).toBe(false)
    expect(isSeedanceDraftUnavailableError(new KieError("x", "draft_task_id expired", "Generation", true, true))).toBe(false)
    kie.impl = async () => { throw kieErr("createTask failed: 500 - internal error") }
    const err = await runSeedanceDraftFinalize("t").catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(false)
  })
})
