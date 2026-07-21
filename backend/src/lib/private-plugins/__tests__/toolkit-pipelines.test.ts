/**
 * Unit coverage for the `tk.pipelines` toolkit group (seeded-run lane) and the
 * additive `tk.jobs.readJob` member.
 *
 * `pipelines.createSeeded`/`estimateSeeded` reach `ee/` through a runtime
 * dynamic `import()` inside the method body — `toolkit.ts` is core and may not
 * statically import `ee/` (enforced by `tools/check-ee-imports.mjs`). The two
 * ee target modules are mocked here so the forwarding tests don't need a real
 * `ee/` build, mirroring `toolkit-evp.test.ts`'s `@/ee/billing/...` mock for
 * the same shim pattern.
 *
 * `pipelines.getSnapshot`/`jobs.readJob` query the core `supabase` client
 * directly; the chainable stub mirrors `toolkit-gvp.test.ts`'s `makeChain`
 * (every builder method returns the same chain; `.maybeSingle()`/`.single()`
 * resolve, and the chain is directly thenable so an `.order()`-terminated
 * list query resolves when awaited).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, mockCreateSeededPipeline, mockEstimateSeededPipelineCredits } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockCreateSeededPipeline: vi.fn(),
  mockEstimateSeededPipelineCredits: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mockFrom } }))
vi.mock("@/ee/pipelines/seed-pipeline.js", () => ({ createSeededPipeline: mockCreateSeededPipeline }))
vi.mock("@/ee/pipelines/credits.js", () => ({
  estimateSeededPipelineCredits: mockEstimateSeededPipelineCredits,
}))

import { buildToolkit } from "../toolkit.js"
import type { PluginToolkit } from "../types.js"

// ---------------------------------------------------------------------------
// Chainable Supabase-postgrest-like builder stub (see file header). `.order()`
// returns the chain (list queries end on it and resolve via `.then`);
// `.maybeSingle()` resolves the terminal directly.
// ---------------------------------------------------------------------------
interface Terminal {
  data: unknown
  error: { message: string } | null
}

function makeChain(terminal: Terminal) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(terminal)),
    single: vi.fn(() => Promise.resolve(terminal)),
    then: (onFulfilled: (v: Terminal) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(terminal).then(onFulfilled, onRejected),
  }
  return chain
}

/** Route each `from(table)` call to that table's configured terminal. */
function routeTables(terminals: Record<string, Terminal>): void {
  mockFrom.mockImplementation((table: string) => makeChain(terminals[table] ?? { data: null, error: null }))
}

describe("tk.pipelines + tk.jobs.readJob", () => {
  let tk: PluginToolkit

  beforeEach(() => {
    vi.clearAllMocks()
    tk = buildToolkit()
  })

  // -------------------------------------------------------------------------
  // Case 1: createSeeded forwards to the seed service (dynamic-import mocked).
  // -------------------------------------------------------------------------
  describe("pipelines.createSeeded", () => {
    it("forwards (supabase, input) to the seeded-pipeline service and returns its result", async () => {
      mockCreateSeededPipeline.mockResolvedValue({ pipelineId: "pipe-1", reservedCredits: 42 })

      const input = {
        userId: "user-1",
        workflowId: "wf-1",
        inputPrompt: "Provenance: sample",
        plan: { target_duration_seconds: 20 },
      }
      const result = await tk.pipelines.createSeeded(input)

      expect(mockCreateSeededPipeline).toHaveBeenCalledTimes(1)
      const [passedSupabase, passedInput] = mockCreateSeededPipeline.mock.calls[0]!
      expect(passedInput).toBe(input)
      // The core supabase client is forwarded as the first positional arg.
      expect(typeof (passedSupabase as { from?: unknown }).from).toBe("function")
      expect(result).toEqual({ pipelineId: "pipe-1", reservedCredits: 42 })
    })
  })

  // -------------------------------------------------------------------------
  // estimateSeeded is the estimation twin — forwards to the credit estimator.
  // -------------------------------------------------------------------------
  describe("pipelines.estimateSeeded", () => {
    it("forwards (supabase, input) to the credit estimator and returns its result", async () => {
      mockEstimateSeededPipelineCredits.mockResolvedValue({
        totalCredits: 100,
        breakdown: { pipelineUpfront: 45, keyframes: 20, animation: 30, speech: 0, music: 5 },
      })

      const input = { plan: { target_duration_seconds: 20 }, config: { music_enabled: true } }
      const result = await tk.pipelines.estimateSeeded(input)

      expect(mockEstimateSeededPipelineCredits).toHaveBeenCalledTimes(1)
      expect(mockEstimateSeededPipelineCredits.mock.calls[0]![1]).toBe(input)
      expect(result).toEqual({
        totalCredits: 100,
        breakdown: { pipelineUpfront: 45, keyframes: 20, animation: 30, speech: 0, music: 5 },
      })
    })
  })

  // -------------------------------------------------------------------------
  // Case 2: getSnapshot enforces ownership — a foreign userId → null, and the
  // stages/asset follow-up queries never run.
  // -------------------------------------------------------------------------
  describe("pipelines.getSnapshot ownership", () => {
    it("returns null when the pipelines row does not match (foreign userId → no row)", async () => {
      routeTables({ pipelines: { data: null, error: null } })

      await expect(tk.pipelines.getSnapshot("pipe-1", "not-the-owner")).resolves.toBeNull()

      // Only the ownership-scoped pipelines read ran; no stages/assets follow-up.
      expect(mockFrom).toHaveBeenCalledTimes(1)
      expect(mockFrom).toHaveBeenCalledWith("pipelines")
    })

    it("scopes the pipelines read by both id and user_id", async () => {
      const pipelinesChain = makeChain({ data: null, error: null })
      mockFrom.mockImplementation((table: string) =>
        table === "pipelines" ? pipelinesChain : makeChain({ data: null, error: null }),
      )

      await tk.pipelines.getSnapshot("pipe-1", "user-9")

      expect(pipelinesChain.eq).toHaveBeenCalledWith("id", "pipe-1")
      expect(pipelinesChain.eq).toHaveBeenCalledWith("user_id", "user-9")
    })
  })

  // -------------------------------------------------------------------------
  // Case 3: getSnapshot maps final_output_asset_id → a public finalOutputUrl,
  // stages to camelCase, and credit columns to the snapshot shape.
  // -------------------------------------------------------------------------
  describe("pipelines.getSnapshot mapping", () => {
    it("maps DB columns to PipelineSnapshot and resolves final_output_asset_id → finalOutputUrl", async () => {
      routeTables({
        pipelines: {
          data: {
            id: "pipe-1",
            status: "completed",
            current_stage: "post_merge",
            spent_credits: 87,
            reserved_credits: 120,
            upfront_credit_estimate: 120,
            final_output_asset_id: "asset-final",
            failure_reason: null,
            current_progress_message: "Rendering",
          },
          error: null,
        },
        pipeline_stages: {
          data: [
            { stage_name: "script", status: "approved" },
            { stage_name: "shot_list", status: "approved" },
            { stage_name: "post_merge", status: "running" },
          ],
          error: null,
        },
        assets: { data: { r2_url: "https://cdn.example.com/final.mp4" }, error: null },
      })

      const snapshot = await tk.pipelines.getSnapshot("pipe-1", "user-1")

      expect(snapshot).toEqual({
        id: "pipe-1",
        status: "completed",
        currentStage: "post_merge",
        stages: [
          { stageName: "script", status: "approved" },
          { stageName: "shot_list", status: "approved" },
          { stageName: "post_merge", status: "running" },
        ],
        spentCredits: 87,
        reservedCredits: 120,
        upfrontCreditEstimate: 120,
        finalOutputUrl: "https://cdn.example.com/final.mp4",
        failureReason: null,
        progressMessage: "Rendering",
      })
    })

    it("leaves finalOutputUrl null when no final_output_asset_id is set (no assets lookup)", async () => {
      routeTables({
        pipelines: {
          data: {
            id: "pipe-2",
            status: "running",
            current_stage: "scene_images",
            spent_credits: 10,
            reserved_credits: 120,
            upfront_credit_estimate: 120,
            final_output_asset_id: null,
            failure_reason: null,
            current_progress_message: null,
          },
          error: null,
        },
        pipeline_stages: { data: [], error: null },
      })

      const snapshot = await tk.pipelines.getSnapshot("pipe-2", "user-1")

      expect(snapshot?.finalOutputUrl).toBeNull()
      expect(snapshot?.stages).toEqual([])
      // No assets lookup when there is no final asset id.
      expect(mockFrom).not.toHaveBeenCalledWith("assets")
    })
  })

  // -------------------------------------------------------------------------
  // Error handling: the primary pipelines read must SURFACE a DB fault (throw,
  // so the consuming route can 500 instead of a spurious 404) — a swallowed
  // error → null is indistinguishable from not-found/ownership-fail. The
  // stages/asset follow-up reads degrade gracefully (partial snapshot) but log
  // the swallowed error so it's observable.
  // -------------------------------------------------------------------------
  describe("pipelines.getSnapshot error handling", () => {
    const okPipeline = (overrides: Record<string, unknown> = {}) => ({
      id: "pipe-1",
      status: "running",
      current_stage: "script",
      spent_credits: 5,
      reserved_credits: 120,
      upfront_credit_estimate: 120,
      final_output_asset_id: null,
      failure_reason: null,
      current_progress_message: null,
      ...overrides,
    })

    it("read 1 (pipelines) DB error → THROWS (route can 500), not a null not-found", async () => {
      routeTables({ pipelines: { data: null, error: { message: "connection reset" } } })

      await expect(tk.pipelines.getSnapshot("pipe-1", "user-1")).rejects.toThrow(/connection reset/)
      // The fault surfaced on the primary read; no stages/asset follow-up ran.
      expect(mockFrom).toHaveBeenCalledTimes(1)
      expect(mockFrom).toHaveBeenCalledWith("pipelines")
    })

    it("read 2 (stages) DB error → snapshot still returned with empty stages, error logged", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      routeTables({
        pipelines: { data: okPipeline(), error: null },
        pipeline_stages: { data: null, error: { message: "stages boom" } },
      })

      const snap = await tk.pipelines.getSnapshot("pipe-1", "user-1")

      expect(snap?.id).toBe("pipe-1")
      expect(snap?.stages).toEqual([]) // degraded but present, not a throw
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })

    it("read 3 (asset) DB error → snapshot still returned with finalOutputUrl null, error logged", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      routeTables({
        pipelines: {
          data: okPipeline({ status: "completed", final_output_asset_id: "asset-final" }),
          error: null,
        },
        pipeline_stages: { data: [{ stage_name: "script", status: "approved" }], error: null },
        assets: { data: null, error: { message: "asset boom" } },
      })

      const snap = await tk.pipelines.getSnapshot("pipe-1", "user-1")

      expect(snap?.finalOutputUrl).toBeNull() // degraded but snapshot present
      expect(snap?.stages).toEqual([{ stageName: "script", status: "approved" }])
      expect(errSpy).toHaveBeenCalled()
      errSpy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // Case 4: jobs.readJob returns the narrow {id,status,user_id,output_data,
  // error_message} shape, or null when the row is missing.
  // -------------------------------------------------------------------------
  describe("jobs.readJob", () => {
    it("returns the narrow job shape when the row exists (incl. the 2026-07-21 job_type/input_data widening for gvp continue)", async () => {
      routeTables({
        jobs: {
          data: {
            id: "job-1",
            status: "completed",
            user_id: "user-1",
            output_data: { videoUrl: "https://cdn.example.com/x.mp4" },
            error_message: null,
            job_type: "generate-video-pro",
            input_data: { prompt: "a heist" },
          },
          error: null,
        },
      })

      await expect(tk.jobs.readJob("job-1")).resolves.toEqual({
        id: "job-1",
        status: "completed",
        user_id: "user-1",
        output_data: { videoUrl: "https://cdn.example.com/x.mp4" },
        error_message: null,
        job_type: "generate-video-pro",
        input_data: { prompt: "a heist" },
      })
      expect(mockFrom).toHaveBeenCalledWith("jobs")
    })

    it("returns null when the job row is missing", async () => {
      routeTables({ jobs: { data: null, error: null } })

      await expect(tk.jobs.readJob("missing")).resolves.toBeNull()
    })

    it("normalizes null output_data/input_data to null (not undefined)", async () => {
      routeTables({
        jobs: {
          data: { id: "job-2", status: "failed", user_id: null, output_data: null, error_message: "boom", job_type: "generate-video", input_data: null },
          error: null,
        },
      })

      await expect(tk.jobs.readJob("job-2")).resolves.toEqual({
        id: "job-2",
        status: "failed",
        user_id: null,
        output_data: null,
        error_message: "boom",
        job_type: "generate-video",
        input_data: null,
      })
    })
  })
})
