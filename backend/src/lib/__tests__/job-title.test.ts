import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// A job's name (migration 609): what a client's text becomes, and the one
// owner-scoped write that stores it. The route's wiring is pinned in
// routes/__tests__/job-title.test.ts.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: unknown[] }>,
  answer: { data: null as unknown, error: null as unknown },
}))
vi.mock("@/lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") return undefined
      if (prop === "maybeSingle") return async () => db.answer
      return (...args: unknown[]) => {
        db.calls.push({ method: String(prop), args })
        return proxy
      }
    },
  })
  return { supabase: { from: (table: string) => { db.calls.push({ method: "from", args: [table] }); return proxy } } }
})

import { JOB_TITLE_MAX_CHARS, normalizeJobTitle, setJobTitle } from "../job-title.js"
import { setTitleColumnPresentForTests, titleColumnPresent } from "../jobs-title-column.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const JOB = "00000000-0000-4000-8000-0000000000c1"

beforeEach(() => {
  db.calls = []
  db.answer = { data: null, error: null }
  // A database that has the column (migration 609 applied).
  setTitleColumnPresentForTests(true)
})

describe("normalizeJobTitle", () => {
  it("trims, and an empty or blank name — or null — is no name", () => {
    expect(normalizeJobTitle("  Wedding toast, final  ")).toEqual({ title: "Wedding toast, final" })
    expect(normalizeJobTitle("")).toEqual({ title: null })
    expect(normalizeJobTitle("   ")).toEqual({ title: null })
    expect(normalizeJobTitle(null)).toEqual({ title: null })
  })

  it("takes any language and symbols, up to 120 characters after trimming", () => {
    expect(normalizeJobTitle("ברכה לחתונה, סופי")).toEqual({ title: "ברכה לחתונה, סופי" })
    expect(normalizeJobTitle("Hero shot v2 🎬")).toEqual({ title: "Hero shot v2 🎬" })
    expect(normalizeJobTitle(" " + "x".repeat(JOB_TITLE_MAX_CHARS) + " ")).toEqual({ title: "x".repeat(JOB_TITLE_MAX_CHARS) })
    expect(normalizeJobTitle("x".repeat(JOB_TITLE_MAX_CHARS + 1))).toEqual({ problem: "too_long" })
  })

  it("is one line of plain text: a line break or another control character is refused", () => {
    expect(normalizeJobTitle("two\nlines")).toEqual({ problem: "not_plain_text" })
    expect(normalizeJobTitle("tab\there")).toEqual({ problem: "not_plain_text" })
    expect(normalizeJobTitle("bell\u0007")).toEqual({ problem: "not_plain_text" })
  })
})

describe("setJobTitle", () => {
  const callsOf = (method: string) => db.calls.filter((c) => c.method === method).map((c) => c.args)

  it("writes the owner's own job, scoped by owner and never a child job, and answers the name now", async () => {
    db.answer = { data: { id: JOB, title: "Hero shot v2" }, error: null }
    expect(await setJobTitle(OWNER, JOB, "Hero shot v2")).toEqual({ kind: "ok", title: "Hero shot v2" })
    expect(callsOf("from")).toEqual([["jobs"]])
    expect(callsOf("update")).toEqual([[{ title: "Hero shot v2" }]])
    expect(callsOf("eq")).toEqual([["id", JOB], ["user_id", OWNER]])
    expect(callsOf("is")).toEqual([["parent_job_id", null]])
    // The Trash is included: a deleted job is renamed too, and comes back under its name.
    expect(db.calls.some((c) => c.args.includes("deleted_at"))).toBe(false)
    expect(callsOf("select")).toEqual([["id, title"]])
  })

  it("clears with null", async () => {
    db.answer = { data: { id: JOB, title: null }, error: null }
    expect(await setJobTitle(OWNER, JOB, null)).toEqual({ kind: "ok", title: null })
    expect(callsOf("update")).toEqual([[{ title: null }]])
  })

  it("a job that is not the owner's — or no such job — is not found, never a hint which", async () => {
    db.answer = { data: null, error: null }
    expect(await setJobTitle(OWNER, JOB, "x")).toEqual({ kind: "not_found" })
  })

  it("a database failure throws (the route answers 500), never a silent 'ok'", async () => {
    db.answer = { data: null, error: new Error("db down") }
    await expect(setJobTitle(OWNER, JOB, "x")).rejects.toThrow("db down")
  })

  it("before the column reaches this database, naming is not available — nothing is written", async () => {
    setTitleColumnPresentForTests(false)
    expect(await setJobTitle(OWNER, JOB, "x")).toEqual({ kind: "not_available" })
    expect(db.calls).toEqual([])
  })

  it("a write the database refuses as an unknown column says the same, and the column is forgotten until the next probe", async () => {
    db.answer = { data: null, error: { code: "PGRST204", message: "Could not find the 'title' column" } }
    expect(await setJobTitle(OWNER, JOB, "x")).toEqual({ kind: "not_available" })
    expect(titleColumnPresent()).toBe(false)
  })
})
