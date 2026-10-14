import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WebScrapeConfig } from "../scraper-configs"
import { translate } from "@/lib/i18n"
import { SCRAPER_CREDIT_COSTS } from "@nodaro/shared/social"

// What the server charges for each price row. The table is only the fallback.
const serverPrices = vi.hoisted(() => ({ current: {} as Record<string, number> }))
vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: (id: string | undefined, fallback = 0) => (id ? serverPrices.current[id] : undefined) ?? fallback,
}))
import type { WebScrapeNodeData } from "@/types/nodes"

// The panel's field labels are localized; assert against the English
// resolution of the very key the panel renders, not a hand-copied literal.
const en = (key: Parameters<typeof translate>[1]) => translate("en", key)

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor, ...props }: any) => (
    <label htmlFor={htmlFor} {...props}>
      {children}
    </label>
  ),
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))

// Wrap children in a nested <label> so getByLabelText resolves via nesting,
// independent of the real MappableField's triggerId/context wiring.
vi.mock("../mappable-field", () => ({
  MappableField: ({ label, children }: any) => (
    <label>
      {label}
      {children}
    </label>
  ),
}))

// Select mock: pick up `id` from SelectTrigger (as real component passes it) so
// the rendered <select> has the id getByLabelText needs.
vi.mock("@/components/ui/select", () => {
  const React = require("react")
  return {
    Select: ({ children, value, onValueChange }: any) => {
      let triggerId: string | undefined
      const items: any[] = []
      React.Children.forEach(children, (child: any) => {
        if (!child) return
        if (child.type?.displayName === "SelectTrigger" || child.props?.__trigger) {
          triggerId = child.props?.id
        }
        if (child.type?.displayName === "SelectContent" || child.props?.__content) {
          React.Children.forEach(child.props.children, (item: any) => {
            if (item) items.push(item)
          })
        }
      })
      return (
        <select
          id={triggerId}
          value={value}
          onChange={(e: any) => onValueChange?.(e.target.value)}
        >
          {items}
        </select>
      )
    },
    SelectContent: Object.assign(({ children }: any) => <>{children}</>, {
      displayName: "SelectContent",
    }),
    SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
    SelectTrigger: Object.assign(
      ({ children, id }: any) => <span data-id={id}>{children}</span>,
      { displayName: "SelectTrigger" },
    ),
    SelectValue: () => null,
  }
})

function renderPanel(data: Partial<WebScrapeNodeData> = {}) {
  const onUpdate = vi.fn()
  render(
    <WebScrapeConfig
      data={{ label: "Web Scrape", actor: "google-search", ...data } as WebScrapeNodeData}
      onUpdate={onUpdate}
      sources={[]}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
    />,
  )
  return { onUpdate }
}

describe("WebScrapeConfig", () => {
  it("renders Google Search fields by default", () => {
    renderPanel()
    expect(screen.getByLabelText(en("cfgext.scrapeQuery"))).toBeInTheDocument()
    expect(screen.queryByLabelText(en("cfgext.scrapeStartUrl"))).not.toBeInTheDocument()
  })

  it("content-crawler actor reveals URL field and crawl mode", () => {
    renderPanel({ actor: "content-crawler", url: "https://example.com" })
    expect(screen.getByLabelText(en("cfgext.scrapeStartUrl"))).toBeInTheDocument()
    expect(screen.getByLabelText(en("cfgext.scrapeCrawlMode"))).toBeInTheDocument()
  })

  // The two crawl-mode labels carried their own price literals (3 and 10) and
  // were never touched when prices moved: "Site crawl … (10 CR)" sat beside a
  // panel button reading 55 — the figure that was charged.
  const crawlModeLabels = () => {
    const options = [...(screen.getByLabelText(en("cfgext.scrapeCrawlMode")) as HTMLSelectElement).options]
    return (value: string) => options.find((o) => o.value === value)?.textContent ?? ""
  }

  it("quotes each crawl mode at the CHARGED figure, by the price row the Run buttons use", () => {
    serverPrices.current = { "web-scrape:content-crawler": 11, "web-scrape:content-crawler:site": 55 }
    renderPanel({ actor: "content-crawler", url: "https://example.com" })
    const label = crawlModeLabels()
    expect(label("page")).toContain("(11 ")
    expect(label("site")).toContain("(55 ")
  })

  it("falls back to the shared table while the price loads — never to a literal of its own", () => {
    serverPrices.current = {}
    renderPanel({ actor: "content-crawler", url: "https://example.com" })
    const label = crawlModeLabels()
    expect(label("page")).toContain(`(${SCRAPER_CREDIT_COSTS["web-scrape:content-crawler"]} `)
    expect(label("site")).toContain(`(${SCRAPER_CREDIT_COSTS["web-scrape:content-crawler:site"]} `)
  })

  it("instagram actor shows target URL field", () => {
    renderPanel({ actor: "instagram", target: "https://instagram.com/nasa" })
    expect(screen.getByLabelText(en("cfgext.scrapeTarget"))).toBeInTheDocument()
  })

  it("changes propagate via onUpdate", () => {
    const { onUpdate } = renderPanel()
    fireEvent.change(screen.getByLabelText(en("cfgext.scrapeQuery")), { target: { value: "ai news" } })
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ query: "ai news" }))
  })
})
