/**
 * What a site's block says, in one place: the pill, the line under it and its
 * colour, for every kind of answer the server gives; which sites count as up
 * to date; and how many releases a site is behind.
 */
import { describe, expect, it } from "vitest"
import { isProductUpToDate, isUpToDate, siteFace, upToDateCount } from "../site-face"
import type { HeaderVersionsReport, ProductView, SiteResult } from "../types"

const ok = (version: string | null, extra: Partial<Extract<SiteResult, { status: "ok" }>> = {}): SiteResult => ({
  status: "ok",
  version,
  header: true,
  source: "lockfile",
  deploy: null,
  standing: null,
  releasesBehind: null,
  ...extra,
})

const product = (production: SiteResult, staging: SiteResult): ProductView => ({
  id: "p",
  label: "p",
  repo: "acme/p",
  icon: null,
  sites: {
    production: { host: "p.example.com", url: "https://p.example.com", result: production, worlds: { status: "not_reported" } },
    staging: { host: "n.example.com", url: "https://n.example.com", result: staging, worlds: { status: "not_reported" } },
  },
})

describe("siteFace", () => {
  it("a ranked version says how it stands; behind, by the releases the server counted", () => {
    expect(siteFace(ok("0.13.0", { standing: "newest" }))).toEqual({ label: "0.13.0", note: "Newest", tone: "newest" })
    expect(siteFace(ok("0.12.0", { standing: "behind", releasesBehind: 1 }))).toEqual({ label: "0.12.0", note: "1 version behind", tone: "behind" })
    expect(siteFace(ok("0.12.0", { standing: "behind", releasesBehind: 3 }))).toEqual({ label: "0.12.0", note: "3 versions behind", tone: "behind" })
    expect(siteFace(ok("0.13.0", { standing: "behind" }))).toEqual({ label: "0.13.0", note: "Behind", tone: "behind" })
    expect(siteFace(ok("0.14.0", { standing: "ahead" }))).toEqual({ label: "0.14.0", note: "Ahead of the release", tone: "ahead" })
    expect(siteFace(ok("0.13.0"))).toEqual({ label: "0.13.0", note: null, tone: "quiet" })
  })

  it("a hidden header, a pin, a range and no header are said before any version", () => {
    expect(siteFace(ok("0.12.0", { header: false, standing: "behind", releasesBehind: 1 }))).toEqual({ label: "Header off", note: "0.12.0 installed", tone: "off" })
    expect(siteFace(ok("0.8.0", { source: "pin", header: null }))).toMatchObject({ label: "Unknown yet", tone: "quiet" })
    expect(siteFace(ok("^0.12.0", { source: "package-json" }))).toEqual({ label: "^0.12.0", note: "Declared range, not installed", tone: "quiet" })
    expect(siteFace(ok(null))).toEqual({ label: "No header", note: null, tone: "quiet" })
  })

  it("a site with no answer says why", () => {
    expect(siteFace({ status: "error", message: "GitHub answered 404" })).toEqual({ label: "Unreadable", note: "GitHub answered 404", tone: "bad" })
    expect(siteFace({ status: "no_deploy" })).toEqual({ label: "No deploy", note: "No successful deploy found", tone: "quiet" })
    expect(siteFace({ status: "not_configured" })).toEqual({ label: "Unknown", note: "Needs the GitHub token", tone: "quiet" })
  })
})

describe("up to date", () => {
  it("a site is up to date on the newest release or past it, with the header shown", () => {
    expect(isUpToDate(ok("0.13.0", { standing: "newest" }))).toBe(true)
    expect(isUpToDate(ok("0.14.0", { standing: "ahead" }))).toBe(true)
    expect(isUpToDate(ok("0.13.0", { standing: "newest", header: false }))).toBe(false)
    expect(isUpToDate(ok("0.12.0", { standing: "behind" }))).toBe(false)
    expect(isUpToDate(ok("0.13.0"))).toBe(false)
    expect(isUpToDate({ status: "no_deploy" })).toBe(false)
  })

  it("a product is up to date only when both its sites are; the count is over every site", () => {
    const current = product(ok("0.13.0", { standing: "newest" }), ok("0.13.0", { standing: "newest" }))
    const half = product(ok("0.13.0", { standing: "newest" }), ok("0.12.0", { standing: "behind" }))
    expect(isProductUpToDate(current)).toBe(true)
    expect(isProductUpToDate(half)).toBe(false)
    const report = { products: [current, half] } as unknown as HeaderVersionsReport
    expect(upToDateCount(report)).toEqual({ upToDate: 3, total: 4 })
  })
})
