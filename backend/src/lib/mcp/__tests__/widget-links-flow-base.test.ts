import { describe, it, expect, vi } from "vitest"

vi.mock("../../deployment-urls.js", () => ({
  appBaseUrl: () => "https://app.test",
  flowBaseUrl: () => "https://flow.test",
  mcpBaseUrl: () => "https://mcp.test",
  workflowEditorUrl: (id: string) => `https://flow.test/editor/${id}`,
}))

// The widgets link a person to the app's own pages: the gallery opens on the
// host those pages live on, never on the API host a deployment keeps.
describe("the MCP widgets' gallery link", () => {
  it("opens on the app's own host", async () => {
    const { buildSingleJobWidget } = await import("../widgets/single-job.js")
    const html = buildSingleJobWidget("image")
    expect(html).toContain("https://flow.test/gallery")
    expect(html).not.toContain("https://app.test/gallery")
  })
})
