/**
 * Web Scrape's source dropdown follows node availability.
 *
 * The Instagram source is the Instagram node's scraper behind another door, so
 * withholding that node in Admin → Availability withdraws the source too. The
 * backend decides and sends the RESULT (`webScrapeSources`); this pins what the
 * dropdown does with it: a user is not offered a withdrawn source, an admin is
 * (marked), and a node that already points at one never renders an empty select.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, act } from "@testing-library/react"
import type { ScraperActorId } from "@nodaro/shared/social"

// Radix Select needs a real popper/portal; the options are what is under test.
vi.mock("@/components/ui/select", () => ({
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div role="option" aria-selected={false} data-value={value}>
      {children}
    </div>
  ),
}))

import {
  offeredWebScrapeSources,
  WebScrapeSourceItems,
  WebScrapeSourceNotice,
} from "../web-scrape-source-options"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"

const OPTIONS: ReadonlyArray<ScraperActorId> = ["google-search", "content-crawler", "instagram", "tiktok"]
const label = (id: ScraperActorId): string => id

/** What the backend sends a USER once the Instagram node is withheld. */
const asUser = () =>
  __resetSurfaceAvailabilityForTests({ nodes: ["instagram-scrape"], models: [], webScrapeSources: { denied: ["instagram"] } })
/** …and what it sends an ADMIN. */
const asAdmin = () =>
  __resetSurfaceAvailabilityForTests({
    nodes: [],
    models: [],
    hiddenFromUsers: ["instagram-scrape"],
    webScrapeSources: { denied: [], hiddenFromUsers: ["instagram"] },
  })

const offered = () => screen.getAllByRole("option").map((o) => o.getAttribute("data-value"))

beforeEach(() => __resetSurfaceAvailabilityForTests(null))

describe("offeredWebScrapeSources", () => {
  it("offers everything while nothing is withdrawn (and before the answer lands)", () => {
    expect(offeredWebScrapeSources(OPTIONS, "google-search")).toEqual(OPTIONS)
  })

  it("drops a withdrawn source for a user", () => {
    asUser()
    expect(offeredWebScrapeSources(OPTIONS, "google-search")).toEqual(["google-search", "content-crawler", "tiktok"])
  })

  it("keeps the node's CURRENT source even when withdrawn — never an empty select", () => {
    asUser()
    expect(offeredWebScrapeSources(OPTIONS, "instagram")).toEqual(OPTIONS)
  })

  it("an admin is offered everything", () => {
    asAdmin()
    expect(offeredWebScrapeSources(OPTIONS, "google-search")).toEqual(OPTIONS)
  })
})

describe("<WebScrapeSourceItems>", () => {
  it("a user does not see the Instagram source", () => {
    asUser()
    render(<WebScrapeSourceItems options={OPTIONS} current="google-search" label={label} />)
    expect(offered()).toEqual(["google-search", "content-crawler", "tiktok"])
  })

  it("narrows when the answer lands AFTER the options rendered", () => {
    render(<WebScrapeSourceItems options={OPTIONS} current="google-search" label={label} />)
    expect(offered()).toContain("instagram")
    act(() => asUser())
    expect(offered()).not.toContain("instagram")
  })

  it("a node already on the withdrawn source shows it, tagged as not available", () => {
    asUser()
    render(<WebScrapeSourceItems options={OPTIONS} current="instagram" label={label} />)
    const current = screen.getAllByRole("option").find((o) => o.getAttribute("data-value") === "instagram")
    expect(current?.textContent).toMatch(/not available/i)
  })

  it("an admin sees the source, marked ADMIN — and untagged, because for them it works", () => {
    asAdmin()
    render(<WebScrapeSourceItems options={OPTIONS} current="google-search" label={label} />)
    const ig = screen.getAllByRole("option").find((o) => o.getAttribute("data-value") === "instagram")
    expect(ig?.textContent).toContain("ADMIN")
    expect(ig?.textContent).not.toMatch(/not available/i)
    // Only the withheld source is marked.
    const google = screen.getAllByRole("option").find((o) => o.getAttribute("data-value") === "google-search")
    expect(google?.textContent).not.toContain("ADMIN")
  })
})

describe("<WebScrapeSourceNotice>", () => {
  it("says why the run will be refused, only for a node on a withdrawn source", () => {
    asUser()
    const { rerender } = render(<WebScrapeSourceNotice actor="instagram" />)
    expect(screen.getByRole("status").textContent).toMatch(/not available on this deployment/i)
    rerender(<WebScrapeSourceNotice actor="google-search" />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("stays silent for an admin", () => {
    asAdmin()
    render(<WebScrapeSourceNotice actor="instagram" />)
    expect(screen.queryByRole("status")).toBeNull()
  })
})
