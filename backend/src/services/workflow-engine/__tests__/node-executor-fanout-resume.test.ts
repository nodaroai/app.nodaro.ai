/**
 * loadCompletedFanOutIterations — per-iteration resume for fan-out nodes.
 * Verifies the index→output mapping: only completed jobs of the target node,
 * keyed by the iterationIndex stamped on input_data, deduped, ignoring jobs of
 * other nodes and jobs with no index. (Mocks stub node-executor's heavy deps so
 * the test runs in pure Node.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { jobsRef } = vi.hoisted(() => ({ jobsRef: { value: [] as Array<Record<string, unknown>> } }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" }, hasCredits: () => true, isCloud: () => true,
  isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      // .select(...).eq("workflow_execution_id", X).eq("status", "completed")
      select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: jobsRef.value, error: null }) }) }),
    }),
  },
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn() } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn() }))
vi.mock("../payload-builder.js", () => ({ buildPayload: vi.fn() }))
// completedJobResult builds its output via buildNodeOutputFromJobData — echo imageUrl.
vi.mock("../output-extractor.js", () => ({
  buildNodeOutputFromJobData: (data: Record<string, unknown>) => ({ imageUrl: data?.imageUrl }),
}))
vi.mock("../resolve-field-mappings.js", () => ({ resolveFieldMappings: vi.fn(), NODE_MAPPABLE_FIELDS: {} }))
vi.mock("../execution-graph.js", () => ({ isSourceNode: () => false, isSkipNode: () => false }))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({}))
vi.mock("@nodaro/shared", () => ({
  mergeExposedSettings: vi.fn(), applyHandleInputOverride: (_e: unknown, n: unknown) => n, isHandleInputWired: () => false,
}))

import { loadCompletedFanOutIterations } from "../node-executor.js"

describe("loadCompletedFanOutIterations", () => {
  beforeEach(() => { jobsRef.value = [] })

  it("maps completed iterations of the target node by iterationIndex (deduped; ignores other nodes / un-indexed)", async () => {
    jobsRef.value = [
      { id: "fan-0", output_data: { imageUrl: "https://img0.png" }, credits_actual: 2, input_data: { node_id: "fan", iterationIndex: 0 } },
      { id: "fan-2", output_data: { imageUrl: "https://img2.png" }, credits_actual: 2, input_data: { node_id: "fan", iterationIndex: 2 } },
      { id: "fan-0b", output_data: { imageUrl: "https://dupe.png" }, credits_actual: 2, input_data: { node_id: "fan", iterationIndex: 0 } }, // dupe index → ignored
      { id: "other", output_data: { imageUrl: "https://other.png" }, credits_actual: 2, input_data: { node_id: "another", iterationIndex: 1 } }, // other node
      { id: "noidx", output_data: { imageUrl: "https://x.png" }, credits_actual: 2, input_data: { node_id: "fan" } }, // no index
    ]

    const map = await loadCompletedFanOutIterations("exec-1", "fan", "generate-image")

    expect([...map.keys()].sort((a, b) => a - b)).toEqual([0, 2])
    expect(map.get(0)?.output.imageUrl).toBe("https://img0.png") // first wins (dupe ignored)
    expect(map.get(2)?.output.imageUrl).toBe("https://img2.png")
    expect(map.get(0)?.jobId).toBe("fan-0")
  })

  it("returns an empty map on a first run (no completed iteration jobs yet)", async () => {
    jobsRef.value = []
    const map = await loadCompletedFanOutIterations("exec-1", "fan", "generate-image")
    expect(map.size).toBe(0)
  })
})
