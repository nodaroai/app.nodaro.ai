/**
 * A text[] filter value (lib/postgrest-array.ts): every element quoted, a
 * quote or a backslash in one escaped, so a comma never splits an element
 * and a brace never breaks the filter. Read back by the in-memory store,
 * which parses an array literal as Postgres does.
 */
import { describe, it, expect } from "vitest"
import { postgresTextArray } from "../postgrest-array.js"
import { memorySupabase } from "../../test/memory-tables.js"

describe("postgresTextArray", () => {
  it("quotes every element and escapes quotes and backslashes", () => {
    expect(postgresTextArray(["a", "b,c"])).toBe('{"a","b,c"}')
    expect(postgresTextArray(['d"e', String.raw`f\g`])).toBe(String.raw`{"d\"e","f\\g"}`)
    expect(postgresTextArray([])).toBe("{}")
  })

  it("an element with a comma, a quote, a brace or a backslash matches itself, whole", async () => {
    const odd = ["uploads/a,b.mp4", 'say "hi".mp4', "set {1}.mp4", String.raw`back\slash.mp4`]
    const db = { tables: { t: odd.map((key, i) => ({ id: String(i), keys: [key] })).concat([{ id: "split", keys: ["uploads/a"] }]) } }
    for (const [i, key] of odd.entries()) {
      const { data } = await (memorySupabase(db).from("t") as unknown as { select: (c: string) => { overlaps: (c: string, v: string) => Promise<{ data: Array<{ id: string }> }> } })
        .select("id")
        .overlaps("keys", postgresTextArray([key]))
      expect(data.map((r) => r.id), key).toEqual([String(i)])
    }
  })
})
