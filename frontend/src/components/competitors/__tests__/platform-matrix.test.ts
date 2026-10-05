import { describe, expect, it } from "vitest"
import type { CompetitorBrandTally, CompetitorPlatformTally, TrackedCompetitor } from "@nodaro/shared"
import { barShare, buildMatrix, cellOf, latestScanAt, plannedOn, scanOutcome, sortRows } from "../platform-matrix"

function competitor(id: string, overrides: Partial<TrackedCompetitor> = {}): TrackedCompetitor {
  return {
    id,
    brand: `Brand ${id}`,
    website: "",
    accounts: {},
    aboutPlatforms: [],
    isOwn: false,
    schedule: "weekly",
    nextScanAt: null,
    lastScanAt: "2026-10-01T10:00:00Z",
    lastScanId: `scan-${id}`,
    lastScanError: null,
    scanning: false,
    searches: 0,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  }
}

function tally(platform: CompetitorPlatformTally["platform"], overrides: Partial<CompetitorPlatformTally> = {}): CompetitorPlatformTally {
  return { platform, own: 0, about: 0, searched: [], failed: [], usual: null, unit: null, top: null, ...overrides }
}

const scanned = (platforms: CompetitorPlatformTally[], at = "2026-10-01T10:00:00Z"): CompetitorBrandTally => ({ scanId: "s", at, platforms })

describe("cellOf", () => {
  const acme = competitor("a", { searchPlan: [{ kind: "own", platform: "tiktok" }, { kind: "about", platform: "tiktok" }, { kind: "about", platform: "reddit" }] })

  it("reads what the latest scan found, and marks a search that failed", () => {
    const brand = scanned([
      tally("tiktok", { own: 5, about: 2, searched: ["own", "about"], failed: ["about"] }),
      tally("reddit", { searched: ["about"], failed: ["about"] }),
    ])
    expect(cellOf(acme, brand, "tiktok", false)).toMatchObject({ state: "partial", own: 5, about: 2, failed: ["about"], reads: { own: true, about: true } })
    expect(cellOf(acme, brand, "reddit", false)).toMatchObject({ state: "failed", reads: { own: false, about: true } })
  })

  it("does not call a search failed when the scan could not tell", () => {
    const brand = scanned([tally("tiktok", { own: 3, searched: ["own"], failed: null })])
    expect(cellOf(acme, brand, "tiktok", false)).toMatchObject({ state: "tracked", failed: [] })
  })

  it("waits for the next scan on a platform added since, and shows nothing where nothing is read", () => {
    const brand = scanned([tally("tiktok", { own: 1, searched: ["own"] })])
    expect(cellOf(acme, brand, "reddit", false).state).toBe("pending")
    expect(cellOf(acme, brand, "x", false).state).toBe("none")
    expect(cellOf(acme, undefined, "tiktok", true).state).toBe("loading")
  })
})

describe("plannedOn", () => {
  it("reads the server's plan, else the brand's accounts and platforms", () => {
    expect(plannedOn(competitor("a", { searchPlan: [{ kind: "about", platform: "x" }] }), "x")).toEqual(["about"])
    const older = competitor("b", { accounts: { tiktok: "acme", x: " " }, aboutPlatforms: ["tiktok", "reddit"] })
    expect(plannedOn(older, "tiktok")).toEqual(["own", "about"])
    expect(plannedOn(older, "x")).toEqual([])
    expect(plannedOn(older, "reddit")).toEqual(["about"])
  })
})

describe("buildMatrix", () => {
  const a = competitor("a", { searchPlan: [{ kind: "own", platform: "tiktok" }, { kind: "about", platform: "reddit" }] })
  const b = competitor("b", { searchPlan: [{ kind: "own", platform: "meta_ads" }] })
  const brands = {
    a: scanned([tally("tiktok", { own: 4, searched: ["own"] }), tally("reddit", { about: 6, searched: ["about"] })]),
    b: scanned([tally("meta_ads", { own: 0, searched: ["own"] })], "2026-10-03T10:00:00Z"),
  }

  it("shows the platforms any brand reads, in the page's order, with totals per brand", () => {
    const matrix = buildMatrix([a, b], brands, false)
    expect(matrix.columns.map((c) => c.platform)).toEqual(["tiktok", "reddit", "meta_ads"])
    expect(matrix.rows.map((r) => [r.competitor.id, r.own, r.about])).toEqual([
      ["a", 4, 6],
      ["b", 0, 0],
    ])
  })

  it("measures a name-only platform by posts about the brands, and never divides by an empty column", () => {
    const matrix = buildMatrix([a, b], brands, false)
    const [tiktok, reddit, metaAds] = matrix.columns
    expect([tiktok!.measure, reddit!.measure, metaAds!.measure]).toEqual(["own", "about", "own"])
    expect(metaAds!.max).toBe(1)
    const bCell = matrix.rows[1]!.cells.find((c) => c.platform === "meta_ads")!
    expect(barShare(bCell, metaAds!)).toBe(0)
  })

  it("names the newest scan among the brands", () => {
    expect(latestScanAt(buildMatrix([a, b], brands, false).rows)).toBe("2026-10-03T10:00:00Z")
    expect(latestScanAt(buildMatrix([a, b], undefined, false).rows)).toBeNull()
  })
})

describe("sortRows", () => {
  const plan = [{ kind: "own" as const, platform: "x" as const }]
  const rows = buildMatrix(
    [
      competitor("quiet", { searchPlan: plan }),
      competitor("busy", { searchPlan: [...plan, { kind: "own", platform: "tiktok" }] }),
      competitor("broken", { searchPlan: plan }),
      competitor("elsewhere", { searchPlan: [{ kind: "own", platform: "tiktok" }] }),
    ],
    {
      quiet: scanned([tally("x", { own: 1, searched: ["own"] })]),
      busy: scanned([tally("x", { own: 9, searched: ["own"] }), tally("tiktok", { own: 20, searched: ["own"] })]),
      broken: scanned([tally("x", { searched: ["own"], failed: ["own"] })]),
      elsewhere: scanned([tally("tiktok", { own: 50, searched: ["own"] })]),
    },
    false,
  ).rows

  it("puts the most active brand first overall", () => {
    expect(sortRows(rows, null).map((r) => r.competitor.id)).toEqual(["elsewhere", "busy", "quiet", "broken"])
  })

  it("on a platform: the brands read there by activity, then a failed search, then the brands not read there", () => {
    expect(sortRows(rows, "x").map((r) => r.competitor.id)).toEqual(["busy", "quiet", "broken", "elsewhere"])
  })
})

describe("scanOutcome", () => {
  const rowWith = (lastScanError: string | null, platforms: CompetitorPlatformTally[]) =>
    buildMatrix([competitor("a", { lastScanError, searchPlan: [{ kind: "own", platform: "tiktok" }, { kind: "about", platform: "x" }] })], { a: scanned(platforms) }, false).rows[0]!

  it("is fine without a problem named", () => {
    expect(scanOutcome(rowWith(null, [tally("tiktok", { own: 2, searched: ["own"], failed: ["own"] })]))).toBe("ok")
  })

  it("is partial when the saved scan has a failed search, by name or unknown (stored before they were kept)", () => {
    expect(scanOutcome(rowWith("x failed", [tally("tiktok", { own: 2, searched: ["own"] }), tally("x", { searched: ["about"], failed: ["about"] })]))).toBe("partial")
    expect(scanOutcome(rowWith("x failed", [tally("tiktok", { own: 2, searched: ["own"], failed: null })]))).toBe("partial")
  })

  it("is failed when the saved scan is clean: the problem is a newer scan that did not happen", () => {
    expect(scanOutcome(rowWith("no credits", [tally("tiktok", { own: 2, searched: ["own"] }), tally("x", { searched: ["about"] })]))).toBe("failed")
  })
})
