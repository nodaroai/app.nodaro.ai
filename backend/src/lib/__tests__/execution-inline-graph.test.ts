import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect, beforeEach } from "vitest"
import {
  inlineGraphCleared,
  inlineGraphColumnAbsent,
  noteInlineGraphColumnError,
  resetInlineGraphColumnForTests,
  withInlineGraphColumns,
} from "../execution-inline-graph.js"

const SRC = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : []
  })
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("execution-inline-graph column guard (migration 509)", () => {
  beforeEach(() => resetInlineGraphColumnForTests())

  it("names both columns until a missing-column error, then never again", () => {
    expect(withInlineGraphColumns("id, status")).toBe("id, status, inline_graph, wrapper_job_id")
    expect(noteInlineGraphColumnError({ code: "42703", message: 'column workflow_executions.inline_graph does not exist' })).toBe(true)
    expect(inlineGraphColumnAbsent()).toBe(true)
    expect(withInlineGraphColumns("id, status")).toBe("id, status")
  })

  it("counts PGRST204 naming either column, and nothing else", () => {
    expect(noteInlineGraphColumnError({ code: "PGRST204", message: "Could not find the 'wrapper_job_id' column" })).toBe(true)
    resetInlineGraphColumnForTests()
    expect(noteInlineGraphColumnError({ code: "42703", message: "column foo does not exist" })).toBe(false)
    expect(noteInlineGraphColumnError({ code: "23505", message: "inline_graph" })).toBe(false)
    expect(noteInlineGraphColumnError(null)).toBe(false)
    expect(noteInlineGraphColumnError({})).toBe(false)
    expect(inlineGraphColumnAbsent()).toBe(false)
  })

  it("erases the snapshot to an empty object (the graph-source CHECK forbids NULL on an inline row), and drops it while absent", () => {
    expect(inlineGraphCleared()).toEqual({ inline_graph: {} })
    expect(inlineGraphCleared()).not.toBe(inlineGraphCleared())
    noteInlineGraphColumnError({ code: "42703", message: "inline_graph" })
    expect(inlineGraphCleared()).toEqual({})
  })

  it("is the only backend source file that names either column", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.endsWith(join("lib", "execution-inline-graph.ts")))
      .filter((f) => /\b(inline_graph|wrapper_job_id)\b/.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => relative(SRC, f))
    expect(offenders).toEqual([])
  })
})
