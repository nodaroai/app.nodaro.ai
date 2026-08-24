/**
 * What a thread lets in, and what it lets out.
 *
 * Both directions had a hole. The permission to publish could be stored and
 * read but not SET — a switch with no handle, which is the third time this
 * feature has been built one layer short of reachable. And the thread row is
 * now read with `select("*")`, because naming a column a not-yet-promoted
 * migration has not added would 500 every read on staging — which makes the
 * response mapper the only thing between "a new column exists" and "a new
 * column is public".
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROUTE = readFileSync(join(__dirname, "..", "copilot.ts"), "utf8")
const STORE = readFileSync(join(__dirname, "..", "..", "copilot", "store.ts"), "utf8")

describe("a thread setting is reachable end to end", () => {
  it.each(["runMode", "autoRunLimitCredits", "allowPublishing"])(
    "%s can be set, stored, and read back",
    (setting) => {
      const column = setting
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
        .replace("run_mode", "run_mode")
      // Accepted by the route… checked INSIDE the schema, because every one of
      // these names also appears in the response mapper — a whole-file search
      // passes even when Zod would strip the field on the way in.
      const schema = /const patchThreadBody = z\.object\(\{[\s\S]*?\n\}\)/.exec(ROUTE)?.[0] ?? ""
      expect(schema.length).toBeGreaterThan(50)
      expect(schema, `${setting} missing from patchThreadBody`).toContain(`${setting}:`)
      // …written to the row…
      expect(ROUTE, `${setting} never reaches updateThreadSettings`).toMatch(
        new RegExp(`${column}: parsed\\.data\\.${setting}`),
      )
      // …and visible to the client that has to render its state.
      expect(ROUTE, `${setting} is not returned to the browser`).toContain(setting)
    },
  )
})

describe("select(\"*\") is safe only because the response is narrowed", () => {
  it("the thread row is read with a star, deliberately", () => {
    // If this stops being true the reasoning below no longer applies — but
    // naming columns explicitly would break staging on every migration, so the
    // star is the choice and the mapper is its price.
    expect(STORE).toContain('const THREAD_COLUMNS = "*"')
  })

  it("nothing spreads the raw row into a response", () => {
    // `{ ...thread }` anywhere in a reply would publish whatever column the next
    // migration adds, without anyone deciding to.
    expect(ROUTE).not.toMatch(/\.\.\.thread[,\s}]/)
    expect(ROUTE).not.toMatch(/\.\.\.updated[,\s}]/)
  })

  it("every thread response goes through the allowlist mapper", () => {
    // Property lines only — `thread:` also appears in publicThread's own
    // parameter list, which is the mapper, not a response.
    const responses = ROUTE.split(/\r?\n/)
      .filter((line) => line.includes("thread: ") && !line.includes("function"))
      .map((line) => line.trim())
    expect(responses.length).toBeGreaterThan(2)
    for (const expression of responses) {
      expect(expression, `a thread is returned without publicThread(): ${expression}`).toContain("publicThread(")
    }
  })

  it("the mapper lists its fields one by one", () => {
    const body = /function publicThread\([\s\S]*?\n}/.exec(ROUTE)?.[0] ?? ""
    expect(body).toContain("id: thread.id")
    expect(body).not.toContain("...")
  })
})
