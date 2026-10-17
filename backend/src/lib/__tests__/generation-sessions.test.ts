import { describe, it, expect } from "vitest"
import { afterKeyset, decodeCursor, encodeCursor, previewUrlOf, withCover } from "../generation-sessions.js"

const ID = "00000000-0000-4000-8000-000000000020"

describe("session cursors", () => {
  it("round-trips a keyset", () => {
    const k = { at: "2026-10-15T10:00:00.123456+00:00", id: ID }
    expect(decodeCursor(encodeCursor(k))).toEqual(k)
  })

  it("refuses anything this server did not issue", () => {
    expect(decodeCursor("nope")).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify(["not a date", ID])).toString("base64url"))).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify(["2026-10-15T10:00:00Z", "x),or(id"])).toString("base64url"))).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify({ at: "2026-10-15T10:00:00Z" })).toString("base64url"))).toBeNull()
    // Date.parse accepts parenthesised text; it would become or() filter syntax.
    expect(decodeCursor(Buffer.from(JSON.stringify(["2024 (\",and(user_id.neq.\"x\"))", ID])).toString("base64url"))).toBeNull()
  })

  it("pages strictly after the keyset, breaking timestamp ties by id", () => {
    expect(afterKeyset("added_at", "job_id", { at: "2026-10-15T10:00:00+00:00", id: ID })).toBe(
      `added_at.lt."2026-10-15T10:00:00+00:00",and(added_at.eq."2026-10-15T10:00:00+00:00",job_id.lt."${ID}")`,
    )
  })
})

describe("previewUrlOf", () => {
  it("prefers a thumbnail, then the image, then the first of many", () => {
    expect(previewUrlOf({ thumbnailUrl: "t", imageUrl: "i" })).toBe("t")
    expect(previewUrlOf({ imageUrl: "i" })).toBe("i")
    expect(previewUrlOf({ imageUrls: ["a", "b"] })).toBe("a")
  })

  it("returns nothing for output with no image link", () => {
    expect(previewUrlOf({ videoUrl: "v" })).toBeNull()
    expect(previewUrlOf(null)).toBeNull()
    expect(previewUrlOf("x")).toBeNull()
    expect(previewUrlOf([{ imageUrl: "i" }])).toBeNull()
  })
})

describe("withCover", () => {
  const A = { jobId: "a", url: "https://cdn/a.png" }
  const B = { jobId: "b", url: "https://cdn/b.png" }
  const C = { jobId: "c", url: "https://cdn/c.png" }
  const D = { jobId: "d", url: "https://cdn/d.png" }

  it("leads with the cover and drops it from the automatic list", () => {
    expect(withCover("https://cdn/b.png", "b", [A, B, C, D])).toEqual(["https://cdn/b.png", A.url, C.url, D.url])
  })

  it("keeps at most four", () => {
    expect(withCover("https://cdn/x.png", "x", [A, B, C, D])).toEqual(["https://cdn/x.png", A.url, B.url, C.url])
  })

  it("is the automatic list when there is no cover image", () => {
    expect(withCover(null, "b", [A, B])).toEqual([A.url, B.url])
  })
})
