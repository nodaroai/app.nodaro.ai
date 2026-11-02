import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The sheet polls give up after a number of reads; a read that finds the job
// waiting for a free slot (`queued`) is not one of them.

const mockGetJobStatusLean = vi.fn()
vi.mock("@/lib/api", () => ({
  getJobStatusLean: (...a: unknown[]) => mockGetJobStatusLean(...a),
  generateCharacterAsset: vi.fn(),
  generateObjectAsset: vi.fn(),
  generateLocationAsset: vi.fn(),
}))

import { pollSheetJob, SHEET_POLL_MAX_ATTEMPTS, SHEET_POLL_MS } from "../poll-sheet-job"
import { SHEET_TAB_ADAPTERS } from "../sheet-tab-adapter"

/** Queued for `queuedReads` reads, then `after` for the rest. */
function queuedThen(queuedReads: number, after: Record<string, unknown>) {
  let reads = 0
  mockGetJobStatusLean.mockImplementation(async () => (++reads <= queuedReads ? { id: "j1", status: "queued" } : after))
}

describe("sheet poll and waiting for a free slot", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGetJobStatusLean.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it("sheet poll does not give up while queued", async () => {
    // Twice the whole budget in line, then done.
    let reads = 0
    mockGetJobStatusLean.mockImplementation(async () =>
      ++reads <= SHEET_POLL_MAX_ATTEMPTS * 2
        ? { id: "j1", status: "queued" }
        : reads < SHEET_POLL_MAX_ATTEMPTS * 2 + 10
          ? { id: "j1", status: "processing" }
          : { id: "j1", status: "completed", output_data: { imageUrl: "https://img/sheet.png" } },
    )
    const result = pollSheetJob("j1")
    await vi.advanceTimersByTimeAsync(SHEET_POLL_MS * (SHEET_POLL_MAX_ATTEMPTS * 2 + 20))
    await expect(result).resolves.toEqual({ imageUrl: "https://img/sheet.png", panelUrls: [] })
  })

  it("times out after the same number of reads as before on a job that never waits", async () => {
    mockGetJobStatusLean.mockResolvedValue({ id: "j1", status: "processing" })
    const result = pollSheetJob("j1")
    const settled = expect(result).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(SHEET_POLL_MS * (SHEET_POLL_MAX_ATTEMPTS + 1))
    await settled
    expect(mockGetJobStatusLean).toHaveBeenCalledTimes(SHEET_POLL_MAX_ATTEMPTS)
  })

  it("a sheet panel's poll does not give up while queued either", async () => {
    queuedThen(400, { id: "j1", status: "completed", output_data: { imageUrl: "https://img/panel.png" } })
    const panel = SHEET_TAB_ADAPTERS.object.awaitJob({}, "j1", "angles", "front")
    await vi.advanceTimersByTimeAsync(2000 * 410)
    await expect(panel).resolves.toBe("https://img/panel.png")
  })

  it("a sheet panel's poll times out after its 150 reads on a job that never waits", async () => {
    mockGetJobStatusLean.mockResolvedValue({ id: "j1", status: "pending" })
    const panel = SHEET_TAB_ADAPTERS.object.awaitJob({}, "j1", "angles", "front")
    const settled = expect(panel).rejects.toThrow("panel generation timed out")
    await vi.advanceTimersByTimeAsync(2000 * 151)
    await settled
    expect(mockGetJobStatusLean).toHaveBeenCalledTimes(150)
  })
})
