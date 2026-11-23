/**
 * A missing-column error is matched to ITS optional `jobs` column (decided
 * 2026-11-23, review round): one column's absence never makes the process
 * forget another that exists, and a statement naming two of them learns about
 * each (no short-circuit). An error naming no column cannot be told apart and
 * forgets every one (the safe side).
 */
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { missingColumnErrorNames, noteMissingJobsColumns, optionalJobsColumnCount } from "../jobs-optional-column.js"
import { noteTitleColumnError, setTitleColumnPresentForTests, titleColumnPresent } from "../jobs-title-column.js"
import { coverColumnPresent, noteCoverColumnError, setCoverColumnPresentForTests } from "../jobs-cover-column.js"

const both = () => {
  setTitleColumnPresentForTests(true)
  setCoverColumnPresentForTests(true)
}
afterEach(() => {
  setTitleColumnPresentForTests(false)
  setCoverColumnPresentForTests(false)
})

describe("missing-column errors, column by column", () => {
  it("Postgres's and PostgREST's messages name the column — directly, through an embed's alias, or quoted", () => {
    expect(missingColumnErrorNames({ code: "42703", message: "column jobs.title does not exist" }, "title")).toBe(true)
    expect(missingColumnErrorNames({ code: "42703", message: "column jobs_1.cover_url does not exist" }, "cover_url")).toBe(true)
    expect(missingColumnErrorNames({ code: "PGRST204", message: "Could not find the 'cover_url' column of 'jobs' in the schema cache" }, "cover_url")).toBe(true)
    expect(missingColumnErrorNames({ code: "42703", message: "column jobs.title does not exist" }, "cover_url")).toBe(false)
    expect(missingColumnErrorNames({ code: "42703", message: "column jobs.subtitle does not exist" }, "title")).toBe(false)
    expect(missingColumnErrorNames({ code: "23505", message: "title" }, "title")).toBe(false)
  })

  it("the title's absence does not make the process forget the cover, and the other way round", () => {
    both()
    expect(noteCoverColumnError({ code: "42703", message: "column jobs.title does not exist" })).toBe(false)
    expect(noteTitleColumnError({ code: "42703", message: "column jobs.title does not exist" })).toBe(true)
    expect([titleColumnPresent(), coverColumnPresent()]).toEqual([false, true])
    both()
    expect(noteTitleColumnError({ code: "PGRST204", message: "Could not find the 'cover_url' column of 'jobs'" })).toBe(false)
    expect(noteCoverColumnError({ code: "PGRST204", message: "Could not find the 'cover_url' column of 'jobs'" })).toBe(true)
    expect([titleColumnPresent(), coverColumnPresent()]).toEqual([true, false])
  })

  it("noteMissingJobsColumns asks every column, and an error naming none forgets them all", () => {
    both()
    expect(noteMissingJobsColumns({ code: "42703", message: "column jobs.cover_url does not exist" })).toEqual(["cover_url"])
    expect(titleColumnPresent()).toBe(true)
    both()
    expect(noteMissingJobsColumns({ code: "PGRST204" }).sort()).toEqual(["cover_url", "title"])
    expect([titleColumnPresent(), coverColumnPresent()]).toEqual([false, false])
    expect(noteMissingJobsColumns({ code: "57P01", message: "terminating connection" })).toEqual([])
    expect(optionalJobsColumnCount()).toBeGreaterThanOrEqual(2)
  })
})
