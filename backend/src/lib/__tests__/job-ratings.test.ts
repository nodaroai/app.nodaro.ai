import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { supabase } = await import("../supabase.js")
const { setJobRating, JOB_RATINGS, JOB_RATING_FILTERS } = await import("../job-ratings.js")

const OWNER = "00000000-0000-4000-8000-0000000000aa"
const JOB = "00000000-0000-4000-8000-0000000000b1"

type Answer = { data: unknown; error: unknown }
interface Op {
  table: string
  verb: string
  payload?: unknown
  options?: unknown
  filters: Array<[string, unknown]>
}

/** Every write and read, per table; `answers[table]` answers whatever that table is asked. */
function seed(answers: Record<string, Answer>) {
  const ops: Op[] = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const op: Op = { table, verb: "", filters: [] }
    ops.push(op)
    const chain = {
      select: () => ((op.verb ||= "select"), chain),
      upsert: (payload: unknown, options: unknown) => ((op.verb = "upsert"), (op.payload = payload), (op.options = options), chain),
      delete: () => ((op.verb = "delete"), chain),
      eq: (c: string, v: unknown) => (op.filters.push([c, v]), chain),
      is: (c: string, v: unknown) => (op.filters.push([c, v]), chain),
      maybeSingle: () => Promise.resolve(answers[table] ?? { data: null, error: null }),
      then: (resolve: (v: Answer) => void) => resolve(answers[table] ?? { data: null, error: null }),
    }
    return chain as never
  })
  return ops
}

const owned = { data: { id: JOB }, error: null }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the rating vocabulary", () => {
  it("is good | bad, and the list filter adds rated | unrated", () => {
    expect([...JOB_RATINGS]).toEqual(["good", "bad"])
    expect([...JOB_RATING_FILTERS]).toEqual(["good", "bad", "rated", "unrated"])
  })
})

describe("setJobRating", () => {
  it("upserts the owner's rating on their own job, one row per job", async () => {
    const ops = seed({ jobs: owned, job_ratings: { data: null, error: null } })

    expect(await setJobRating(OWNER, JOB, "good")).toEqual({ kind: "ok", rating: "good" })

    const [read, write] = ops
    // A job in the Trash is not rated: it reads as not found.
    expect(read).toMatchObject({ table: "jobs", verb: "select", filters: [["deleted_at", null], ["id", JOB], ["user_id", OWNER]] })
    expect(write).toMatchObject({
      table: "job_ratings",
      verb: "upsert",
      payload: { user_id: OWNER, job_id: JOB, rating: "good" },
      options: { onConflict: "user_id,job_id" },
    })
  })

  it("clears the rating with null — a delete scoped to the owner and the job", async () => {
    const ops = seed({ jobs: owned, job_ratings: { data: null, error: null } })

    expect(await setJobRating(OWNER, JOB, null)).toEqual({ kind: "ok", rating: null })
    expect(ops[1]).toMatchObject({ table: "job_ratings", verb: "delete", filters: [["user_id", OWNER], ["job_id", JOB]] })
  })

  it("is not_found for a job that is not the caller's (or does not exist), and writes nothing", async () => {
    const ops = seed({ jobs: { data: null, error: null } })

    expect(await setJobRating(OWNER, JOB, "bad")).toEqual({ kind: "not_found" })
    expect(ops.map((o) => o.table)).toEqual(["jobs"])
  })

  it("is not_found when the job disappears between the check and the write (foreign key)", async () => {
    seed({ jobs: owned, job_ratings: { data: null, error: { code: "23503", message: "violates foreign key" } } })
    expect(await setJobRating(OWNER, JOB, "good")).toEqual({ kind: "not_found" })
  })

  it("is not_available while the ratings table is not in the database (staging before main)", async () => {
    seed({ jobs: owned, job_ratings: { data: null, error: { code: "PGRST205", message: "no table" } } })
    expect(await setJobRating(OWNER, JOB, "good")).toEqual({ kind: "not_available" })
    seed({ jobs: owned, job_ratings: { data: null, error: { code: "42P01", message: "no table" } } })
    expect(await setJobRating(OWNER, JOB, null)).toEqual({ kind: "not_available" })
  })

  it("throws on any other failure", async () => {
    seed({ jobs: { data: null, error: { code: "57014", message: "timeout" } } })
    await expect(setJobRating(OWNER, JOB, "good")).rejects.toMatchObject({ code: "57014" })

    seed({ jobs: owned, job_ratings: { data: null, error: { code: "57014", message: "timeout" } } })
    await expect(setJobRating(OWNER, JOB, "good")).rejects.toMatchObject({ code: "57014" })
  })
})
