import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Every query answers the next queued answer, and every call on the chain is
 * recorded, so a test reads both what was asked and what was made of it.
 */
const db = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: unknown[] }>,
  answers: [] as Array<{ data: unknown; error: unknown }>,
}))

vi.mock("@/lib/supabase.js", () => {
  const next = () => db.answers.shift() ?? { data: null, error: null }
  const proxy: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") return (resolve: (value: unknown) => void) => resolve(next())
      if (prop === "maybeSingle") return async () => next()
      return (...args: unknown[]) => {
        db.calls.push({ method: String(prop), args })
        return proxy
      }
    },
  })
  return {
    supabase: {
      from: (table: string) => {
        db.calls.push({ method: "from", args: [table] })
        return proxy
      },
    },
  }
})

import { dubFamilyIdOf, loadDubFamily } from "../dubbing-job-store.js"

const OWNER = "00000000-0000-4000-8000-0000000000aa"
const FIRST = "00000000-0000-4000-8000-000000000001"
const ADDED = "00000000-0000-4000-8000-000000000002"
const OTHER = "00000000-0000-4000-8000-000000000003"
/** A job id with letters in it, so it is written differently in capitals. */
const LETTERED = "0000abcd-0000-4000-8000-00000000000f"

function row(id: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id, status: "completed", provider_task_id: `task-${id.slice(-1)}`, input_data: input, created_at: "2026-11-01T10:00:00Z", ...extra }
}

const dub = (extra: Record<string, unknown> = {}) => ({ type: "dubbing", targetLanguage: "es", ...extra })

/** The recorded calls, one list per query. */
function queries(): Array<Array<{ method: string; args: unknown[] }>> {
  const out: Array<Array<{ method: string; args: unknown[] }>> = []
  for (const call of db.calls) {
    if (call.method === "from") out.push([])
    out[out.length - 1]?.push(call)
  }
  return out
}

const has = (query: Array<{ method: string; args: unknown[] }>, method: string, ...args: unknown[]): boolean =>
  query.some((call) => call.method === method && JSON.stringify(call.args) === JSON.stringify(args))

/** The two questions that ask whether a job of the dub is restricted, answered "none is". */
const noneRestricted = () => [
  { data: [], error: null },
  { data: [], error: null },
]

beforeEach(() => {
  db.calls.length = 0
  db.answers.length = 0
})

describe("loadDubFamily", () => {
  it("reads the job as its owner's live work only", async () => {
    db.answers.push({ data: row(FIRST, dub()), error: null }, ...noneRestricted(), { data: [], error: null })

    await loadDubFamily(OWNER, FIRST)

    const [byId, , , members] = queries()
    expect(has(byId!, "from", "jobs")).toBe(true)
    expect(has(byId!, "eq", "id", FIRST)).toBe(true)
    expect(has(byId!, "eq", "user_id", OWNER)).toBe(true)
    expect(has(byId!, "is", "parent_job_id", null)).toBe(true)
    expect(has(byId!, "is", "deleted_at", null)).toBe(true)
    expect(has(byId!, "is", "restricted_at", null)).toBe(true)
    expect(has(members!, "eq", "user_id", OWNER)).toBe(true)
    expect(has(members!, "ilike", "input_data->>sourceDubJobId", FIRST)).toBe(true)
    expect(has(members!, "is", "parent_job_id", null)).toBe(true)
    expect(has(members!, "is", "deleted_at", null)).toBe(true)
    expect(has(members!, "is", "restricted_at", null)).toBe(true)
  })

  it("answers not_found for a job that is missing, and never asks for an id that is not one", async () => {
    expect(await loadDubFamily(OWNER, FIRST)).toEqual({ kind: "not_found" })
    expect(queries()).toHaveLength(1)

    db.calls.length = 0
    expect(await loadDubFamily(OWNER, "not-a-job")).toEqual({ kind: "not_found" })
    expect(queries()).toHaveLength(0)
  })

  it("answers not_a_dubbing_job for another kind of job", async () => {
    db.answers.push({ data: row(FIRST, { type: "text-to-speech" }), error: null })

    expect(await loadDubFamily(OWNER, FIRST)).toEqual({ kind: "not_a_dubbing_job" })
  })

  it("makes the first job the anchor and lists the added languages oldest first", async () => {
    const newer = row(OTHER, dub({ sourceDubJobId: FIRST, targetLanguage: "fr" }), { created_at: "2026-11-03T10:00:00Z" })
    const older = row(ADDED, dub({ sourceDubJobId: FIRST, targetLanguage: "de" }), { created_at: "2026-11-02T10:00:00Z" })
    db.answers.push({ data: row(FIRST, dub()), error: null }, ...noneRestricted(), { data: [newer, older], error: null })

    const load = await loadDubFamily(OWNER, FIRST)

    expect(load.kind).toBe("ok")
    if (load.kind !== "ok") return
    expect(load.family.familyId).toBe(FIRST)
    expect(load.family.anchor.id).toBe(FIRST)
    expect(load.family.members.map((job) => job.id)).toEqual([ADDED, OTHER])
    const [, , , members] = queries()
    expect(has(members!, "gte", "created_at", "2026-11-01T10:00:00Z")).toBe(true)
    expect(has(members!, "order", "created_at", { ascending: false })).toBe(true)
  })

  it("opens the whole family from an added language", async () => {
    const added = row(ADDED, dub({ sourceDubJobId: FIRST, targetLanguage: "de" }))
    db.answers.push(
      { data: added, error: null },
      ...noneRestricted(),
      { data: row(FIRST, dub()), error: null },
      { data: [added], error: null },
    )

    const load = await loadDubFamily(OWNER, ADDED)

    expect(load.kind).toBe("ok")
    if (load.kind !== "ok") return
    expect(load.family.familyId).toBe(FIRST)
    expect(load.family.anchor.id).toBe(FIRST)
    expect(load.family.members.map((job) => job.id)).toEqual([ADDED])
    // The first job is read as live work too, like the job asked for.
    const first = queries()[3]!
    expect(has(first, "eq", "id", FIRST)).toBe(true)
    expect(has(first, "is", "deleted_at", null)).toBe(true)
    expect(has(first, "is", "restricted_at", null)).toBe(true)
  })

  it("a job that names the dub in capitals is a job of the dub", async () => {
    const added = row(ADDED, dub({ sourceDubJobId: LETTERED.toUpperCase(), targetLanguage: "de" }))
    db.answers.push(
      { data: added, error: null },
      ...noneRestricted(),
      { data: row(LETTERED, dub()), error: null },
      { data: [added], error: null },
    )

    const load = await loadDubFamily(OWNER, ADDED)

    expect(load.kind).toBe("ok")
    if (load.kind !== "ok") return
    expect(load.family.familyId).toBe(LETTERED)
    expect(load.family.anchor.id).toBe(LETTERED)
    expect(load.family.members.map((job) => job.id)).toEqual([ADDED])
    // The name the job holds is in capitals and the id asked for is not, so both
    // questions about the jobs that name the dub match a name whatever its case.
    const [, , restricted, first, members] = queries()
    expect(has(first!, "eq", "id", LETTERED)).toBe(true)
    expect(has(restricted!, "ilike", "input_data->>sourceDubJobId", LETTERED)).toBe(true)
    expect(has(members!, "ilike", "input_data->>sourceDubJobId", LETTERED)).toBe(true)
  })

  it("reads through the job asked for when the first job is gone, and keeps the family id", async () => {
    const added = row(ADDED, dub({ sourceDubJobId: FIRST, targetLanguage: "de" }))
    const sibling = row(OTHER, dub({ sourceDubJobId: FIRST, targetLanguage: "fr" }))
    db.answers.push(
      { data: added, error: null },
      ...noneRestricted(),
      { data: null, error: null },
      { data: [sibling, added], error: null },
    )

    const load = await loadDubFamily(OWNER, ADDED)

    expect(load.kind).toBe("ok")
    if (load.kind !== "ok") return
    expect(load.family.familyId).toBe(FIRST)
    expect(load.family.anchor.id).toBe(ADDED)
    expect(load.family.members.map((job) => job.id)).toEqual([OTHER])
    const members = queries()[4]!
    expect(has(members, "order", "created_at", { ascending: false })).toBe(true)
    // With no first job there is no date to bound the list by.
    expect(members.some((call) => call.method === "gte")).toBe(false)
  })

  it("leaves out a job that names the family but is not a dub", async () => {
    const stray = row(OTHER, { type: "text-to-speech", sourceDubJobId: FIRST })
    db.answers.push({ data: row(FIRST, dub()), error: null }, ...noneRestricted(), { data: [stray], error: null })

    const load = await loadDubFamily(OWNER, FIRST)

    expect(load.kind === "ok" && load.family.members).toEqual([])
  })

  it("is not readable when the job it began with is restricted", async () => {
    const added = row(ADDED, dub({ sourceDubJobId: FIRST, targetLanguage: "de" }))
    db.answers.push({ data: added, error: null }, { data: [{ id: FIRST }], error: null }, { data: [], error: null })

    expect(await loadDubFamily(OWNER, ADDED)).toEqual({ kind: "not_found" })
    // It is the dub that is asked about, not the job the caller named, and a closed dub is read no further.
    const [, first, named, ...more] = queries()
    expect(has(first!, "eq", "id", FIRST)).toBe(true)
    expect(has(named!, "ilike", "input_data->>sourceDubJobId", FIRST)).toBe(true)
    expect(more).toEqual([])
  })

  it("is not readable when a language added to it is restricted", async () => {
    db.answers.push({ data: row(FIRST, dub()), error: null }, { data: [], error: null }, { data: [{ id: ADDED }], error: null })

    expect(await loadDubFamily(OWNER, FIRST)).toEqual({ kind: "not_found" })
    expect(queries()).toHaveLength(3)
  })

  it("asks of every job of the dub whether it is restricted, the Trash and hidden steps included", async () => {
    db.answers.push({ data: row(FIRST, dub()), error: null }, ...noneRestricted(), { data: [], error: null })

    await loadDubFamily(OWNER, FIRST)

    const [, first, named] = queries()
    for (const asked of [first!, named!]) {
      expect(has(asked, "from", "jobs")).toBe(true)
      expect(has(asked, "eq", "user_id", OWNER)).toBe(true)
      expect(has(asked, "not", "restricted_at", "is", null)).toBe(true)
      // The owner, which job, and that it is restricted: no other condition, so a restricted job
      // closes the dub wherever it is filed.
      expect(asked.filter((call) => !["from", "select", "limit"].includes(call.method))).toHaveLength(3)
    }
    expect(has(first!, "eq", "id", FIRST)).toBe(true)
    expect(has(named!, "ilike", "input_data->>sourceDubJobId", FIRST)).toBe(true)
  })

  it.each([
    { about: "the job the dub began with", answers: [{ data: null, error: new Error("connection lost") }, { data: [], error: null }] },
    { about: "the languages added to it", answers: [{ data: [], error: null }, { data: null, error: new Error("connection lost") }] },
  ])("throws when it cannot ask about $about, instead of opening the dub", async ({ answers }) => {
    db.answers.push({ data: row(FIRST, dub()), error: null }, ...answers)

    await expect(loadDubFamily(OWNER, FIRST)).rejects.toThrow("connection lost")
  })

  it("throws a database failure instead of calling the job missing", async () => {
    db.answers.push({ data: null, error: new Error("connection lost") })

    await expect(loadDubFamily(OWNER, FIRST)).rejects.toThrow("connection lost")
  })
})

describe("dubFamilyIdOf", () => {
  const job = (input: Record<string, unknown>) => ({ id: FIRST, status: "completed", providerTaskId: null, input, createdAt: "" })

  it("is the job's own id unless it names another job", () => {
    expect(dubFamilyIdOf(job(dub()))).toBe(FIRST)
    expect(dubFamilyIdOf(job(dub({ sourceDubJobId: ADDED })))).toBe(ADDED)
  })

  it("tells a name written in capitals the way a job's id is written", () => {
    expect(dubFamilyIdOf(job(dub({ sourceDubJobId: LETTERED.toUpperCase() })))).toBe(LETTERED)
  })

  it("ignores a name that is not a job id", () => {
    expect(dubFamilyIdOf(job(dub({ sourceDubJobId: "anything" })))).toBe(FIRST)
    expect(dubFamilyIdOf(job(dub({ sourceDubJobId: 7 })))).toBe(FIRST)
  })
})
