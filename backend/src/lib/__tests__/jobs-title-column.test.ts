import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// `jobs.title` until migration 609 reaches the database: the column is absent
// until a probe has seen it, the selects leave it out until then, and the
// probe forgets it again on a missing-column error. Staging runs dev against
// the shared database before the promotion applies the migration.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({ answer: { error: null as null | { code?: string | null; message?: string } }, selects: [] as string[], throws: false }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        db.selects.push(cols)
        return {
          limit: async () => {
            if (db.throws) throw new Error("unreachable")
            return db.answer
          },
        }
      },
    }),
  },
}))

import {
  noteTitleColumnError,
  probeTitleColumn,
  setTitleColumnPresentForTests,
  titleColumnPresent,
  titleEmbedSelect,
  titleSelect,
  watchTitleColumn,
} from "../jobs-title-column.js"

beforeEach(() => {
  db.answer = { error: null }
  db.selects = []
  db.throws = false
  setTitleColumnPresentForTests(false)
})
afterEach(() => {
  setTitleColumnPresentForTests(false)
  vi.useRealTimers()
})

describe("jobs.title until it is in the database", () => {
  it("is absent until a probe has seen it: the selects name nothing, naming is off", () => {
    expect(titleColumnPresent()).toBe(false)
    expect(titleSelect()).toBe("")
    expect(titleEmbedSelect()).toBe("")
  })

  it("one cheap read that answers makes it present; the selects then name it", async () => {
    expect(await probeTitleColumn()).toBe(true)
    expect(db.selects).toEqual(["title"])
    expect(titleSelect()).toBe(", title")
    expect(titleEmbedSelect()).toBe(", job:jobs!job_id(title)")
  })

  it("a missing-column answer keeps it absent; any other failure changes nothing", async () => {
    db.answer = { error: { code: "42703", message: "column jobs.title does not exist" } }
    expect(await probeTitleColumn()).toBe(false)

    setTitleColumnPresentForTests(true)
    db.answer = { error: { code: "57P01", message: "terminating connection" } }
    expect(await probeTitleColumn()).toBe(true)
    db.throws = true
    expect(await probeTitleColumn()).toBe(true)
  })

  it("a missing-column error from any read forgets the column until the next probe sees it", () => {
    setTitleColumnPresentForTests(true)
    expect(noteTitleColumnError({ code: "PGRST204" })).toBe(true)
    expect(titleColumnPresent()).toBe(false)
    setTitleColumnPresentForTests(true)
    expect(noteTitleColumnError({ code: "23505" })).toBe(false)
    expect(noteTitleColumnError(null)).toBe(false)
    expect(titleColumnPresent()).toBe(true)
  })

  it("the watcher probes at once and again on its interval while the column is absent, then stops asking", async () => {
    vi.useFakeTimers()
    db.answer = { error: { code: "42703" } }
    watchTitleColumn()
    await Promise.resolve()
    expect(db.selects).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(db.selects).toHaveLength(2)
    // The promotion applied the migration: the next probe sees the column, and no probe follows.
    db.answer = { error: null }
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(db.selects).toHaveLength(3)
    expect(titleColumnPresent()).toBe(true)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(db.selects).toHaveLength(3)
  })
})
