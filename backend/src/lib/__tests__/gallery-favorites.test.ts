import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { supabase } = await import("../supabase.js")
const { favoritableJobFilter, listFavoriteJobIds, toggleGalleryFavorite } = await import("../gallery-favorites.js")

const USER = "00000000-0000-4000-8000-0000000000aa"
const JOB = "00000000-0000-4000-8000-0000000000b1"

type Answer = { data: unknown; error: unknown }
interface Op {
  table: string
  verb: string
  payload?: unknown
  calls: Array<[string, ...unknown[]]>
}

/**
 * Per-table answers, in call order: `answers[table]` is a queue, so the
 * favorites table can answer the existence check and then the write.
 */
function seed(answers: Record<string, Answer[]>) {
  const ops: Op[] = []
  const queues = Object.fromEntries(Object.entries(answers).map(([t, a]) => [t, [...a]]))
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const op: Op = { table, verb: "", calls: [] }
    ops.push(op)
    const answer = () => queues[table]?.shift() ?? { data: null, error: null }
    const chain = {
      select: (cols: string) => ((op.verb ||= "select"), op.calls.push(["select", cols]), chain),
      insert: (payload: unknown) => ((op.verb = "insert"), (op.payload = payload), chain),
      delete: () => ((op.verb = "delete"), chain),
      eq: (c: string, v: unknown) => (op.calls.push(["eq", c, v]), chain),
      or: (f: string) => (op.calls.push(["or", f]), chain),
      order: (c: string, o: unknown) => (op.calls.push(["order", c, o]), chain),
      limit: (n: number) => (op.calls.push(["limit", n]), chain),
      maybeSingle: () => Promise.resolve(answer()),
      then: (resolve: (v: Answer) => void) => resolve(answer()),
    }
    return chain as never
  })
  return ops
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("favoritableJobFilter", () => {
  it("is the caller's own job, or any public completed one — what the gallery shows", () => {
    expect(favoritableJobFilter(USER)).toBe(`user_id.eq.${USER},and(is_public.eq.true,status.eq.completed)`)
  })
})

describe("toggleGalleryFavorite", () => {
  it("adds a favorite when there is none, after checking the job is one the caller may see", async () => {
    const ops = seed({
      gallery_favorites: [{ data: [], error: null }, { data: null, error: null }],
      jobs: [{ data: { id: JOB }, error: null }],
    })

    expect(await toggleGalleryFavorite(USER, JOB)).toEqual({ kind: "toggled", favorited: true })

    expect(ops.map((o) => `${o.table}:${o.verb}`)).toEqual(["gallery_favorites:select", "jobs:select", "gallery_favorites:insert"])
    expect(ops[1]!.calls).toContainEqual(["eq", "id", JOB])
    expect(ops[1]!.calls).toContainEqual(["or", favoritableJobFilter(USER)])
    expect(ops[2]!.payload).toEqual({ user_id: USER, job_id: JOB })
  })

  it("removes an existing favorite without checking the job — you can always take back your own favorite", async () => {
    const ops = seed({ gallery_favorites: [{ data: [{ id: "f1" }], error: null }, { data: null, error: null }] })

    expect(await toggleGalleryFavorite(USER, JOB)).toEqual({ kind: "toggled", favorited: false })

    expect(ops.map((o) => `${o.table}:${o.verb}`)).toEqual(["gallery_favorites:select", "gallery_favorites:delete"])
    expect(ops[1]!.calls).toEqual([["eq", "user_id", USER], ["eq", "job_id", JOB]])
  })

  it("is not_found for a job the caller may not see (another person's private work), and stores nothing", async () => {
    const ops = seed({ gallery_favorites: [{ data: [], error: null }], jobs: [{ data: null, error: null }] })

    expect(await toggleGalleryFavorite(USER, JOB)).toEqual({ kind: "not_found" })
    expect(ops.some((o) => o.verb === "insert")).toBe(false)
  })

  it("reads a concurrent add (unique violation) as favorited, and a job deleted meanwhile (foreign key) as not found", async () => {
    seed({
      gallery_favorites: [{ data: [], error: null }, { data: null, error: { code: "23505", message: "duplicate" } }],
      jobs: [{ data: { id: JOB }, error: null }],
    })
    expect(await toggleGalleryFavorite(USER, JOB)).toEqual({ kind: "toggled", favorited: true })

    seed({
      gallery_favorites: [{ data: [], error: null }, { data: null, error: { code: "23503", message: "fk" } }],
      jobs: [{ data: { id: JOB }, error: null }],
    })
    expect(await toggleGalleryFavorite(USER, JOB)).toEqual({ kind: "not_found" })
  })

  it("throws on any read or write failure", async () => {
    seed({ gallery_favorites: [{ data: null, error: { code: "57014", message: "timeout" } }] })
    await expect(toggleGalleryFavorite(USER, JOB)).rejects.toMatchObject({ code: "57014" })

    seed({ gallery_favorites: [{ data: [{ id: "f1" }], error: null }, { data: null, error: { code: "57014", message: "timeout" } }] })
    await expect(toggleGalleryFavorite(USER, JOB)).rejects.toMatchObject({ code: "57014" })
  })
})

describe("listFavoriteJobIds", () => {
  it("is the caller's favorited job ids, newest first", async () => {
    const ops = seed({ gallery_favorites: [{ data: [{ job_id: "j2" }, { job_id: "j1" }], error: null }] })

    expect(await listFavoriteJobIds(USER)).toEqual(["j2", "j1"])
    expect(ops[0]!.calls).toEqual([
      ["select", "job_id"],
      ["eq", "user_id", USER],
      ["order", "created_at", { ascending: false }],
    ])
  })

  it("throws when the read fails", async () => {
    seed({ gallery_favorites: [{ data: null, error: { code: "57014", message: "timeout" } }] })
    await expect(listFavoriteJobIds(USER)).rejects.toMatchObject({ code: "57014" })
  })
})
