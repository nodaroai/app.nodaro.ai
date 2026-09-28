/**
 * Links from the app to the public docs point at nodaro.ai/docs, not the old
 * GitHub Pages copy (item 16 of the docs rebuild), through one helper with the
 * node pages' origin, `ref` and language rules.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { docsUrlForPage } from "../node-docs"

describe("docsUrlForPage", () => {
  it("builds a docs page link with ref and language", () => {
    expect(docsUrlForPage("mcp", { lang: "he" })).toBe("https://nodaro.ai/docs/mcp?lang=he&ref=app")
    expect(docsUrlForPage("/mcp/troubleshooting/")).toBe("https://nodaro.ai/docs/mcp/troubleshooting?ref=app")
    expect(docsUrlForPage("")).toBe("https://nodaro.ai/docs?ref=app")
  })

  it.each([
    "../../../app/mcp/page.tsx",
    "../../../app/(dashboard)/settings/api/page.tsx",
    "../../../components/oauth/McpConsentNotice.tsx",
    "../../../components/dashboard/home/your-path-section.tsx",
  ])("%s links the docs site, not GitHub Pages", (file) => {
    expect(readFileSync(resolve(__dirname, file), "utf8")).not.toContain("nodaroai.github.io")
  })
})
