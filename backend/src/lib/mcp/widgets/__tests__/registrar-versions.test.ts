import { describe, it, expect } from "vitest"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WIDGET_URI, registerWidgetResources } from "../registrar.js"
import { mcpLaneAddresses } from "../../../mcp-lane-addresses.js"

/**
 * A widget page that changed is published under a new URI version, since a host keeps the page it
 * fetched for a URI; the versions before it keep answering, with the current page, for a client
 * whose stored tool list still names them.
 */
type Read = (uri: URL) => Promise<{ contents: { text: string }[] }>

function registered(): Map<string, Read> {
  const pages = new Map<string, Read>()
  const server = { registerResource: (_name: string, uri: string, _meta: unknown, read: Read) => void pages.set(uri, read) }
  registerWidgetResources(server as unknown as McpServer, mcpLaneAddresses())
  return pages
}

describe("widget resource versions", () => {
  it("the current version is v5, and the job card it serves has the price-quote state", async () => {
    expect(WIDGET_URI.jobVideo).toBe("ui://nodaro/widget/v5/job-video")
    const page = await registered().get(WIDGET_URI.jobVideo)!(new URL(WIDGET_URI.jobVideo))
    expect(page.contents[0]!.text).toContain("quote-price")
  })

  it.each(["ui://nodaro/widget/job-video", "ui://nodaro/widget/v2/job-video", "ui://nodaro/widget/v3/job-video", "ui://nodaro/widget/v4/job-video"])(
    "%s still answers, with the current page",
    async (uri) => {
      const pages = registered()
      const current = await pages.get(WIDGET_URI.jobVideo)!(new URL(WIDGET_URI.jobVideo))
      const old = await pages.get(uri)!(new URL(uri))
      expect(old.contents[0]!.text).toBe(current.contents[0]!.text)
    },
  )
})
