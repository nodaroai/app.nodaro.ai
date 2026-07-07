/**
 * S9 — createPipeline()'s pipelinePromptsAvailable() fast-fail.
 *
 * createPipeline() is the single funnel both POST /v1/pipelines and the MCP
 * start_pipeline tool use. When the film-studio-prompts plugin isn't loaded
 * (PRIVATE_MODULES=optional, or a load failure), every pipeline would
 * otherwise create a DB row + reserve credits + enqueue a BullMQ job only to
 * fail asynchronously at Stage 1 the first time a run*() wrapper calls
 * getPipelinePrompt(). This suite verifies the fast-fail returns a clean 503
 * BEFORE any of that happens, and that it does NOT short-circuit the normal
 * flow when prompts ARE available.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  mockPipelinePromptsAvailable: vi.fn(),
  mockValidateDurationForFormat: vi.fn(),
}))

vi.mock("../llms/prompt-registry.js", () => ({
  pipelinePromptsAvailable: mocks.mockPipelinePromptsAvailable,
}))

// Partial mock (importOriginal) — @nodaro/shared has many real exports
// (types, schemas, other validators); only validateDurationForFormat is
// overridden here so the second test can force a determinate downstream
// error without needing valid PipelineInput data.
vi.mock("@nodaro/shared", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    validateDurationForFormat: mocks.mockValidateDurationForFormat,
  }
})

import { createPipeline } from "../create-pipeline.js"

describe("createPipeline — S9 pipelinePromptsAvailable() fast-fail", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 503 pipeline_engine_unavailable when prompts are unavailable, before touching supabase or validating input", async () => {
    mocks.mockPipelinePromptsAvailable.mockReturnValue(false)
    const supabaseFrom = vi.fn(() => {
      throw new Error("supabase.from should not be called — fast-fail must run first")
    })

    const result = await createPipeline({
      supabase: { from: supabaseFrom } as never,
      userId: "u1",
      // Deliberately empty/invalid — never reached if the fast-fail runs first.
      input: {} as never,
    })

    expect(result).toEqual({
      ok: false,
      status: 503,
      code: "pipeline_engine_unavailable",
      message: "The film-studio pipeline is temporarily unavailable in this deployment.",
    })
    expect(supabaseFrom).not.toHaveBeenCalled()
    expect(mocks.mockValidateDurationForFormat).not.toHaveBeenCalled()
  })

  it("falls through to the normal flow when prompts ARE available (doesn't over-trigger)", async () => {
    mocks.mockPipelinePromptsAvailable.mockReturnValue(true)
    mocks.mockValidateDurationForFormat.mockReturnValue({
      ok: false,
      reason: "15s is below the minimum for format 'short_film'",
    })

    const result = await createPipeline({
      supabase: { from: vi.fn() } as never,
      userId: "u1",
      input: { format: "short_film", target_duration_seconds: 15 } as never,
    })

    // Proves execution proceeded PAST the fast-fail into the pre-existing
    // duration-validation check — a different, real code path.
    expect(mocks.mockValidateDurationForFormat).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      ok: false,
      status: 400,
      code: "duration_out_of_bounds",
      message: "15s is below the minimum for format 'short_film'",
    })
  })
})
