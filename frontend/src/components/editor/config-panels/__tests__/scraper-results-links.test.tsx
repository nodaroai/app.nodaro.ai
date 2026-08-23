/**
 * Web Scrape results are links (#779): every row opens its source in a new
 * tab; scraped URLs are untrusted, so only http(s) ever becomes an anchor.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { WebScrapeResultsTab } from "../scraper-configs"
import type { WebScrapeNodeData } from "@/types/nodes"

const data = (generatedJson: unknown, actor: WebScrapeNodeData["actor"] = "google-search"): WebScrapeNodeData =>
  ({ label: "Web Scrape", actor, generatedJson } as unknown as WebScrapeNodeData)

describe("WebScrapeResultsTab links", () => {
  it("renders each google-search result as a new-tab link — title and URL sub-line — with rel=noopener noreferrer", () => {
    render(
      <WebScrapeResultsTab
        data={data([
          { title: "Nodaro docs", url: "https://nodaroai.github.io/app.nodaro.ai/", description: "d" },
          { title: "Hostile", url: "javascript:alert(1)", description: "d" },
          { title: "Data", url: "data:text/html,hi", description: "d" },
        ])}
      />,
    )
    const links = screen.getAllByRole("link")
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://nodaroai.github.io/app.nodaro.ai/",
      "https://nodaroai.github.io/app.nodaro.ai/",
    ])
    for (const a of links) {
      expect(a).toHaveAttribute("target", "_blank")
      expect(a).toHaveAttribute("rel", "noopener noreferrer")
    }
    // The hostile rows render as text, never as anchors.
    expect(screen.getByText("Hostile").tagName).toBe("SPAN")
    expect(screen.getByText("Data").tagName).toBe("SPAN")
  })

  it("tiktok links the video page (webVideoUrl) and an item with no link stays plain text", () => {
    render(
      <WebScrapeResultsTab
        data={data([
          { text: "dance", webVideoUrl: "https://www.tiktok.com/@x/video/1" },
          { text: "no link" },
        ], "tiktok")}
      />,
    )
    expect(screen.getByRole("link", { name: "dance" })).toHaveAttribute("href", "https://www.tiktok.com/@x/video/1")
    expect(screen.getByText("no link").tagName).toBe("SPAN")
  })
})
