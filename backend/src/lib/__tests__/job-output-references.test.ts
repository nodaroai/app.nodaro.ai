import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Which job outputs name a url, asked of the database through migration 495's
 * index (decided 2026-10-08): the blanking of a deleted file's link in EVERY
 * job output that names it. (The raw-copy hold-back lookup was dropped in
 * round 12: a later extend reads its own copy.)
 */

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }))
vi.mock("../supabase.js", () => ({ supabase: { rpc: mockRpc } }))

import * as references from "../job-output-references.js"
const { blankUrlsInEveryJobOutput, jobOutputBlankingAvailable, markJobOutputsCleaned, urlsLinkedByJobsSince } = references

const u = (i: number) => `https://cdn.test/videos/${i}.mp4`

beforeEach(() => {
  mockRpc.mockReset()
})

describe("the hold-back lookup is gone (decided 2026-10-08, round 12)", () => {
  it("exports no url-still-referenced lookup (the asset retry guard asks only about jobs made since a failure)", () => {
    expect(Object.keys(references).sort()).toEqual([
      "blankUrlsInEveryJobOutput",
      "jobOutputBlankingAvailable",
      "markJobOutputsCleaned",
      "urlsLinkedByJobsSince",
    ])
  })
})

describe("blankUrlsInEveryJobOutput", () => {
  it("asks nothing for no urls", async () => {
    expect(await blankUrlsInEveryJobOutput([])).toBe(0)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("repeats a chunk until fewer rows than the page change, and sums them", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 200, error: null })
      .mockResolvedValueOnce({ data: 200, error: null })
      .mockResolvedValueOnce({ data: 7, error: null })
    const changed = await blankUrlsInEveryJobOutput([u(1)])
    expect(changed).toBe(407)
    expect(mockRpc).toHaveBeenCalledTimes(3)
    for (const call of mockRpc.mock.calls) {
      expect(call).toEqual(["blank_job_output_urls", { p_urls: [u(1)], p_limit: 200 }])
    }
  })

  it("covers every url, in chunks", async () => {
    mockRpc.mockResolvedValue({ data: 0, error: null })
    const urls = Array.from({ length: 150 }, (_, i) => u(i))
    await blankUrlsInEveryJobOutput(urls)
    const asked = mockRpc.mock.calls.flatMap((c) => (c[1] as { p_urls: string[] }).p_urls)
    expect(asked.sort()).toEqual([...urls].sort())
  })

  it("throws when a call fails (the reaper then leaves its jobs unmarked, and the next run retries)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } })
    await expect(blankUrlsInEveryJobOutput([u(1)])).rejects.toThrow(/boom/)
  })

  it("throws rather than loop forever when a page keeps coming back full", async () => {
    mockRpc.mockResolvedValue({ data: 200, error: null })
    await expect(blankUrlsInEveryJobOutput([u(1)])).rejects.toThrow(/still/)
  })
})

describe("jobOutputBlankingAvailable (staging runs dev code before main applies 495)", () => {
  it("asks the database with an empty probe that changes nothing", async () => {
    mockRpc.mockResolvedValue({ data: 0, error: null })
    expect(await jobOutputBlankingAvailable()).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith("blank_job_output_urls", { p_urls: [], p_limit: 1 })
  })

  it.each(["PGRST202", "42883"])("answers false when the function is not on this database (%s)", async (code) => {
    mockRpc.mockResolvedValue({ data: null, error: { code, message: "missing" } })
    expect(await jobOutputBlankingAvailable()).toBe(false)
  })

  it("throws on any other failure", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } })
    await expect(jobOutputBlankingAvailable()).rejects.toThrow(/timeout/)
  })
})

describe("markJobOutputsCleaned", () => {
  it("marks the batch in the database, from each row's current output, with the deleted links", async () => {
    mockRpc.mockResolvedValue({ data: 2, error: null })
    expect(await markJobOutputsCleaned(["a", "b"], new Set([u(1)]))).toBe(2)
    expect(mockRpc).toHaveBeenCalledWith("mark_job_outputs_cleaned", { p_ids: ["a", "b"], p_urls: [u(1)] })
  })

  it("asks nothing for no jobs", async () => {
    expect(await markJobOutputsCleaned([], new Set([u(1)]))).toBe(0)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("throws when the call fails, so the reaper stops before its next batch", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } })
    await expect(markJobOutputsCleaned(["a"], new Set())).rejects.toThrow(/boom/)
  })
})

describe("urlsLinkedByJobsSince (the failed asset delete's retry guard, decided 2026-10-09)", () => {
  const t = (i: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, i))

  it("asks the database, url by url, which a job created at or after its moment links", async () => {
    mockRpc.mockResolvedValue({ data: [u(2)], error: null })
    const linked = await urlsLinkedByJobsSince([{ url: u(1), since: t(1) }, { url: u(2), since: t(2) }])
    expect(linked).toEqual(new Set([u(2)]))
    expect(mockRpc).toHaveBeenCalledWith("urls_linked_by_jobs_since", {
      p_urls: [u(1), u(2)],
      p_since: [t(1).toISOString(), t(2).toISOString()],
    })
  })

  it("asks nothing for no urls", async () => {
    expect(await urlsLinkedByJobsSince([])).toEqual(new Set())
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("asks in chunks, and gathers every chunk's answer", async () => {
    const links = Array.from({ length: 150 }, (_, i) => ({ url: u(i), since: t(0) }))
    mockRpc.mockResolvedValueOnce({ data: [u(3)], error: null }).mockResolvedValueOnce({ data: [u(120)], error: null })
    expect(await urlsLinkedByJobsSince(links)).toEqual(new Set([u(3), u(120)]))
    expect(mockRpc).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ code: "57014", message: "timeout" }, /timeout/],
    [{ code: "PGRST202", message: "missing" }, /missing/],
  ])("throws on a failed call, the function missing included, so the retry keeps the file (%o)", async (error, re) => {
    mockRpc.mockResolvedValue({ data: null, error })
    await expect(urlsLinkedByJobsSince([{ url: u(1), since: t(1) }])).rejects.toThrow(re)
  })
})
