/**
 * The in-memory query chain (test/memory-tables.ts) answers as PostgREST and
 * Postgres do where tests lean on it: NULL compares to nothing, NULLs sort
 * last ascending and first descending, `maybeSingle` over several rows and
 * `single` over any count but one are PGRST116, a select projects its
 * columns, an array literal's quoted elements keep their commas, `not`
 * supports only what it can run, a guard's refusal writes nothing, and a
 * table the database does not have yet answers 42P01 to a read and a write.
 */
import { describe, it, expect } from "vitest"
import { memorySupabase, type MemoryDb } from "../memory-tables.js"

type Answer = { data: unknown; error: { code?: string; message: string } | null }
type Chain = Record<string, (...args: unknown[]) => Chain> & PromiseLike<Answer> & { maybeSingle: () => Promise<Answer>; single: () => Promise<Answer> }

const fresh = (): MemoryDb => ({
  tables: {
    t: [
      { id: "a", n: 2, d: "2026-12-09", tags: ["x,y", "z"], s: "open" },
      { id: "b", n: null, d: null, tags: ["y"], s: "closed" },
      { id: "c", n: 1, d: "2026-12-01", tags: [], s: null },
    ],
  },
})
const from = (db: MemoryDb) => memorySupabase(db).from("t") as unknown as Chain
const ids = (answer: Answer) => ((answer.data ?? []) as Array<{ id: string }>).map((r) => r.id)

describe("memory-tables", () => {
  it("NULL compares to nothing: eq, neq, in, lte and gte all leave a NULL row out", async () => {
    const db = fresh()
    expect(ids(await from(db).select("id").neq("s", "open"))).toEqual(["b"])
    expect(ids(await from(db).select("id").lte("d", "2026-12-31"))).toEqual(["a", "c"])
    expect(ids(await from(db).select("id").gte("n", 0))).toEqual(["a", "c"])
    expect(ids(await from(db).select("id").in("s", ["open", "closed"]))).toEqual(["a", "b"])
    expect(ids(await from(db).select("id").is("s", null))).toEqual(["c"])
    expect(ids(await from(db).select("id").not("s", "is", null))).toEqual(["a", "b"])
    expect(ids(await from(db).select("id").not("s", "in", "(closed)"))).toEqual(["a"])
  })

  it("NULLs sort last ascending and first descending", async () => {
    const db = fresh()
    expect(ids(await from(db).select("id").order("n", { ascending: true }))).toEqual(["c", "a", "b"])
    expect(ids(await from(db).select("id").order("n", { ascending: false }))).toEqual(["b", "a", "c"])
  })

  it("maybeSingle over several rows, and single over none, are PGRST116", async () => {
    const db = fresh()
    expect((await from(db).select("id").not("s", "is", null).maybeSingle()).error).toMatchObject({ code: "PGRST116" })
    expect(await from(db).select("id").eq("id", "nope").maybeSingle()).toEqual({ data: null, error: null })
    expect((await from(db).select("id").eq("id", "nope").single()).error).toMatchObject({ code: "PGRST116" })
  })

  it("a select projects its columns: what was not selected reads undefined, a missing one null", async () => {
    const { data } = await from(fresh()).select("id, missing").eq("id", "a").maybeSingle()
    expect(data).toEqual({ id: "a", missing: null })
    expect(() => from(fresh()).select("id, other(name)")).toThrow(/not supported/)
  })

  it("overlaps reads a quoted array literal's elements whole, commas and all; an array is sent as postgrest-js sends it", async () => {
    const db = fresh()
    expect(ids(await from(db).select("id").overlaps("tags", '{"x,y"}'))).toEqual(["a"])
    expect(ids(await from(db).select("id").overlaps("tags", ["z"]))).toEqual(["a"])
    expect(ids(await from(db).select("id").overlaps("tags", "{x}"))).toEqual([])
    // ["x,y"] goes out as {x,y}: two elements, so the row tagged "y" matches and the one tagged "x,y" does not.
    expect(ids(await from(db).select("id").overlaps("tags", ["x,y"]))).toEqual(["b"])
  })

  it("a not it cannot run throws, rather than letting every row through", () => {
    expect(() => from(fresh()).select("id").not("n", "gt", 1)).toThrow(/not supported/)
  })

  it("a guard's refusal writes nothing", async () => {
    const db: MemoryDb = { ...fresh(), guards: { t: ({ kind, row }) => (kind === "update" && row.s === "closed" ? { code: "55026", message: "no" } : null) } }
    const answer = await from(db).update({ s: "closed" }).eq("id", "a")
    expect(answer.error).toMatchObject({ code: "55026" })
    expect(db.tables.t!.find((r) => r.id === "a")!.s).toBe("open")
  })

  it("a table the database does not have yet answers 42P01 to a read, a count and a write, and keeps nothing", async () => {
    const db: MemoryDb = { ...fresh(), missingTables: new Set(["t"]) }
    expect((await from(db).select("id")).error).toMatchObject({ code: "42P01" })
    expect((await from(db).select("id", { count: "exact", head: true }).eq("id", "a")).error).toMatchObject({ code: "42P01" })
    expect((await from(db).select("id").eq("id", "a").maybeSingle()).error).toMatchObject({ code: "42P01" })
    expect((await from(db).insert({ id: "d" }).select("id").single()).error).toMatchObject({ code: "42P01" })
    expect((await from(db).update({ s: "x" }).eq("id", "a")).error).toMatchObject({ code: "42P01" })
    expect(db.tables.t!.map((r) => r.id)).toEqual(["a", "b", "c"])
    expect(db.tables.t!.find((r) => r.id === "a")!.s).toBe("open")
  })
})
