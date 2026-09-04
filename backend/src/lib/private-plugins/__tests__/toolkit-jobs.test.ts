/**
 * `tk.jobs.markJobCompleted` — the OUTPUT-PAYLOAD → `output_data` nesting
 * wrapper (`pluginMarkJobCompleted`).
 *
 * Regression net for the 2026-07-13 completion outage: the toolkit used to
 * register the CORE `workers/shared.ts` `markJobCompleted` raw, which spreads
 * its `fields` as UPDATE COLUMNS — the plugins' `{ videoUrl, pro }` payload
 * then hit PostgREST as unknown columns ("Could not find the 'pro' column of
 * 'jobs' in the schema cache"), completion returned false (read as
 * cancelled-mid-flight), and fully-generated gvp/evp jobs rotted in
 * status=processing until the reconcile sweep failed+refunded them
 * (jobs 1e209599, dbf95612 — the latter with a finished stitch in hand).
 *
 * Mocking convention mirrors toolkit-evp.test.ts in this directory (partial
 * config mock; full-replace only the modules the member under test calls).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockSingle, mockCoreMarkJobCompletedDetailed } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
  mockCoreMarkJobCompletedDetailed: vi.fn(),
}))

vi.mock(import("@/lib/config.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, hasCredits: () => true }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: mockSingle })),
      })),
      // updateJobCheckpoint/clearReconcileSentinel share this client — give
      // them a resolvable no-op chain so importing the module stays inert.
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })),
    })),
  },
}))

vi.mock(import("@/workers/shared.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, markJobCompletedDetailed: mockCoreMarkJobCompletedDetailed }
})

import { buildToolkit } from "../toolkit.js"
import type { PluginToolkit } from "../types.js"

describe("tk.jobs.markJobCompleted — output-payload nesting wrapper", () => {
  let tk: PluginToolkit

  beforeEach(() => {
    vi.clearAllMocks()
    tk = buildToolkit()
  })

  it("nests the plugin's output payload under output_data, MERGED over the existing checkpoint", async () => {
    // A finished gvp job: output_data already holds the engine's checkpoint.
    mockSingle.mockResolvedValue({ data: { output_data: { pro: { version: 1, segments: [] }, smartCuts: [1] } }, error: null })
    mockCoreMarkJobCompletedDetailed.mockResolvedValue("completed")

    const payload = { videoUrl: "https://cdn/x.mp4", pro: { version: 1, partial: false } }
    await expect(tk.jobs.markJobCompleted("job-1", payload)).resolves.toBe(true)

    // The core CAS receives COLUMNS: exactly one key, output_data — with the
    // payload shallow-merged over what was already there (payload.pro wins;
    // unrelated keys like smartCuts survive).
    expect(mockCoreMarkJobCompletedDetailed).toHaveBeenCalledWith("job-1", {
      output_data: {
        smartCuts: [1],
        videoUrl: "https://cdn/x.mp4",
        pro: { version: 1, partial: false },
      },
    })
    // The regression: payload keys must NEVER reach the core spread as
    // top-level fields (they'd become UPDATE columns → PostgREST error).
    const fields = mockCoreMarkJobCompletedDetailed.mock.calls[0]![1] as Record<string, unknown>
    expect(Object.keys(fields)).toEqual(["output_data"])
  })

  it("null existing output_data → payload becomes the whole output_data", async () => {
    mockSingle.mockResolvedValue({ data: { output_data: null }, error: null })
    mockCoreMarkJobCompletedDetailed.mockResolvedValue("completed")

    await tk.jobs.markJobCompleted("job-2", { videoUrl: "https://cdn/y.mp4" })

    expect(mockCoreMarkJobCompletedDetailed).toHaveBeenCalledWith("job-2", {
      output_data: { videoUrl: "https://cdn/y.mp4" },
    })
  })

  it("keys a plugin persisted into output_data at INSERT time survive the completion read-merge", async () => {
    // Some plugins persist business-data keys into output_data at INSERT
    // time — before the job ever reaches this completion wrapper — not just
    // engine checkpoints like `pro` (already covered above). The read-merge
    // must preserve those insert-time keys verbatim and add the completion
    // payload's keys alongside them, never overwrite the row wholesale.
    mockSingle.mockResolvedValue({
      data: { output_data: { markerA: "inspired", markerB: "aj-1" } },
      error: null,
    })
    mockCoreMarkJobCompletedDetailed.mockResolvedValue("completed")

    await tk.jobs.markJobCompleted("job-5", { json: { pipelineId: "p-1" } })

    expect(mockCoreMarkJobCompletedDetailed).toHaveBeenCalledWith("job-5", {
      output_data: {
        markerA: "inspired",
        markerB: "aj-1",
        json: { pipelineId: "p-1" },
      },
    })
  })

  it("core CAS false (cancelled/terminal) passes through as false — caller skips the credit commit", async () => {
    mockSingle
      .mockResolvedValueOnce({ data: { output_data: {} }, error: null })
      .mockResolvedValueOnce({
        data: { status: "cancelled", output_data: {} },
        error: null,
      })
    mockCoreMarkJobCompletedDetailed.mockResolvedValue("lost_race")

    await expect(tk.jobs.markJobCompleted("job-3", { videoUrl: "u" })).resolves.toBe(false)
  })

  it("recognizes an exact completed row when the completion response was lost", async () => {
    const completedOutput = {
      pro: { version: 1 },
      videoUrl: "https://cdn/result.mp4",
    }
    mockSingle
      .mockResolvedValueOnce({
        data: { output_data: { pro: { version: 0 } } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: "completed", output_data: completedOutput },
        error: null,
      })
    mockCoreMarkJobCompletedDetailed.mockResolvedValue("lost_race")

    await expect(tk.jobs.markJobCompleted("job-6", completedOutput)).resolves.toBe(true)
  })

  // `pending_review` is IN-FLIGHT (D14): a job parked on a reviewer has not
  // finished, so the plugin's own "is it still live?" probe must say LIVE. It
  // used to hard-code ["pending","queued","processing"] and answer a silent
  // `false` for a held job — which a plugin reads as "cancelled: delete the
  // staged media".
  it.each(["pending", "queued", "processing", "pending_review"])(
    "throws when a lost-race completion result leaves the job %s",
    async (status) => {
      mockSingle
        .mockResolvedValueOnce({ data: { output_data: {} }, error: null })
        .mockResolvedValueOnce({
          data: { status, output_data: {} },
          error: null,
        })
      mockCoreMarkJobCompletedDetailed.mockResolvedValue("lost_race")

      await expect(tk.jobs.markJobCompleted("job-7", { videoUrl: "u" }))
        .rejects.toThrow(/still live/i)
    },
  )

  it("read failure THROWS (retryable) instead of returning false — false would silently skip the credit commit for a delivered output", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "connection reset" } })

    await expect(tk.jobs.markJobCompleted("job-4", { videoUrl: "u" })).rejects.toThrow(
      /Failed to read output_data for job job-4/,
    )
    expect(mockCoreMarkJobCompletedDetailed).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The result gate lives inside the completion funnel now, so this wrapper sees
// two outcomes it never could before. Both are DEFINITIVE — the gate has
// already written the row (failed for a block, `pending_review` for a hold) —
// so the ambiguity-resolving re-read must not run at all: it would read a
// `pending_review` row and throw "still live" into the worker catch, turning a
// hold into a retry loop.
// ---------------------------------------------------------------------------
describe("tk.jobs.markJobCompleted — policy outcomes", () => {
  let tk: PluginToolkit

  beforeEach(() => {
    vi.clearAllMocks()
    tk = buildToolkit()
  })

  it.each(["blocked", "held"] as const)("%s → false immediately, with no terminal re-read", async (outcome) => {
    mockSingle.mockResolvedValueOnce({ data: { output_data: {} }, error: null })
    mockCoreMarkJobCompletedDetailed.mockResolvedValue(outcome)

    await expect(tk.jobs.markJobCompleted("job-policy", { videoUrl: "u" })).resolves.toBe(false)
    // Exactly ONE read: the output_data merge. The second (the "did it actually
    // commit?" probe) must not happen.
    expect(mockSingle).toHaveBeenCalledTimes(1)
  })
})

