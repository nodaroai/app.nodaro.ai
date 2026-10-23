import { describe, it, expect } from "vitest"
import {
  applyJobListFilters,
  jobListFilterSelect,
  parseJobListQuery,
  ratingsNotAvailable,
  withoutFilterEmbeds,
  type JobListFilters,
} from "../job-list-filters.js"
import { JOB_STATUSES } from "../job-status.js"

/** A query builder that records every filter call, in order. */
function recorder() {
  const calls: Array<[string, ...unknown[]]> = []
  const q = {
    eq: (c: string, v: string) => (calls.push(["eq", c, v]), q),
    in: (c: string, v: readonly string[]) => (calls.push(["in", c, [...v]]), q),
    is: (c: string, v: null) => (calls.push(["is", c, v]), q),
    filter: (c: string, op: string, v: string) => (calls.push(["filter", c, op, v]), q),
  }
  return { q, calls }
}

const OWNER = "00000000-0000-4000-8000-0000000000aa"

describe("parseJobListQuery", () => {
  it("reads no filter when none is given, and ignores the list's other params", () => {
    const parsed = parseJobListQuery({ limit: "10", cursor: "2026-10-01T00:00:00Z", userId: "x", attachToCharacterId: "c" })
    expect(parsed).toEqual({ success: true, data: {} })
  })

  it("takes status and type once, repeated (type=a&type=b) or comma-separated, and dedupes", () => {
    const once = parseJobListQuery({ status: "failed", type: "generate-image" })
    expect(once.success && once.data).toEqual({ statuses: ["failed"], types: ["generate-image"] })

    const repeated = parseJobListQuery({ status: ["failed", "cancelled"], type: ["generate-image", "generate-video"] })
    expect(repeated.success && repeated.data).toEqual({
      statuses: ["failed", "cancelled"],
      types: ["generate-image", "generate-video"],
    })

    const commas = parseJobListQuery({ status: "failed, cancelled,failed", type: ["generate-image,generate-video", "generate-image"] })
    expect(commas.success && commas.data).toEqual({
      statuses: ["failed", "cancelled"],
      types: ["generate-image", "generate-video"],
    })
  })

  it("admits every status in the canonical vocabulary, pending_review included", () => {
    const parsed = parseJobListQuery({ status: JOB_STATUSES.join(",") })
    expect(parsed.success && parsed.data.statuses).toEqual([...JOB_STATUSES])
  })

  it("refuses a status outside the vocabulary — `running` is a run's state, never a job's", () => {
    const parsed = parseJobListQuery({ status: "completed,running" })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0]?.path[0]).toBe("status")
  })

  it("reads an empty status or type as no filter, as the list always has", () => {
    expect(parseJobListQuery({ status: "", type: " , " })).toEqual({ success: true, data: {} })
  })

  it("takes origin as one value", () => {
    const parsed = parseJobListQuery({ origin: "studio" })
    expect(parsed.success && parsed.data).toEqual({ origin: "studio" })
    expect(parseJobListQuery({ origin: ["a", "b"] }).success).toBe(false)
  })

  it("takes source as one or more caller kinds and refuses an unknown one", () => {
    const parsed = parseJobListQuery({ source: "mcp" })
    expect(parsed.success && parsed.data).toEqual({ sources: ["mcp"] })
    const several = parseJobListQuery({ source: "mcp,cli" })
    expect(several.success && several.data).toEqual({ sources: ["mcp", "cli"] })
    expect(parseJobListQuery({ source: "claude" }).success).toBe(false)
  })

  it("reads favorited=true|false as a boolean and refuses anything else", () => {
    const yes = parseJobListQuery({ favorited: "true" })
    expect(yes.success && yes.data).toEqual({ favorited: true })
    const no = parseJobListQuery({ favorited: "false" })
    expect(no.success && no.data).toEqual({ favorited: false })
    expect(parseJobListQuery({ favorited: "1" }).success).toBe(false)
  })

  it("takes rating good | bad | rated | unrated and refuses anything else", () => {
    for (const rating of ["good", "bad", "rated", "unrated"] as const) {
      const parsed = parseJobListQuery({ rating })
      expect(parsed.success && parsed.data).toEqual({ rating })
    }
    expect(parseJobListQuery({ rating: "meh" }).success).toBe(false)
  })

  it("caps a list at 20 values", () => {
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`).join(",")
    expect(parseJobListQuery({ type: many }).success).toBe(false)
  })
})

describe("jobListFilterSelect", () => {
  it("adds nothing for the filters that read the job's own columns", () => {
    expect(jobListFilterSelect({ statuses: ["failed"], types: ["a", "b"], origin: "studio" })).toBe("")
  })

  it("embeds the caller's favorites by their foreign key: an inner join for true, the plain embed for false", () => {
    expect(jobListFilterSelect({ favorited: true })).toBe(", gallery_favorites!gallery_favorites_job_id_fkey!inner(job_id)")
    expect(jobListFilterSelect({ favorited: false })).toBe(", gallery_favorites!gallery_favorites_job_id_fkey(job_id)")
  })

  it("embeds the ratings by their foreign key: an inner join to find rated jobs, the plain embed to find unrated ones", () => {
    for (const rating of ["good", "bad", "rated"] as const) {
      expect(jobListFilterSelect({ rating })).toBe(", job_ratings!job_ratings_job_id_fkey!inner(rating)")
    }
    expect(jobListFilterSelect({ rating: "unrated" })).toBe(", job_ratings!job_ratings_job_id_fkey(rating)")
  })

  it("combines both embeds", () => {
    expect(jobListFilterSelect({ favorited: true, rating: "good" })).toBe(
      ", gallery_favorites!gallery_favorites_job_id_fkey!inner(job_id), job_ratings!job_ratings_job_id_fkey!inner(rating)",
    )
  })
})

describe("applyJobListFilters", () => {
  /** Always first: a child job is shown only through its parent. */
  const NO_CHILDREN: [string, ...unknown[]] = ["is", "parent_job_id", null]
  const applied = (filters: JobListFilters) => {
    const { q, calls } = recorder()
    applyJobListFilters(q, filters, OWNER)
    return calls
  }

  it("with no filter, only leaves out child jobs", () => {
    expect(applied({})).toEqual([NO_CHILDREN])
  })

  it("leaves out child jobs under every filter", () => {
    expect(applied({ statuses: ["completed"], types: ["text-to-video"], origin: "tools", favorited: false, rating: "unrated" })[0]).toEqual(NO_CHILDREN)
  })

  it("one status is an eq, several an in", () => {
    expect(applied({ statuses: ["failed"] })).toEqual([NO_CHILDREN, ["eq", "status", "failed"]])
    expect(applied({ statuses: ["failed", "cancelled"] })).toEqual([NO_CHILDREN, ["in", "status", ["failed", "cancelled"]]])
  })

  it("filters type and origin on the input_data paths, never the job_type column", () => {
    expect(applied({ types: ["llm-structured"], origin: "studio" })).toEqual([
      NO_CHILDREN,
      ["filter", "input_data->>type", "eq", "llm-structured"],
      ["filter", "input_data->>origin", "eq", "studio"],
    ])
    expect(applied({ types: ["generate-image", "generate-video"] })).toEqual([
      NO_CHILDREN,
      ["in", "input_data->>type", ["generate-image", "generate-video"]],
    ])
  })

  it("filters source on the source column: one is an eq, several an in", () => {
    expect(applied({ sources: ["mcp"] })).toEqual([NO_CHILDREN, ["eq", "source", "mcp"]])
    expect(applied({ sources: ["mcp", "cli"] })).toEqual([NO_CHILDREN, ["in", "source", ["mcp", "cli"]]])
  })

  it("favorited keeps the owner's favorites only; false keeps the jobs with none (an anti-join)", () => {
    expect(applied({ favorited: true })).toEqual([NO_CHILDREN, ["eq", "gallery_favorites.user_id", OWNER]])
    expect(applied({ favorited: false })).toEqual([
      NO_CHILDREN,
      ["eq", "gallery_favorites.user_id", OWNER],
      ["is", "gallery_favorites", null],
    ])
  })

  it("rating narrows the owner's rating; rated keeps any, unrated keeps the jobs with none", () => {
    expect(applied({ rating: "good" })).toEqual([
      NO_CHILDREN,
      ["eq", "job_ratings.user_id", OWNER],
      ["eq", "job_ratings.rating", "good"],
    ])
    expect(applied({ rating: "bad" })).toEqual([
      NO_CHILDREN,
      ["eq", "job_ratings.user_id", OWNER],
      ["eq", "job_ratings.rating", "bad"],
    ])
    expect(applied({ rating: "rated" })).toEqual([NO_CHILDREN, ["eq", "job_ratings.user_id", OWNER]])
    expect(applied({ rating: "unrated" })).toEqual([
      NO_CHILDREN,
      ["eq", "job_ratings.user_id", OWNER],
      ["is", "job_ratings", null],
    ])
  })

  it("every filter combines with AND (each is one more call on the same query)", () => {
    expect(applied({ statuses: ["completed"], types: ["generate-image"], favorited: true, rating: "good" })).toHaveLength(6)
  })
})

describe("withoutFilterEmbeds", () => {
  it("drops the filter embeds and keeps everything else", () => {
    const row = { id: "j1", status: "completed", gallery_favorites: [{ job_id: "j1" }], job_ratings: [] }
    expect(withoutFilterEmbeds(row)).toEqual({ id: "j1", status: "completed" })
  })
})

describe("ratingsNotAvailable", () => {
  const noRatingsEmbed = {
    code: "PGRST200",
    message: "Could not find a relationship between 'jobs' and 'job_ratings' in the schema cache",
    details: "Searched for a foreign key relationship between 'jobs' and 'job_ratings' using the hint 'job_ratings_job_id_fkey' in the schema 'public', but no matches were found.",
  }

  it("is a rating filter that failed because the ratings table is not in this database yet", () => {
    expect(ratingsNotAvailable({ rating: "good" }, noRatingsEmbed)).toBe(true)
    expect(ratingsNotAvailable({ rating: "unrated" }, { code: "42P01", message: 'relation "job_ratings" does not exist' })).toBe(true)
    expect(ratingsNotAvailable({ rating: "rated" }, { code: "PGRST205", message: "Could not find the table 'public.job_ratings' in the schema cache" })).toBe(true)
  })

  it("is not a missing relationship of ANOTHER table in the same query — that one is a real error", () => {
    // favorited=true&rating=good embeds both tables: a broken favorites embed
    // must surface as a server error, never as "ratings are not available".
    // PostgREST's fuzzy `hint` may suggest the other table; only the message
    // and the details say which embed failed.
    const brokenFavoritesEmbed = {
      code: "PGRST200",
      message: "Could not find a relationship between 'jobs' and 'gallery_favorites' in the schema cache",
      details: "Searched for a foreign key relationship between 'jobs' and 'gallery_favorites' using the hint 'gallery_favorites_job_id_fkey' in the schema 'public', but no matches were found.",
      hint: "Perhaps you meant 'job_ratings' instead of 'gallery_favorites'.",
    }
    expect(ratingsNotAvailable({ favorited: true, rating: "good" }, brokenFavoritesEmbed)).toBe(false)
  })

  it("is not any other failure, a failure with no message, nor a listing that asked for no rating", () => {
    expect(ratingsNotAvailable({ rating: "good" }, { code: "57014", message: "statement timeout" })).toBe(false)
    expect(ratingsNotAvailable({ rating: "good" }, { code: "PGRST200" })).toBe(false)
    expect(ratingsNotAvailable({ favorited: true }, noRatingsEmbed)).toBe(false)
  })
})
