// @vitest-environment node
// @test-watches supabase/tests/fixtures/job-platform-cases.json
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { jobPlatform } from "../job-platform"

/**
 * The case table is shared with the SQL mirror (`public.job_platform_key`,
 * migration 575, proved against the same fixture), so the admin Jobs list's
 * server-side platform filter groups a job exactly as this label does. App
 * cases are skipped here: the server keys a developer app by its id, this
 * function by the app's resolved name.
 */
interface PlatformCase {
  label: string
  source: string | null
  sourceDetail: string | null
  expected: string
}
const CASES = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../supabase/tests/fixtures/job-platform-cases.json", import.meta.url)),
    "utf8",
  ),
) as PlatformCase[]
const SHARED_CASES = CASES.filter((c) => c.source !== "app")

describe("jobPlatform — one key rule for SQL and TypeScript", () => {
  it("has cases to check", () => expect(SHARED_CASES.length).toBeGreaterThan(4))

  for (const c of SHARED_CASES) {
    it(c.label, () => {
      expect(jobPlatform({ source: c.source, source_detail: c.sourceDetail }).key).toBe(c.expected)
    })
  }
})

describe("jobPlatform", () => {
  it("maps a Nodaro web subdomain to its product", () => {
    expect(jobPlatform({ source: "web", source_detail: "studio.nodaro.ai" })).toEqual({
      key: "web:studio",
      label: "studio",
    })
    expect(jobPlatform({ source: "web", source_detail: "recast.nodaro.ai" }).label).toBe("recast")
    expect(jobPlatform({ source: "web", source_detail: "voice.nodaro.ai" }).label).toBe("voice")
  })

  it("maps the main app host to 'app'", () => {
    expect(jobPlatform({ source: "web", source_detail: "app.nodaro.ai" })).toEqual({
      key: "web:app",
      label: "app",
    })
  })

  it("collapses an env-prefixed subdomain to the product", () => {
    expect(jobPlatform({ source: "web", source_detail: "next.studio.nodaro.ai" }).label).toBe("studio")
  })

  it("keeps a non-nodaro / localhost host whole (never splits the port)", () => {
    expect(jobPlatform({ source: "web", source_detail: "localhost:3000" })).toEqual({
      key: "web:localhost:3000",
      label: "localhost:3000",
    })
    expect(jobPlatform({ source: "web", source_detail: "nodaro.acme.internal" }).label).toBe(
      "nodaro.acme.internal",
    )
  })

  it("uses the resolved app name for developer-app jobs, else a generic 'app'", () => {
    expect(jobPlatform({ source: "app", source_detail: "app_123", source_app_name: "Acme Bot" })).toEqual({
      key: "app:Acme Bot",
      label: "Acme Bot",
    })
    expect(jobPlatform({ source: "app", source_detail: "app_123", source_app_name: null })).toEqual({
      key: "app",
      label: "app",
    })
  })

  it("groups other coarse kinds as themselves", () => {
    expect(jobPlatform({ source: "api" })).toEqual({ key: "api", label: "api" })
    expect(jobPlatform({ source: "mcp", source_detail: "claude" }).label).toBe("mcp")
    expect(jobPlatform({ source: "cli" }).label).toBe("cli")
    expect(jobPlatform({ source: "web" }).label).toBe("web") // web with no detail
  })

  it("returns an em-dash group for rows with no source", () => {
    expect(jobPlatform({ source: null })).toEqual({ key: "unknown", label: "—" })
    expect(jobPlatform({})).toEqual({ key: "unknown", label: "—" })
  })
})
