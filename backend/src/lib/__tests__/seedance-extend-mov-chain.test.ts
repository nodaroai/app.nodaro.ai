import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Finding the PREVIOUS extension's raw mov, so a chained extend references it
// un-transcoded (the whole point of asking Seedance 2.5 for mov at all).
//
// Every failure mode here must be SILENT: a missing job, a foreign URL, a job
// belonging to someone else, an mp4 raw extension, a KIE temp URL — all fall
// back to the 2s tail, which is the transport that works today.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))

vi.mock("@/lib/config.js", () => ({
  config: { R2_PUBLIC_URL: "https://r2.test.com", R2_BUCKET_NAME: "b" },
  hasCredits: () => true,
}))

import { findChainedMovReference, isMovUrl } from "@/lib/seedance-extend-mov-chain.js"

const JOB_ID = "11111111-2222-3333-4444-555555555555"
const SOURCE = `https://r2.test.com/videos/${JOB_ID}.mp4`
const OUR_MOV = "https://r2.test.com/videos/abc-raw.mov"

function stubJob(outputData: unknown) {
  mocks.maybeSingle.mockResolvedValue({ data: outputData === null ? null : { output_data: outputData }, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.eq.mockImplementation(() => ({ eq: mocks.eq, maybeSingle: mocks.maybeSingle }))
  mocks.select.mockImplementation(() => ({ eq: mocks.eq }))
  mocks.from.mockImplementation(() => ({ select: mocks.select }))
  stubJob({})
})

describe("isMovUrl", () => {
  it("is decided by the PATH, not the query string", () => {
    expect(isMovUrl("https://x.example/a.mov")).toBe(true)
    expect(isMovUrl("https://x.example/a.mov?token=abc&x=.mp4")).toBe(true)
    expect(isMovUrl("https://x.example/a.MOV")).toBe(true)
    expect(isMovUrl("https://x.example/a.mp4")).toBe(false)
    expect(isMovUrl("https://x.example/a.mp4?f=.mov")).toBe(false)
    expect(isMovUrl("not a url")).toBe(false)
    expect(isMovUrl("")).toBe(false)
  })
})

describe("findChainedMovReference", () => {
  it("returns the prior job's raw mov when it is one of OUR durable objects", async () => {
    stubJob({ rawExtensionUrl: OUR_MOV })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBe(OUR_MOV)
    expect(mocks.from).toHaveBeenCalledWith("jobs")
    // Scoped to the caller: never chain off someone else's job row.
    expect(mocks.eq).toHaveBeenCalledWith("id", JOB_ID)
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-1")
  })

  it("a foreign source URL is not looked up at all", async () => {
    await expect(findChainedMovReference("https://cdn.elsewhere.com/x.mp4", "user-1")).resolves.toBeUndefined()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("an R2 URL that is not a job-keyed video is not looked up", async () => {
    await expect(findChainedMovReference("https://r2.test.com/uploads/x.mp4", "user-1")).resolves.toBeUndefined()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("no such job ⇒ undefined", async () => {
    stubJob(null)
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })

  it("an mp4 raw extension ⇒ undefined (nothing to gain)", async () => {
    stubJob({ rawExtensionUrl: "https://r2.test.com/videos/abc-raw.mp4" })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })

  it("a KIE temp URL ⇒ undefined — it will have expired", async () => {
    stubJob({ rawExtensionUrl: "https://kie.example.com/extension.mov" })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })

  it("a non-string / absent rawExtensionUrl ⇒ undefined", async () => {
    stubJob({ rawExtensionUrl: 42 })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
    stubJob({ thumbnailUrl: "x" })
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })

  it("no user id ⇒ undefined, and no unscoped query is ever issued", async () => {
    stubJob({ rawExtensionUrl: OUR_MOV })
    await expect(findChainedMovReference(SOURCE, undefined)).resolves.toBeUndefined()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("a DB error is swallowed — the tail path still works", async () => {
    mocks.maybeSingle.mockRejectedValue(new Error("connection reset"))
    await expect(findChainedMovReference(SOURCE, "user-1")).resolves.toBeUndefined()
  })
})
