import { describe, it, expect } from "vitest"
import type { CompetitorDiscovery, TrackedCompetitor } from "@nodaro/shared/social"
import { competitorScanPages } from "@nodaro/shared/social"
import { aboutTermsOf } from "../brand-platforms"
import { changedFields, emptyForm, formFrom, inputFrom, mergeDiscovery, termCapOf } from "../competitor-form"
import { scanLanded, scanStateOf } from "../scan-state"
import { addTerms } from "../search-terms-field"

const ACME: TrackedCompetitor = {
  id: "c1",
  brand: "Acme Paint",
  website: "https://acme.example/",
  accounts: { tiktok: "acmepaint", instagram: "acme" },
  aboutPlatforms: ["reddit", "x"],
  isOwn: false,
  schedule: "weekly",
  nextScanAt: null,
  lastScanAt: null,
  lastScanId: null,
  lastScanError: null,
  scanning: false,
  searches: 4,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
}

describe("changedFields", () => {
  it("sends only what the edit changed, and never an unchanged schedule", () => {
    const form = formFrom(ACME)
    expect(changedFields(ACME, inputFrom(form))).toEqual({})
    expect(changedFields(ACME, inputFrom({ ...form, brand: "Acme Paints" }))).toEqual({ brand: "Acme Paints" })
    expect(changedFields(ACME, inputFrom({ ...form, aboutPlatforms: ["x", "reddit"] }))).toEqual({})
    expect(changedFields(ACME, inputFrom({ ...form, schedule: "daily" }))).toEqual({ schedule: "daily" })
  })

  it("sends the whole account set when one account changes, so the others are kept", () => {
    const form = formFrom(ACME)
    expect(changedFields(ACME, inputFrom({ ...form, accounts: { ...form.accounts, x: "acmex" } }))).toEqual({
      accounts: { tiktok: "acmepaint", instagram: "acme", x: "acmex" },
    })
    expect(changedFields(ACME, inputFrom({ ...form, accounts: { ...form.accounts, instagram: "" } }))).toEqual({ accounts: { tiktok: "acmepaint" } })
  })
})

describe("inputFrom", () => {
  it("needs only a name: the website is sent as empty, never required", () => {
    expect(inputFrom({ ...emptyForm(), brand: "  Corvo " })).toEqual({
      brand: "Corvo",
      website: "",
      accounts: {},
      aboutPlatforms: ["tiktok", "instagram", "youtube", "x", "reddit"],
      schedule: "weekly",
      isOwn: false,
    })
  })

  it("sends the search terms, cleaned, only to a server that takes them", () => {
    const form = { ...emptyForm(), brand: "Corvo", searchTerms: [" #corvo ", "corvo  bikes", "#CORVO"] }
    expect(inputFrom(form, true).searchTerms).toEqual(["#corvo", "corvo bikes"])
    expect(inputFrom(form)).not.toHaveProperty("searchTerms")
  })
})

describe("search terms", () => {
  it("splits what was typed, keeps it clean and stops at the plan's cap", () => {
    expect(addTerms([], "#a, b  c,\n#A, d", 2)).toEqual(["#a", "b c"])
    expect(addTerms(["x"], "", 3)).toEqual(["x"])
    // Terms past the cap (kept from a higher plan) stay; nothing is added.
    expect(addTerms(["a", "b", "c"], "d", 2)).toEqual(["a", "b", "c"])
  })

  it("reads the plan's cap: none sent is the name only, null is no cap", () => {
    expect(termCapOf(undefined)).toBe(0)
    expect(termCapOf(null)).toBe(0)
    expect(termCapOf({ searchTerms: 3 })).toBe(3)
    expect(termCapOf({ searchTerms: null })).toBeNull()
  })

  it("prices the scan by pages: each about-platform once per term the plan searches", () => {
    const form = { ...emptyForm(), accounts: { ...emptyForm().accounts, tiktok: "corvo" }, aboutPlatforms: ["x", "reddit"] as const, searchTerms: ["a", "b", "c"] }
    expect(competitorScanPages({ ...form, termCap: termCapOf({ searchTerms: 2 }) })).toBe(1 + 2 * 2)
    expect(competitorScanPages({ ...form, termCap: termCapOf(null) })).toBe(1 + 2)
  })

  it("sends changed terms on an edit, and nothing when they are the same", () => {
    const withTerms = { ...ACME, searchTerms: ["#acme", "acme paint"] }
    const form = formFrom(withTerms)
    expect(changedFields(withTerms, inputFrom(form, true))).toEqual({})
    // Order counts: the plan searches the first ones.
    expect(changedFields(withTerms, inputFrom({ ...form, searchTerms: ["acme paint", "#acme"] }, true))).toEqual({ searchTerms: ["acme paint", "#acme"] })
    expect(changedFields(ACME, inputFrom({ ...formFrom(ACME), searchTerms: ["#acme"] }, true))).toEqual({ searchTerms: ["#acme"] })
  })

  it("shows the terms the next scan searches, and none when the name is searched", () => {
    expect(aboutTermsOf(ACME)).toEqual([])
    expect(aboutTermsOf({ searchTerms: ["#a", "b"] })).toEqual(["#a", "b"])
    expect(
      aboutTermsOf({
        searchTerms: ["#a", "b", "c"],
        searchPlan: [
          { kind: "about", platform: "x", term: "#a" },
          { kind: "about", platform: "reddit", term: "#a" },
          { kind: "about", platform: "x", term: "b" },
        ],
      }),
    ).toEqual(["#a", "b"])
  })
})

describe("mergeDiscovery", () => {
  const found: CompetitorDiscovery = {
    brand: "Boltly",
    website: "https://boltly.example/",
    accounts: { tiktok: { value: "boltly", from: "guess" }, instagram: { value: "boltly", from: "site" }, x: { value: "boltlyhq", from: "guess" } },
  }

  it("fills only empty accounts, so what was typed during the lookup stays", () => {
    const typed = { ...emptyForm(), accounts: { ...emptyForm().accounts, tiktok: "typed" } }
    const merged = mergeDiscovery(typed, found)
    expect(merged.accounts).toMatchObject({ tiktok: "typed", instagram: "boltly", x: "boltlyhq" })
    expect([...merged.guessed]).toEqual(["x"])
    expect(merged.brand).toBe("Boltly")
  })

  it("keeps the badge of an earlier guess on a second lookup", () => {
    const first = mergeDiscovery(emptyForm(), found)
    const second = mergeDiscovery(first, { ...found, accounts: {} })
    expect([...second.guessed].sort()).toEqual(["tiktok", "x"])
  })
})

describe("scanLanded", () => {
  const scanning = (id: string, lastScanId: string | null = null): TrackedCompetitor => ({ ...ACME, id, scanning: true, lastScanId })
  const done = (id: string, lastScanId: string): TrackedCompetitor => ({ ...ACME, id, scanning: false, lastScanId })

  it("sees one brand's scan land while another still runs", () => {
    const before = scanStateOf([scanning("a"), scanning("b")])
    expect(scanLanded(before, [done("a", "scan-a2"), scanning("b")])).toBe(true)
    expect(scanLanded(before, [scanning("a"), scanning("b")])).toBe(false)
  })

  it("sees a new last scan even when the running state was never seen", () => {
    const before = scanStateOf([done("a", "scan-a1")])
    expect(scanLanded(before, [done("a", "scan-a2")])).toBe(true)
    expect(scanLanded(before, [done("a", "scan-a1"), done("new", "scan-n1")])).toBe(false)
  })
})
