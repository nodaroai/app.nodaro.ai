// @test-watches backend/src/**/*.ts
/**
 * `jobs.server_output` (migration 695) is read and written in ONE place
 * (decided 2026-11-22): `lib/job-server-output-column.ts`, so every string in
 * `backend/src` that names the column must be in that module. Part 2 pins
 * what it asks for.
 */
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { eachSourceFile, lineOf, walk } from "./source-scan.js"
import { withServerOutput } from "../job-server-output-column.js"

const HELPER = "lib/job-server-output-column.ts"

describe("server_output is named in one module", () => {
  it("no string outside the helper names the column", () => {
    const found: string[] = []
    eachSourceFile(["server_output"], (sf, rel) => {
      if (rel === HELPER) return
      walk(sf, (n) => {
        const text = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
          ? n.text
          : undefined
        if (text !== undefined && /\bserver_output\b/.test(text)) found.push(`${rel}:${lineOf(sf, n)}`)
      })
    })
    expect(found).toEqual([])
  })
})

describe("what the helper asks for", () => {
  it("a read asks for the column beside the caller's own, once", async () => {
    const asked: string[] = []
    await withServerOutput("id", async (cols) => { asked.push(cols); return { data: [], error: null } })
    expect(asked).toEqual(["id, server_output"])
  })

  it("any error is the query's own and is answered as it is", async () => {
    const asked: string[] = []
    const answer = await withServerOutput("id", async (cols) => { asked.push(cols); return { data: null, error: { code: "57014", message: "timeout" } } })
    expect(asked).toEqual(["id, server_output"])
    expect(answer.error?.code).toBe("57014")
  })
})
