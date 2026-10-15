import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { supabase } = await import("../supabase.js")
const { jobOwnerStateFor, ownerStateOf } = await import("../job-owner-state.js")

const OWNER = "00000000-0000-4000-8000-0000000000aa"

type Answer = { data: unknown; error: unknown }

/** Table-aware reads: records each table's filters and answers what it was given. */
function seed(answers: Record<string, Answer>) {
  const reads: Array<{ table: string; select: string; filters: Array<[string, string, unknown]> }> = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const read = { table, select: "", filters: [] as Array<[string, string, unknown]> }
    reads.push(read)
    const chain = {
      select: (cols: string) => ((read.select = cols), chain),
      eq: (c: string, v: unknown) => (read.filters.push(["eq", c, v]), chain),
      in: (c: string, v: unknown) => (read.filters.push(["in", c, v]), chain),
      then: (resolve: (v: Answer) => void) => resolve(answers[table] ?? { data: [], error: null }),
    }
    return chain as never
  })
  return reads
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("jobOwnerStateFor", () => {
  it("reads each table ONCE for the whole page, scoped to the owner, and answers per job", async () => {
    const reads = seed({
      gallery_favorites: { data: [{ job_id: "j1" }], error: null },
      job_ratings: { data: [{ job_id: "j1", rating: "good" }, { job_id: "j2", rating: "bad" }], error: null },
    })

    const state = await jobOwnerStateFor(OWNER, ["j1", "j2", "j3", "j1", null, undefined])

    expect(reads.map((r) => r.table).sort()).toEqual(["gallery_favorites", "job_ratings"])
    for (const read of reads) {
      expect(read.filters).toEqual([
        ["eq", "user_id", OWNER],
        ["in", "job_id", ["j1", "j2", "j3"]],
      ])
    }
    expect(ownerStateOf("j1", state)).toEqual({ favorited: true, rating: "good" })
    expect(ownerStateOf("j2", state)).toEqual({ favorited: false, rating: "bad" })
    expect(ownerStateOf("j3", state)).toEqual({ favorited: false, rating: null })
  })

  it("reads nothing for an empty page", async () => {
    const reads = seed({})
    const state = await jobOwnerStateFor(OWNER, [])
    expect(reads).toEqual([])
    expect(ownerStateOf("anything", state)).toEqual({ favorited: false, rating: null })
  })

  it("ignores a rating value outside the vocabulary rather than passing it on", async () => {
    seed({ job_ratings: { data: [{ job_id: "j1", rating: "meh" }], error: null } })
    const state = await jobOwnerStateFor(OWNER, ["j1"])
    expect(ownerStateOf("j1", state)).toEqual({ favorited: false, rating: null })
  })

  it("reads no ratings yet, rather than failing, while the ratings table is not in the database (staging before main)", async () => {
    seed({
      gallery_favorites: { data: [{ job_id: "j1" }], error: null },
      job_ratings: { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.job_ratings'" } },
    })
    const state = await jobOwnerStateFor(OWNER, ["j1"])
    expect(ownerStateOf("j1", state)).toEqual({ favorited: true, rating: null })
  })

  it("throws on a real failure of either read — a silent `false` would invert the next toggle", async () => {
    seed({ gallery_favorites: { data: null, error: { code: "57014", message: "statement timeout" } } })
    await expect(jobOwnerStateFor(OWNER, ["j1"])).rejects.toMatchObject({ code: "57014" })

    seed({ job_ratings: { data: null, error: { code: "57014", message: "statement timeout" } } })
    await expect(jobOwnerStateFor(OWNER, ["j1"])).rejects.toMatchObject({ code: "57014" })
  })
})
