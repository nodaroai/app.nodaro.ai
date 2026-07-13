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

const { mockSingle, mockCoreMarkJobCompleted } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
  mockCoreMarkJobCompleted: vi.fn(),
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
  return { ...actual, markJobCompleted: mockCoreMarkJobCompleted }
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
    mockCoreMarkJobCompleted.mockResolvedValue(true)

    const payload = { videoUrl: "https://cdn/x.mp4", pro: { version: 1, partial: false } }
    await expect(tk.jobs.markJobCompleted("job-1", payload)).resolves.toBe(true)

    // The core CAS receives COLUMNS: exactly one key, output_data — with the
    // payload shallow-merged over what was already there (payload.pro wins;
    // unrelated keys like smartCuts survive).
    expect(mockCoreMarkJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: {
        smartCuts: [1],
        videoUrl: "https://cdn/x.mp4",
        pro: { version: 1, partial: false },
      },
    })
    // The regression: payload keys must NEVER reach the core spread as
    // top-level fields (they'd become UPDATE columns → PostgREST error).
    const fields = mockCoreMarkJobCompleted.mock.calls[0]![1] as Record<string, unknown>
    expect(Object.keys(fields)).toEqual(["output_data"])
  })

  it("null existing output_data → payload becomes the whole output_data", async () => {
    mockSingle.mockResolvedValue({ data: { output_data: null }, error: null })
    mockCoreMarkJobCompleted.mockResolvedValue(true)

    await tk.jobs.markJobCompleted("job-2", { videoUrl: "https://cdn/y.mp4" })

    expect(mockCoreMarkJobCompleted).toHaveBeenCalledWith("job-2", {
      output_data: { videoUrl: "https://cdn/y.mp4" },
    })
  })

  it("core CAS false (cancelled/terminal) passes through as false — caller skips the credit commit", async () => {
    mockSingle.mockResolvedValue({ data: { output_data: {} }, error: null })
    mockCoreMarkJobCompleted.mockResolvedValue(false)

    await expect(tk.jobs.markJobCompleted("job-3", { videoUrl: "u" })).resolves.toBe(false)
  })

  it("read failure THROWS (retryable) instead of returning false — false would silently skip the credit commit for a delivered output", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "connection reset" } })

    await expect(tk.jobs.markJobCompleted("job-4", { videoUrl: "u" })).rejects.toThrow(
      /Failed to read output_data for job job-4/,
    )
    expect(mockCoreMarkJobCompleted).not.toHaveBeenCalled()
  })
})
