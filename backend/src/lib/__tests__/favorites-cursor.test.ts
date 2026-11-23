import { describe, expect, it } from "vitest"
import {
  compareFavorites,
  decodeFavoritesCursor,
  encodeFavoritesCursor,
  keysetFilter,
  timestampMicros,
  type OrderedFavorite,
} from "../favorites-cursor.js"

const ID_A = "00000000-0000-4000-8000-00000000000a"
const ID_B = "00000000-0000-4000-8000-00000000000b"

describe("the favorites cursor", () => {
  it("round-trips the timestamp verbatim, microseconds included", () => {
    const cursor = { createdAt: "2026-11-23T10:00:00.123456+00:00", kind: "voice" as const, rowId: ID_A }
    expect(decodeFavoritesCursor(encodeFavoritesCursor(cursor))).toEqual(cursor)
  })

  it("refuses text this API did not write", () => {
    expect(decodeFavoritesCursor("not-a-cursor")).toBeNull()
    expect(decodeFavoritesCursor(Buffer.from(JSON.stringify(["x", "job", ID_A])).toString("base64url"))).toBeNull()
    expect(decodeFavoritesCursor(Buffer.from(JSON.stringify(["2026-11-23T10:00:00+00:00", "nope", ID_A])).toString("base64url"))).toBeNull()
    expect(decodeFavoritesCursor(Buffer.from(JSON.stringify(["2026-11-23T10:00:00+00:00", "job", "1,id.gt.0"])).toString("base64url"))).toBeNull()
    // A filter smuggled through the timestamp cannot pass the timestamp shape.
    expect(decodeFavoritesCursor(Buffer.from(JSON.stringify(["2026-11-23T10:00:00+00:00,id.gt.0", "job", ID_A])).toString("base64url"))).toBeNull()
  })

  it("orders timestamps exactly, below the millisecond", () => {
    expect(timestampMicros("2026-11-23T10:00:00.000002+00:00") - timestampMicros("2026-11-23T10:00:00.000001+00:00")).toBe(1n)
    expect(timestampMicros("2026-11-23T10:00:00.5+00:00")).toBe(timestampMicros("2026-11-23T10:00:00.500000+00:00"))
    expect(timestampMicros("2026-11-23T10:00:00+00:00")).toBeLessThan(timestampMicros("2026-11-23T10:00:00.1+00:00"))
    expect(timestampMicros("2026-11-23T12:00:00+02:00")).toBe(timestampMicros("2026-11-23T10:00:00+00:00"))
  })

  it("orders newest first, then by kind, then by id descending", () => {
    const t1 = "2026-11-23T10:00:00.000001+00:00"
    const t2 = "2026-11-23T10:00:00.000002+00:00"
    const rows: OrderedFavorite[] = [
      { createdAt: t1, kind: "catalog", rowId: ID_A },
      { createdAt: t1, kind: "job", rowId: ID_A },
      { createdAt: t1, kind: "job", rowId: ID_B },
      { createdAt: t2, kind: "voice", rowId: ID_A },
    ]
    expect([...rows].sort(compareFavorites)).toEqual([
      { createdAt: t2, kind: "voice", rowId: ID_A },
      { createdAt: t1, kind: "job", rowId: ID_B },
      { createdAt: t1, kind: "job", rowId: ID_A },
      { createdAt: t1, kind: "catalog", rowId: ID_A },
    ])
  })

  it("asks each kind for the rows strictly after the cursor's place", () => {
    const t = "2026-11-23T10:00:00.5+00:00"
    const cursor = { createdAt: t, kind: "voice" as const, rowId: ID_A }
    // Kinds before the cursor's have given their rows at that instant.
    expect(keysetFilter("job", cursor)).toBe(`created_at.lt.${t}`)
    // The cursor's own kind continues below its id.
    expect(keysetFilter("voice", cursor)).toBe(`created_at.lt.${t},and(created_at.eq.${t},id.lt.${ID_A})`)
    // Kinds after it have given none at that instant yet.
    expect(keysetFilter("catalog", cursor)).toBe(`created_at.lte.${t}`)
  })
})
