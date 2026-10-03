import { describe, it, expect } from "vitest"
import type { CompetitorDiscovery, TrackedCompetitor } from "@nodaro/shared"
import { changedFields, emptyForm, formFrom, inputFrom, mergeDiscovery } from "../competitor-form-dialog"
import { scanLanded, scanStateOf } from "../scan-state"

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
