/**
 * The brand form with no cap on search terms (a platform admin): every term is
 * searched, the note says what bounds them (one scan's size), and a brand
 * whose scan would run more searches than a scan may cannot be saved.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { COMPETITOR_SCAN_SEARCH_LIMIT, type TrackedCompetitor } from "@nodaro/shared/social"
import { en } from "@/lib/i18n/en"

vi.mock("@/hooks/queries/use-competitors-queries", () => ({ useCompetitorLimits: () => ({ data: { searchTerms: null } }) }))
vi.mock("../scan-price", () => ({ useScanPagesPrice: () => 0 }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { CompetitorFormDialog } from "../competitor-form-dialog"

const SIX = ["tiktok", "instagram", "youtube", "x", "reddit", "linkedin"] as const

function brand(terms: number): TrackedCompetitor {
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    brand: "Acme Paint",
    website: "",
    accounts: { tiktok: "acmepaint" },
    aboutPlatforms: [...SIX],
    isOwn: false,
    schedule: "off",
    nextScanAt: null,
    lastScanAt: null,
    lastScanId: null,
    lastScanError: null,
    scanning: false,
    searches: 0,
    searchTerms: Array.from({ length: terms }, (_, i) => `term ${i}`),
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  }
}

function fill(template: string, values: Record<string, number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template)
}

function open(editing: TrackedCompetitor) {
  render(<CompetitorFormDialog open editing={editing} onOpenChange={() => {}} onSubmit={() => {}} />)
}

describe("the brand form with no cap on terms", () => {
  it("says terms are bounded only by one scan's size, and saves a scan that fits", () => {
    // One account and six platforms: sixteen terms are 1 + 6 × 16 = 97 searches.
    open(brand(16))
    expect(screen.getByText(fill(en["competitors.searchTermsNoCap"], { max: COMPETITOR_SCAN_SEARCH_LIMIT }))).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("button", { name: en["common.save"] }).hasAttribute("disabled")).toBe(false)
    // Every term is searched: none is struck through as past a cap.
    expect(screen.getByText("term 15").className).not.toContain("line-through")
  })

  it("will not save a scan of more searches than a scan may run, saying how many", () => {
    // Twenty terms on six platforms and an account: 1 + 6 × 20 = 121.
    open(brand(20))
    expect(screen.getByRole("alert").textContent).toBe(fill(en["competitors.scanTooBig"], { n: 121, max: COMPETITOR_SCAN_SEARCH_LIMIT }))
    expect(screen.getByRole("button", { name: en["common.save"] }).hasAttribute("disabled")).toBe(true)
  })
})
