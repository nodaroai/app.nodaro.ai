import { describe, it, expect } from "vitest"
import { jobPlatform } from "../job-platform"

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
