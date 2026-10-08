/**
 * The per-minute listing columns (migration 483) reach the shared database
 * only at the dev→main promotion, and staging runs ahead of them: a read or a
 * write that names one must survive their absence (decided 2026-10-07).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import {
  PER_MINUTE_ABSENT_TTL_MS,
  notePerMinuteColumnError,
  perMinuteOf,
  resetPerMinuteColumnsForTest,
  selectWithPerMinute,
  withPerMinuteColumns,
  withoutPerMinute,
  writeWithPerMinute,
} from "../listing-per-minute-columns.js"
import { TYPICAL_EPISODE_MINUTES, typicalEpisodeCredits } from "@nodaro/render-rules"

const MISSING = { code: "42703", message: "column published_apps.per_minute_credits does not exist" }
const SCHEMA_CACHE = { code: "PGRST204", message: "Could not find the 'estimated_per_minute_credits' column" }

beforeEach(() => resetPerMinuteColumnsForTest())

describe("a read", () => {
  it("names the columns while they exist", async () => {
    const asked: string[] = []
    const r = await selectWithPerMinute<{ id: string }[]>("published_apps", "id", async (columns) => {
      asked.push(columns)
      return { data: [{ id: "a" }], error: null }
    })
    expect(asked).toEqual(["id, base_per_minute_credits, per_minute_credits, base_per_item_credits, per_item_credits"])
    expect(r.data).toEqual([{ id: "a" }])
  })

  it("retries without them once they are missing, and stops naming them", async () => {
    const asked: string[] = []
    const build = async (columns: string) => {
      asked.push(columns)
      return columns.includes("per_minute") ? { data: null, error: MISSING } : { data: [{ id: "a" }], error: null }
    }
    const first = await selectWithPerMinute("published_apps", "id", build)
    const second = await selectWithPerMinute("published_apps", "id", build)
    expect(first.data).toEqual([{ id: "a" }])
    expect(second.data).toEqual([{ id: "a" }])
    expect(asked).toEqual(["id, base_per_minute_credits, per_minute_credits, base_per_item_credits, per_item_credits", "id", "id"])
    // One table's absence says nothing about the other's.
    expect(withPerMinuteColumns("workflow_templates", "id")).toBe("id, estimated_per_minute_credits")
  })

  it("passes any other error through", async () => {
    const r = await selectWithPerMinute("workflow_templates", "id", async () => ({ data: null, error: { code: "57014", message: "timeout" } }))
    expect(r.error?.code).toBe("57014")
    expect(withPerMinuteColumns("workflow_templates", "id")).toBe("id, estimated_per_minute_credits")
  })
})

// Review F1: staging is not restarted when the promotion applies migration
// 483 (the migrate job redeploys production only), so "missing" must not be
// remembered for the life of the process.
describe("a missing column is remembered for a while, then asked again", () => {
  afterEach(() => vi.useRealTimers())

  it("after the time limit a read names the columns again, and keeps them once they answer", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-07T10:00:00Z"))
    let applied = false
    const asked: string[] = []
    const build = async (columns: string) => {
      asked.push(columns)
      return columns.includes("per_minute") && !applied ? { data: null, error: MISSING } : { data: [{ id: "a" }], error: null }
    }
    await selectWithPerMinute("published_apps", "id", build)
    vi.setSystemTime(Date.now() + PER_MINUTE_ABSENT_TTL_MS - 1)
    await selectWithPerMinute("published_apps", "id", build)
    expect(asked).toEqual(["id, base_per_minute_credits, per_minute_credits, base_per_item_credits, per_item_credits", "id", "id"])
    // The migration applies; once the limit passes the next read names the columns and keeps them.
    applied = true
    vi.setSystemTime(Date.now() + 2)
    asked.length = 0
    await selectWithPerMinute("published_apps", "id", build)
    await selectWithPerMinute("published_apps", "id", build)
    expect(asked).toEqual(["id, base_per_minute_credits, per_minute_credits, base_per_item_credits, per_item_credits", "id, base_per_minute_credits, per_minute_credits, base_per_item_credits, per_item_credits"])
  })

  it("a write after the time limit carries the columns again", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-07T10:00:00Z"))
    notePerMinuteColumnError("workflow_templates", SCHEMA_CACHE)
    const written: Record<string, unknown>[] = []
    const write = async (row: Record<string, unknown>) => {
      written.push(row)
      return { error: null }
    }
    await writeWithPerMinute("workflow_templates", { estimated_credits: 82, estimated_per_minute_credits: 14 }, write)
    vi.setSystemTime(Date.now() + PER_MINUTE_ABSENT_TTL_MS + 1)
    await writeWithPerMinute("workflow_templates", { estimated_credits: 82, estimated_per_minute_credits: 14 }, write)
    expect(written).toEqual([{ estimated_credits: 2602 }, { estimated_credits: 82, estimated_per_minute_credits: 14 }])
  })
})

// Review F3: only an error that names one of these columns says they are
// missing. Another PR's not-yet-applied column in the same select is the
// caller's error to handle.
describe("a missing column that is not a per-minute one", () => {
  const OTHER_42703 = { code: "42703", message: "column published_apps.some_new_column does not exist" }
  const OTHER_PGRST204 = { code: "PGRST204", message: "Could not find the 'some_new_column' column of 'workflow_templates' in the schema cache" }

  it("is not taken as theirs", () => {
    expect(notePerMinuteColumnError("published_apps", OTHER_42703)).toBe(false)
    expect(notePerMinuteColumnError("workflow_templates", OTHER_PGRST204)).toBe(false)
    expect(withPerMinuteColumns("published_apps", "id")).toBe("id, base_per_minute_credits, per_minute_credits, base_per_item_credits, per_item_credits")
    expect(withPerMinuteColumns("workflow_templates", "id")).toBe("id, estimated_per_minute_credits")
  })

  it("a read hands it back to the caller, unretried", async () => {
    const asked: string[] = []
    const r = await selectWithPerMinute("published_apps", "id", async (columns) => {
      asked.push(columns)
      return { data: null, error: OTHER_42703 }
    })
    expect(r.error).toEqual(OTHER_42703)
    expect(asked).toEqual(["id, base_per_minute_credits, per_minute_credits, base_per_item_credits, per_item_credits"])
  })

  it("names a column by its whole name, with or without the table or quotes", () => {
    expect(notePerMinuteColumnError("published_apps", { code: "42703", message: "column \"per_minute_credits\" does not exist" })).toBe(true)
    resetPerMinuteColumnsForTest()
    expect(notePerMinuteColumnError("published_apps", { code: "42703", message: "column published_apps.base_per_minute_credits does not exist" })).toBe(true)
    resetPerMinuteColumnsForTest()
    // A longer name that merely contains one is not it.
    expect(notePerMinuteColumnError("published_apps", { code: "42703", message: "column published_apps.per_minute_credits_v2 does not exist" })).toBe(false)
    // Another table's column is not this table's.
    expect(notePerMinuteColumnError("workflow_templates", MISSING)).toBe(false)
  })
})

describe("a write", () => {
  // Staging writes the SHARED database production reads with code that knows
  // no per-minute part: a row written without the columns must carry the
  // price production always read, the per-minute part at 180 minutes.
  it("is retried without the columns, the per-minute part folded into the fixed price at 180 minutes", async () => {
    const written: Record<string, unknown>[] = []
    const r = await writeWithPerMinute("workflow_templates", { name: "t", estimated_credits: 82, estimated_per_minute_credits: 14 }, async (row) => {
      written.push(row)
      return "estimated_per_minute_credits" in row ? { error: SCHEMA_CACHE } : { error: null }
    })
    expect(r.error).toBeNull()
    expect(written).toEqual([
      { name: "t", estimated_credits: 82, estimated_per_minute_credits: 14 },
      { name: "t", estimated_credits: 2602 },
    ])
  })

  it("folds both of an app's pairs, and marks a folded row the way the caller asks", async () => {
    const written: Record<string, unknown>[] = []
    const row = { base_estimated_credits: 22, estimated_credits: 38, base_per_minute_credits: 5, per_minute_credits: 18 }
    await writeWithPerMinute("published_apps", row, async (r) => {
      written.push(r)
      return "per_minute_credits" in r ? { error: MISSING } : { error: null }
    }, (r) => ({ ...r, folded: true }))
    expect(written[1]).toEqual({ base_estimated_credits: 22 + 5 * 180, estimated_credits: 38 + 18 * 180, folded: true })
    // Known missing now: the next write goes folded at once.
    written.length = 0
    await writeWithPerMinute("published_apps", row, async (r) => {
      written.push(r)
      return { error: null }
    })
    expect(written).toEqual([{ base_estimated_credits: 22 + 5 * 180, estimated_credits: 38 + 18 * 180 }])
  })

  it("an update that does not write the fixed price drops the per-minute columns alone", async () => {
    const written: Record<string, unknown>[] = []
    await writeWithPerMinute("published_apps", { name: "x", per_minute_credits: 18 }, async (r) => {
      written.push(r)
      return "per_minute_credits" in r ? { error: MISSING } : { error: null }
    })
    expect(written[1]).toEqual({ name: "x" })
  })
})

describe("perMinuteOf", () => {
  it("reads a whole number of credits, 0 when absent or not a number", () => {
    expect(perMinuteOf({ per_minute_credits: 14 }, "per_minute_credits")).toBe(14)
    expect(perMinuteOf({}, "per_minute_credits")).toBe(0)
    expect(perMinuteOf({ per_minute_credits: null }, "per_minute_credits")).toBe(0)
    expect(perMinuteOf(null, "per_minute_credits")).toBe(0)
  })
})

// Every file that names a per-minute column goes through the helper, so a new
// read or write cannot fail a whole statement on staging.
describe("every site that names a per-minute column goes through the helper", () => {
  const SRC = join(__dirname, "..", "..")
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(path)
      return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
    })
  }
  const NAMES = /\b(?:base_per_minute_credits|per_minute_credits|estimated_per_minute_credits|typical_episode_credits)\b/
  const files = sources(SRC)
    .map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, "utf8") }))
    .filter((f) => NAMES.test(f.text))

  it("finds the sites", () => {
    expect(files.map((f) => f.rel).sort()).toEqual(
      expect.arrayContaining(["lib/listing-per-minute-columns.ts", "routes/published-apps.ts", "routes/workflow-templates.ts", "routes/tutorials.ts", "lib/tutorial-seed/index.ts"]),
    )
  })

  it.each(files.map((f) => f.rel).filter((rel) => rel !== "lib/listing-per-minute-columns.ts" && rel !== "lib/app-listing-price.ts"))(
    "%s imports the helper",
    (rel) => {
      const text = files.find((f) => f.rel === rel)!.text
      expect(text).toMatch(/from "(?:\.\.?\/)+(?:lib\/)?listing-per-minute-columns\.js"/)
    },
  )
})

// The gallery's "cheapest first" sort column (decided 2026-10-07): generated in
// migration 483 from the number the gallery's tooltip states.
describe("typical_episode_credits", () => {
  it("is generated from TYPICAL_EPISODE_MINUTES", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "483_listing_per_minute_credits.sql"), "utf8")
    const m = /typical_episode_credits INT\s+GENERATED ALWAYS AS \(estimated_credits \+ (\d+) \* estimated_per_minute_credits\) STORED/.exec(sql)
    expect(m, "the generated column").not.toBeNull()
    expect(Number(m![1])).toBe(TYPICAL_EPISODE_MINUTES)
    expect(typicalEpisodeCredits(82, 14)).toBe(82 + TYPICAL_EPISODE_MINUTES * 14)
  })

  it("a missing-column error naming it is the same missing migration", async () => {
    resetPerMinuteColumnsForTest()
    expect(notePerMinuteColumnError("workflow_templates", { code: "42703", message: "column workflow_templates.typical_episode_credits does not exist" })).toBe(true)
    expect(withPerMinuteColumns("workflow_templates", "id")).toBe("id")
    resetPerMinuteColumnsForTest()
  })
})

// The per-item pair (decided 2026-10-07) rides with the per-minute columns on
// published_apps: a public read names the listed one, and a write without the
// columns drops it (a list has no longest length to fold it at).
describe("the per-item pair", () => {
  it("a listed read names the listed per-minute and per-item prices, never the fee's bases", () => {
    resetPerMinuteColumnsForTest()
    expect(withPerMinuteColumns("published_apps", "id", "listed")).toBe("id, per_minute_credits, per_item_credits")
  })

  it("a write without the columns drops it, folding only the per-minute pair", () => {
    const row = { base_estimated_credits: 22, estimated_credits: 38, base_per_minute_credits: 1, per_minute_credits: 2, base_per_item_credits: 30, per_item_credits: 40 }
    expect(withoutPerMinute("published_apps", row)).toEqual({ base_estimated_credits: 22 + 180, estimated_credits: 38 + 360 })
  })
})

