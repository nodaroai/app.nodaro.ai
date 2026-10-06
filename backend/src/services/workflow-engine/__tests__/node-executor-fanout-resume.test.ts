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
vi.mock("@/lib/supabase.js", () => {
  // A chain that APPLIES its `.eq` filters to the rows, so a filter the query
  // leaves out shows up as a row the test did not expect.
  const chain = (rows: Array<Record<string, unknown>>): Record<string, unknown> => ({
    eq: (col: string, val: unknown) => chain(rows.filter((r) => r[col] === val)),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
  })
  return { supabase: { from: () => ({ select: () => chain(jobsRef.value) }) } }
})
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn() } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn() }))
vi.mock("../payload-builder.js", () => ({ buildPayload: vi.fn() }))
// node-executor resolves the execution's availability viewer itself; stubbed
// so the real viewer's Supabase lookups stay out of this pure-Node test.
vi.mock("@/lib/availability-viewer.js", () => ({
  viewerForNode: async () => ({ admin: false }),
  assertNodeAvailableForUser: async () => {},
}))
// completedJobResult builds its output via buildNodeOutputFromJobData — echo imageUrl.
vi.mock("../output-extractor.js", () => ({
  buildNodeOutputFromJobData: (data: Record<string, unknown>) => ({ imageUrl: data?.imageUrl }),
}))
vi.mock("../resolve-field-mappings.js", () => ({ resolveFieldMappings: vi.fn(), NODE_MAPPABLE_FIELDS: {} }))
vi.mock("../execution-graph.js", () => ({ isSourceNode: () => false, isSkipNode: () => false }))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({}))
vi.mock("@nodaro/prompts", () => ({
  appendField: vi.fn((a: string) => a), appendMusicMeta: vi.fn(), assembleImageInput: vi.fn(() => ({ prompt: "", referenceImageUrls: [] })),
  assembleSunoInput: vi.fn(() => ({})), buildCharacterPrompt: vi.fn(() => ""), buildCreaturePrompt: vi.fn(() => ""),
  buildFaceTemplateInputs: vi.fn(() => ({})), buildImagePrompt: vi.fn(() => ({ prompt: "" })), buildLocationPrompt: vi.fn(() => ""),
  buildObjectPrompt: vi.fn(() => ""), buildScenePrompt: vi.fn(() => ""), characterLockToRefLock: vi.fn(),
  collectIdentityLockClause: vi.fn(() => ""), composeSoundHintFromConnections: vi.fn(() => null),
  getParameterPromptHint: vi.fn(() => ""), pickerFanoutTargets: vi.fn(() => []), resolveVideoReferenceCore: vi.fn(() => ({})),
  truncateForField: vi.fn((s: string) => s),
}))
// Spread the real module and override only what this test drives: a
// hand-listed stub breaks the moment any transitively imported module reads a
// new shared export at load time (apply-edl-plan's EDL_SOURCE_ROLES did).
vi.mock("@nodaro/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared")>()),
  mergeExposedSettings: vi.fn(), applyHandleInputOverride: (_e: unknown, n: unknown) => n, isHandleInputWired: () => false,
}))

import { loadCompletedFanOutIterations } from "../node-executor.js"

/** A completed iteration job of exec-1, owned by the execution's owner unless overridden. */
function row(r: Record<string, unknown>): Record<string, unknown> {
  return { workflow_execution_id: "exec-1", status: "completed", user_id: "owner-1", ...r }
}

describe("loadCompletedFanOutIterations", () => {
  beforeEach(() => { jobsRef.value = [] })

  it("maps completed iterations of the target node by iterationIndex (deduped; ignores other nodes / un-indexed)", async () => {
    jobsRef.value = [
      row({ id: "fan-0", output_data: { imageUrl: "https://img0.png" }, credits_actual: 2, input_data: { node_id: "fan", iterationIndex: 0 } }),
      row({ id: "fan-2", output_data: { imageUrl: "https://img2.png" }, credits_actual: 2, input_data: { node_id: "fan", iterationIndex: 2 } }),
      row({ id: "fan-0b", output_data: { imageUrl: "https://dupe.png" }, credits_actual: 2, input_data: { node_id: "fan", iterationIndex: 0 } }), // dupe index → ignored
      row({ id: "other", output_data: { imageUrl: "https://other.png" }, credits_actual: 2, input_data: { node_id: "another", iterationIndex: 1 } }), // other node
      row({ id: "noidx", output_data: { imageUrl: "https://x.png" }, credits_actual: 2, input_data: { node_id: "fan" } }), // no index
    ]

    const map = await loadCompletedFanOutIterations("exec-1", "owner-1", "fan", "generate-image")

    expect([...map.keys()].sort((a, b) => a - b)).toEqual([0, 2])
    expect(map.get(0)?.output.imageUrl).toBe("https://img0.png") // first wins (dupe ignored)
    expect(map.get(2)?.output.imageUrl).toBe("https://img2.png")
    expect(map.get(0)?.jobId).toBe("fan-0")
  })

  it("returns an empty map on a first run (no completed iteration jobs yet)", async () => {
    jobsRef.value = []
    const map = await loadCompletedFanOutIterations("exec-1", "owner-1", "fan", "generate-image")
    expect(map.size).toBe(0)
  })

  it("attacker: a completed job another user pointed at this execution is never reused", async () => {
    // Before 474 a browser could insert its own `jobs` row naming any
    // execution. The resumed run must not pick its output up as an iteration.
    jobsRef.value = [
      row({ id: "planted", user_id: "attacker", output_data: { imageUrl: "https://evil.example/x.png" }, credits_actual: 0, input_data: { node_id: "fan", iterationIndex: 0 } }),
      row({ id: "fan-1", output_data: { imageUrl: "https://img1.png" }, credits_actual: 2, input_data: { node_id: "fan", iterationIndex: 1 } }),
    ]
    const map = await loadCompletedFanOutIterations("exec-1", "owner-1", "fan", "generate-image")
    expect([...map.keys()]).toEqual([1])
    expect(map.get(1)?.jobId).toBe("fan-1")
  })
})
