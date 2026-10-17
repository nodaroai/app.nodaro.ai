import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { expectedUpdatedAtSchema } from "../optimistic-token-schema.js"
import { unitRouteFiles } from "../unit-source-files.js"

const ROUTES_DIR = join(__dirname, "..", "..", "routes")
const REPO = join(__dirname, "..", "..", "..", "..")

describe("expectedUpdatedAtSchema", () => {
  it("accepts the timestamp exactly as the database hands it out", () => {
    expect(expectedUpdatedAtSchema.safeParse("2026-09-16T09:46:43.943444+00:00").success).toBe(true)
    expect(expectedUpdatedAtSchema.safeParse("2026-09-16T09:46:43.943Z").success).toBe(true)
    expect(expectedUpdatedAtSchema.safeParse("2026-09-16T12:46:43+03:00").success).toBe(true)
    expect(expectedUpdatedAtSchema.safeParse(undefined).success).toBe(true)
  })

  it("still rejects a value that is not a datetime", () => {
    expect(expectedUpdatedAtSchema.safeParse("yesterday").success).toBe(false)
    expect(expectedUpdatedAtSchema.safeParse("2026-09-16").success).toBe(false)
    expect(expectedUpdatedAtSchema.safeParse(1758000000).success).toBe(false)
  })

  it("no route validates the token with the offset-blind bare form", () => {
    // The routes/ files, plus every node unit's route.
    const files = [...readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts")).map((f) => join(ROUTES_DIR, f)), ...unitRouteFiles(REPO)]
    const offenders = files
      .filter((f) => /expectedUpdatedAt:\s*z\.string\(\)\.datetime\(\)/.test(readFileSync(f, "utf8")))
      .map((f) => relative(REPO, f))
    expect(offenders, "use expectedUpdatedAtSchema from lib/optimistic-token-schema.ts").toEqual([])
  })
})
