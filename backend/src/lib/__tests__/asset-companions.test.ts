import { describe, it, expect, vi } from "vitest"

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../config.js", () => ({ config: { R2_PUBLIC_URL: "https://r2.test.com" } }))

import { companionsForRow, companionsOf, withoutCompanions } from "../asset-companions.js"

const JOB = "11111111-1111-4111-8111-111111111111"
const PRIMARY = `videos/${JOB}.mp4`

describe("companionsOf", () => {
  it("keeps only entries in the row's own key family, each size a non-negative integer", () => {
    expect(
      companionsOf(
        {
          companions: [
            { key: `videos/${JOB}-engine.mp4`, sizeBytes: 7000 },
            { key: `videos/${JOB}-engine.mp4`, sizeBytes: 1 },
            { key: `videos/${JOB}-other.mp4`, sizeBytes: -5 },
            { key: "videos/22222222-2222-4222-8222-222222222222-engine.mp4", sizeBytes: 9 },
            { key: PRIMARY, sizeBytes: 9 },
            "not an entry",
            { sizeBytes: 9 },
          ],
        },
        PRIMARY,
      ),
    ).toEqual([
      { key: `videos/${JOB}-engine.mp4`, sizeBytes: 7000 },
      { key: `videos/${JOB}-other.mp4`, sizeBytes: 0 },
    ])
  })

  it("reads an uncounted entry as 0 bytes whatever size it names; one with no mark is charged as recorded", () => {
    expect(
      companionsOf(
        {
          companions: [
            { key: `videos/${JOB}-engine.mp4`, sizeBytes: 7000, uncounted: true },
            { key: `videos/${JOB}-other.mp4`, sizeBytes: 5000, uncounted: "yes" },
          ],
        },
        PRIMARY,
      ),
    ).toEqual([
      { key: `videos/${JOB}-engine.mp4`, sizeBytes: 0, uncounted: true },
      { key: `videos/${JOB}-other.mp4`, sizeBytes: 5000 },
    ])
  })

  it("is empty without a key, without metadata, or without the list", () => {
    expect(companionsOf({ companions: [{ key: `videos/${JOB}-engine.mp4` }] }, null)).toEqual([])
    expect(companionsOf(null, PRIMARY)).toEqual([])
    expect(companionsOf({ name: "x" }, PRIMARY)).toEqual([])
  })
})

describe("withoutCompanions", () => {
  it("drops a caller's companions and keeps the rest", () => {
    expect(withoutCompanions({ name: "Song", companions: [{ key: "x" }] })).toEqual({ name: "Song" })
    expect(withoutCompanions(undefined)).toEqual({})
  })
})

describe("companionsForRow", () => {
  const sizeOf = async () => ({ bytes: 7000, uncounted: false })
  it("records the job's own canonical key with its size", async () => {
    await expect(
      companionsForRow(JOB, { engineVideoUrl: `https://r2.test.com/videos/${JOB}-engine.mp4` }, "video", PRIMARY, sizeOf),
    ).resolves.toEqual([{ key: `videos/${JOB}-engine.mp4`, sizeBytes: 7000 }])
  })

  it("records the same file under a delivered-resolution run's server-only key", async () => {
    await expect(
      companionsForRow(JOB, { __castSwapEngineVideoUrl: `https://r2.test.com/videos/${JOB}-engine.mp4` }, "video", PRIMARY, sizeOf),
    ).resolves.toEqual([{ key: `videos/${JOB}-engine.mp4`, sizeBytes: 7000 }])
    // Named under both keys: recorded once.
    const url = `https://r2.test.com/videos/${JOB}-engine.mp4`
    await expect(companionsForRow(JOB, { engineVideoUrl: url, __castSwapEngineVideoUrl: url }, "video", PRIMARY, sizeOf)).resolves.toEqual([
      { key: `videos/${JOB}-engine.mp4`, sizeBytes: 7000 },
    ])
  })

  it("records an uncounted file as never charged: size 0, marked, still a companion to delete", async () => {
    const uncounted = async () => ({ bytes: 0, uncounted: true })
    await expect(
      companionsForRow(JOB, { __castSwapEngineVideoUrl: `https://r2.test.com/videos/${JOB}-engine.mp4` }, "video", PRIMARY, uncounted),
    ).resolves.toEqual([{ key: `videos/${JOB}-engine.mp4`, sizeBytes: 0, uncounted: true }])
  })

  it.each([
    `videos/../videos/${JOB}-engine.mp4`,
    `videos//${JOB}-engine.mp4`,
    `videos/${JOB}-engine%2e.mp4`,
    `videos/${JOB}-engine.mp4?x=1`,
  ])("refuses to record a non-canonical key (%s)", async (key) => {
    await expect(companionsForRow(JOB, { engineVideoUrl: `https://r2.test.com/${key}` }, "video", PRIMARY, sizeOf)).resolves.toEqual([])
  })

  it("records nothing for another row type or a job without the field", async () => {
    await expect(companionsForRow(JOB, { engineVideoUrl: `https://r2.test.com/videos/${JOB}-engine.mp4` }, "image", PRIMARY, sizeOf)).resolves.toEqual([])
    await expect(companionsForRow(JOB, {}, "video", PRIMARY, sizeOf)).resolves.toEqual([])
  })
})
