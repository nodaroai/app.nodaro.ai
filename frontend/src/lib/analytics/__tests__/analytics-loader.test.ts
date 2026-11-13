// @test-watches frontend/index.html
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { STAFF_BROWSER_KEY } from "../site-analytics"

/**
 * index.html's analytics loader, run for real against a stand-in window: it is
 * the one gate site-analytics.ts relies on, and the staff mark only works if it
 * reaches the data layer BEFORE the container's own start entry.
 */

const html = readFileSync(join(__dirname, "..", "..", "..", "..", "index.html"), "utf8")
const loader = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "").find((body) => body.includes("function startAnalytics()")) ?? ""

interface Visit {
  readonly hostname?: string
  readonly pathname?: string
  readonly framed?: boolean
  readonly staffBrowser?: boolean
  readonly ids?: { readonly gtm?: string; readonly ga?: string }
}

function runLoader(visit: Visit = {}): { dataLayer: unknown[]; exposed: unknown } {
  const ids = visit.ids ?? { gtm: "GTM-TEST99", ga: "G-TEST1234" }
  const script = loader
    .replace("%VITE_CLARITY_ID%", "")
    .replace("%VITE_GTM_ID%", ids.gtm ?? "")
    .replace("%VITE_GA_ID%", ids.ga ?? "")
  const fakeWindow: Record<string, unknown> = {
    location: { hostname: visit.hostname ?? "app.nodaro.ai", pathname: visit.pathname ?? "/projects" },
    localStorage: { getItem: (key: string) => (visit.staffBrowser && key === STAFF_BROWSER_KEY ? "1" : null) },
  }
  fakeWindow.self = fakeWindow
  fakeWindow.top = visit.framed ? {} : fakeWindow
  const fakeDocument = {
    prerendering: false,
    addEventListener: () => {},
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
  }
  // The loader is a classic script: give it the globals it reads, nothing else.
  new Function("window", "document", script)(fakeWindow, fakeDocument)
  return { dataLayer: (fakeWindow.dataLayer as unknown[]) ?? [], exposed: fakeWindow.__NODARO_GA__ }
}

const describeEntry = (entry: unknown): unknown =>
  Object.prototype.toString.call(entry) === "[object Arguments]" ? ["command", ...Array.from(entry as ArrayLike<unknown>)] : (entry as { event?: unknown }).event

describe("index.html analytics loader", () => {
  it("is found", () => {
    expect(loader).toContain("startAnalytics")
  })

  it("exposes the measurement id where it loads the container", () => {
    expect(runLoader().exposed).toEqual({ measurementId: "G-TEST1234", internal: false })
  })

  it("marks a staff browser's traffic internal before the container's start entry, and says so", () => {
    const staff = runLoader({ staffBrowser: true })
    expect(staff.dataLayer.map(describeEntry)).toEqual([
      ["command", "set", { traffic_type: "internal" }],
      "gtm.js",
    ])
    expect(staff.exposed).toEqual({ measurementId: "G-TEST1234", internal: true })
    expect(runLoader().dataLayer.map(describeEntry)).toEqual(["gtm.js"])
  })

  it("exposes nothing, and marks nothing, wherever it does not load the container", () => {
    for (const visit of [
      { hostname: "localhost" },
      { hostname: "next.app.nodaro.ai" },
      { pathname: "/app/some-app" },
      { framed: true },
      { ids: { gtm: "", ga: "G-TEST1234" } },
    ] satisfies Visit[]) {
      const run = runLoader({ ...visit, staffBrowser: true })
      expect(run.exposed, JSON.stringify(visit)).toBeUndefined()
      expect(run.dataLayer.map(describeEntry), JSON.stringify(visit)).not.toContainEqual(["command", "set", { traffic_type: "internal" }])
    }
  })

  it("with no measurement id configured: still loads the container, but exposes nothing and marks nothing", () => {
    const run = runLoader({ ids: { gtm: "GTM-TEST99", ga: "" }, staffBrowser: true })
    expect(run.exposed).toBeUndefined()
    expect(run.dataLayer.map(describeEntry)).toEqual(["gtm.js"])
  })
})
