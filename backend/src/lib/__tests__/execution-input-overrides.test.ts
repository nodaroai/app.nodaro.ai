import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

// `workflow_executions.input_overrides` (migration 464, decided 2026-10-06):
// the input overrides a run applied, pinned on its execution when it starts,
// so a later continuation re-applies exactly those. Until the migration
// reaches the shared database (staging runs dev against it, and migrations
// apply only at dev→main) the column does not exist.

const db = vi.hoisted(() => ({
  writes: [] as Array<{ row: Record<string, unknown>; id: unknown }>,
  error: null as { code?: string; message: string } | null,
}))
vi.mock("../supabase.js", () => {
  return {
    supabase: {
      from: (table: string) => ({
        update: (row: Record<string, unknown>) => ({
          eq: async (_column: string, id: unknown) => {
            if (table === "workflow_executions") db.writes.push({ row, id })
            return { data: null, error: db.error }
          },
        }),
      }),
    },
  }
})

import {
  inputOverridesColumnAbsent,
  noteInputOverridesColumnError,
  pinExecutionInputOverrides,
  resetInputOverridesColumnForTests,
  withInputOverridesColumn,
} from "../execution-input-overrides.js"

beforeEach(() => {
  resetInputOverridesColumnForTests()
  db.writes.length = 0
  db.error = null
})

describe("the input_overrides column guard", () => {
  it("names the column until a missing-column error, then never again", () => {
    expect(withInputOverridesColumn("id, status")).toBe("id, status, input_overrides")
    expect(noteInputOverridesColumnError({ code: "42703" })).toBe(true)
    expect(inputOverridesColumnAbsent()).toBe(true)
    expect(withInputOverridesColumn("id, status")).toBe("id, status")
  })

  it("PostgREST's unknown-column code counts too; any other error does not", () => {
    expect(noteInputOverridesColumnError({ code: "PGRST204" })).toBe(true)
    resetInputOverridesColumnForTests()
    for (const other of [{ code: "23505" }, { code: null }, {}, null, undefined]) {
      expect(noteInputOverridesColumnError(other)).toBe(false)
    }
    expect(inputOverridesColumnAbsent()).toBe(false)
  })
})

describe("pinExecutionInputOverrides: what a run applied, on its execution", () => {
  it("writes the overrides the run applies, on that execution", async () => {
    await pinExecutionInputOverrides("exec-1", { cap: { fontSize: 72 } })
    expect(db.writes).toEqual([{ row: { input_overrides: { cap: { fontSize: 72 } } }, id: "exec-1" }])
  })

  it("a run with no overrides pins {} — 'ran with none', never 'no pin' (NULL)", async () => {
    await pinExecutionInputOverrides("exec-1", undefined)
    expect(db.writes).toEqual([{ row: { input_overrides: {} }, id: "exec-1" }])
  })

  it("before the column exists: remembered quietly, and later runs write nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.error = { code: "PGRST204", message: "Could not find the 'input_overrides' column of 'workflow_executions'" }
    await pinExecutionInputOverrides("exec-1", { a: { b: 1 } })
    await pinExecutionInputOverrides("exec-2", { a: { b: 1 } })
    expect(db.writes).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("any other error is logged, never thrown, and the next run tries again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.error = { message: "transient" }
    await expect(pinExecutionInputOverrides("exec-1", { a: { b: 1 } })).resolves.toBeUndefined()
    await pinExecutionInputOverrides("exec-2", { a: { b: 1 } })
    expect(db.writes).toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe("every site that names the column goes through the guard", () => {
  // A statement naming a column the database does not have fails WHOLE, so a
  // site that names it directly breaks every run on staging until promotion.
  const SRC = join(__dirname, "..", "..")
  const ALLOWED = new Set(["lib/execution-input-overrides.ts"])
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue
        walk(full, out)
      } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
        out.push(full)
      }
    }
    return out
  }

  /** The source with its comments removed: a comment may name the column. */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")

  it("strips comments, not code", () => {
    expect(code('/** `input_overrides` */\nconst a = 1 // input_overrides')).not.toContain("input_overrides")
    expect(code('select("id, input_overrides")')).toContain("input_overrides")
  })

  it("no backend file but the guard module names `input_overrides` in code", () => {
    const offenders = walk(SRC)
      .map((f) => relative(SRC, f).split("\\").join("/"))
      .filter((rel) => !ALLOWED.has(rel) && code(readFileSync(join(SRC, rel), "utf8")).includes("input_overrides"))
    expect(offenders).toEqual([])
  })
})
