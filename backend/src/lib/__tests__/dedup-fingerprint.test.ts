import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null })
  const limitMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
  const orderMock = vi.fn(() => ({ limit: limitMock }))
  const gteMock = vi.fn(() => ({ order: orderMock }))
  const eq2Mock = vi.fn(() => ({ gte: gteMock }))
  const eq1Mock = vi.fn(() => ({ eq: eq2Mock }))
  const selectMock = vi.fn(() => ({ eq: eq1Mock }))
  const fromMock = vi.fn(() => ({ select: selectMock }))
  return { maybeSingleMock, fromMock, eq1Mock, eq2Mock, gteMock }
})

vi.mock("../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))

import { computeFingerprint, findRecentMatchingJob, DEDUP_TTL_MS } from "../dedup-fingerprint.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.maybeSingleMock.mockResolvedValue({ data: null, error: null })
})

describe("computeFingerprint", () => {
  it("is deterministic for identical inputs", () => {
    const a = computeFingerprint("/v1/x", { foo: "bar", n: 1 })
    const b = computeFingerprint("/v1/x", { foo: "bar", n: 1 })
    expect(a).toBe(b)
  })

  it("is order-invariant for object keys (stable stringification)", () => {
    const a = computeFingerprint("/v1/x", { foo: "bar", n: 1 })
    const b = computeFingerprint("/v1/x", { n: 1, foo: "bar" })
    expect(a).toBe(b)
  })

  it("recursively sorts nested object keys", () => {
    const a = computeFingerprint("/v1/x", { outer: { a: 1, b: 2 } })
    const b = computeFingerprint("/v1/x", { outer: { b: 2, a: 1 } })
    expect(a).toBe(b)
  })

  it("differs for different routeKeys (even with same body)", () => {
    const a = computeFingerprint("/v1/generate-image", { p: "cat" })
    const b = computeFingerprint("/v1/image-to-video", { p: "cat" })
    expect(a).not.toBe(b)
  })

  it("differs for different bodies", () => {
    const a = computeFingerprint("/v1/x", { p: "cat" })
    const b = computeFingerprint("/v1/x", { p: "dog" })
    expect(a).not.toBe(b)
  })

  it("preserves array order (different orders → different hashes)", () => {
    const a = computeFingerprint("/v1/x", { refs: ["url1", "url2"] })
    const b = computeFingerprint("/v1/x", { refs: ["url2", "url1"] })
    expect(a).not.toBe(b)
  })

  it("produces a 64-char hex digest (SHA-256)", () => {
    const fp = computeFingerprint("/v1/x", { p: "cat" })
    expect(fp).toMatch(/^[a-f0-9]{64}$/)
  })

  it("handles undefined fields in body", () => {
    // JSON.stringify drops undefined; our stable stringifier maps to null.
    // Either way, identical bodies must collide.
    const a = computeFingerprint("/v1/x", { p: "cat", optional: undefined })
    const b = computeFingerprint("/v1/x", { p: "cat", optional: undefined })
    expect(a).toBe(b)
  })
})

describe("findRecentMatchingJob", () => {
  it("returns null when supabase returns no match", async () => {
    mocks.maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
    const result = await findRecentMatchingJob("user-1", "fp-abc")
    expect(result).toBeNull()
  })

  it("returns the matching job id when found", async () => {
    mocks.maybeSingleMock.mockResolvedValueOnce({ data: { id: "job-1" }, error: null })
    const result = await findRecentMatchingJob("user-1", "fp-abc")
    expect(result).toEqual({ id: "job-1" })
  })

  it("filters by user_id and fingerprint", async () => {
    await findRecentMatchingJob("user-42", "fp-xyz")
    expect(mocks.eq1Mock).toHaveBeenCalledWith("user_id", "user-42")
    expect(mocks.eq2Mock).toHaveBeenCalledWith("input_fingerprint", "fp-xyz")
  })

  it("filters by created_at within DEDUP_TTL_MS window", async () => {
    const before = Date.now()
    await findRecentMatchingJob("user-1", "fp-abc")
    const after = Date.now()

    const gteCall = mocks.gteMock.mock.calls[0]
    expect(gteCall?.[0]).toBe("created_at")
    const sinceIso = gteCall?.[1] as string
    const sinceMs = new Date(sinceIso).getTime()
    expect(sinceMs).toBeGreaterThanOrEqual(before - DEDUP_TTL_MS - 1)
    expect(sinceMs).toBeLessThanOrEqual(after - DEDUP_TTL_MS + 1)
  })

  it("returns null on supabase error (best-effort dedup never throws)", async () => {
    mocks.maybeSingleMock.mockRejectedValueOnce(new Error("DB down"))
    const result = await findRecentMatchingJob("user-1", "fp-abc")
    expect(result).toBeNull()
  })
})

describe("DEDUP_TTL_MS", () => {
  it("is 10 seconds (matches design decision)", () => {
    expect(DEDUP_TTL_MS).toBe(10_000)
  })
})
