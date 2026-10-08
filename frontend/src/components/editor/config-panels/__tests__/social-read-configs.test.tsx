/**
 * The post readers' settings: a competitor's platform falls back to "all" in
 * the node DATA (not only on screen) when the brand is not read there — a
 * stale platform would make every run read nothing — and a day's hint names
 * the zone the server will read it in.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const brands = vi.hoisted(() => ({
  list: [
    { id: "b1", brand: "Acme", accounts: { instagram: "acme" }, aboutPlatforms: ["x"] },
  ] as unknown[],
}))
vi.mock("@/hooks/queries/use-competitors-queries", () => ({
  useCompetitors: () => ({ data: brands.list, isLoading: false }),
}))

import { CompetitorReadConfig, InspirationReadConfig } from "../social-read-configs"
import type { CompetitorReadData, InspirationReadData } from "@/types/nodes"

/** The props every settings panel gets that these two do not read. */
const REST = { sources: [], fieldMappings: {}, onMapField: () => {}, nodes: [] }

const competitor = (over: Partial<CompetitorReadData> = {}): CompetitorReadData => ({
  label: "Read Competitor",
  competitorId: "b1",
  platform: "all",
  role: "all",
  period: "window",
  windowAmount: 7,
  windowUnit: "days",
  limit: 20,
  order: "newest",
  ...over,
})

function renderConfig(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe("CompetitorReadConfig", () => {
  it("a platform the brand is not read on falls back to all, in the node data", () => {
    const onUpdate = vi.fn()
    renderConfig(<CompetitorReadConfig data={competitor({ platform: "reddit" })} onUpdate={onUpdate} {...REST} />)
    expect(onUpdate).toHaveBeenCalledWith({ platform: "all" })
  })

  it("a platform the brand is read on stays", () => {
    const onUpdate = vi.fn()
    renderConfig(<CompetitorReadConfig data={competitor({ platform: "x" })} onUpdate={onUpdate} {...REST} />)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe("InspirationReadConfig", () => {
  const inspiration = (over: Partial<InspirationReadData> = {}): InspirationReadData => ({
    label: "Read Inspiration",
    platform: "all",
    tag: "",
    period: "day",
    windowAmount: 7,
    windowUnit: "days",
    day: "2026-10-06",
    limit: 20,
    order: "newest",
    ...over,
  })

  it("a day's hint names the zone the server reads it in: the stored one, else UTC", () => {
    const { unmount } = renderConfig(<InspirationReadConfig data={inspiration({ timezone: "Asia/Jerusalem" })} onUpdate={vi.fn()} {...REST} />)
    expect(screen.getByText(/Asia\/Jerusalem/)).toBeInTheDocument()
    unmount()
    renderConfig(<InspirationReadConfig data={inspiration()} onUpdate={vi.fn()} {...REST} />)
    expect(screen.getByText(/time zone UTC/)).toBeInTheDocument()
  })
})
