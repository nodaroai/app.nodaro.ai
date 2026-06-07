import { describe, it, expect } from "vitest"
import { decodeCommunityCursor, encodeCommunityCursor, type CommunityCursor } from "../community-cursor.js"

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64")
const VALID: CommunityCursor = {
  count: 42,
  createdAt: "2026-06-07T17:47:21.123456+00:00",
  id: "11111111-2222-3333-4444-555555555555",
}

describe("decodeCommunityCursor", () => {
  it("round-trips a server-encoded cursor", () => {
    expect(decodeCommunityCursor(encodeCommunityCursor(VALID))).toEqual(VALID)
  })
  it("accepts a Z-suffixed timestamp and zero count", () => {
    const c = { count: 0, createdAt: "2026-06-07T17:47:21Z", id: VALID.id }
    expect(decodeCommunityCursor(b64(c))).toEqual(c)
  })

  it("returns null for absent / empty input", () => {
    expect(decodeCommunityCursor(undefined)).toBeNull()
    expect(decodeCommunityCursor(null)).toBeNull()
    expect(decodeCommunityCursor("")).toBeNull()
  })
  it("returns null for non-base64 / non-JSON garbage", () => {
    expect(decodeCommunityCursor("!!!not base64!!!")).toBeNull()
    expect(decodeCommunityCursor(Buffer.from("not json", "utf8").toString("base64"))).toBeNull()
  })
  it("returns null for non-object payloads", () => {
    expect(decodeCommunityCursor(b64(123))).toBeNull()
    expect(decodeCommunityCursor(b64("str"))).toBeNull()
    expect(decodeCommunityCursor(b64([1, 2, 3]))).toBeNull()
    expect(decodeCommunityCursor(b64(null))).toBeNull()
  })

  it("returns null when any field is missing", () => {
    expect(decodeCommunityCursor(b64({ createdAt: VALID.createdAt, id: VALID.id }))).toBeNull()
    expect(decodeCommunityCursor(b64({ count: 1, id: VALID.id }))).toBeNull()
    expect(decodeCommunityCursor(b64({ count: 1, createdAt: VALID.createdAt }))).toBeNull()
  })
  it("returns null for an invalid count (float / negative / string)", () => {
    expect(decodeCommunityCursor(b64({ ...VALID, count: 1.5 }))).toBeNull()
    expect(decodeCommunityCursor(b64({ ...VALID, count: -1 }))).toBeNull()
    expect(decodeCommunityCursor(b64({ ...VALID, count: "5" }))).toBeNull()
  })
  it("returns null for a non-UUID id", () => {
    expect(decodeCommunityCursor(b64({ ...VALID, id: "not-a-uuid" }))).toBeNull()
  })

  // The core of the security fix: a cursor crafted to inject PostgREST filter
  // syntax must be rejected, not interpolated into the .or() clause.
  it("rejects filter-injection payloads in createdAt", () => {
    expect(decodeCommunityCursor(b64({ ...VALID, createdAt: "2026-01-01T00:00:00,clone_count.gt.0" }))).toBeNull()
    expect(decodeCommunityCursor(b64({ ...VALID, createdAt: "2026-01-01T00:00:00))" }))).toBeNull()
    expect(decodeCommunityCursor(b64({ ...VALID, createdAt: "*" }))).toBeNull()
  })
  it("rejects filter-injection payloads in id", () => {
    expect(decodeCommunityCursor(b64({ ...VALID, id: `${VALID.id},clone_count.gt.0` }))).toBeNull()
    expect(decodeCommunityCursor(b64({ ...VALID, id: "*" }))).toBeNull()
  })
})
