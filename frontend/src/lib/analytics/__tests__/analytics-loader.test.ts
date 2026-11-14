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
  readonly ids?: { readonly gtm?: string; readonly ga?: string; readonly clarity?: string }
}

/** What one run of the loader left behind: the data layer, the exposed GA identity, and the address of every script it added. */
interface LoaderRun {
  readonly dataLayer: unknown[]
  readonly exposed: unknown
  readonly scripts: readonly string[]
}

function runLoader(visit: Visit = {}): LoaderRun {
  const ids = visit.ids ?? { gtm: "GTM-TEST99", ga: "G-TEST1234" }
  const script = loader
    .replace("%VITE_CLARITY_ID%", ids.clarity ?? "")
    .replace("%VITE_GTM_ID%", ids.gtm ?? "")
    .replace("%VITE_GA_ID%", ids.ga ?? "")
  const fakeWindow: Record<string, unknown> = {
    location: { hostname: visit.hostname ?? "app.nodaro.ai", pathname: visit.pathname ?? "/projects" },
    localStorage: { getItem: (key: string) => (visit.staffBrowser && key === STAFF_BROWSER_KEY ? "1" : null) },
  }
  fakeWindow.self = fakeWindow
  fakeWindow.top = visit.framed ? {} : fakeWindow
  const created: { src?: string }[] = []
  const fakeDocument = {
    prerendering: false,
    addEventListener: () => {},
    createElement: () => {
      const element: { src?: string } = {}
      created.push(element)
      return element
    },
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
  }
  // The loader is a classic script: give it the globals it reads, nothing else.
  new Function("window", "document", script)(fakeWindow, fakeDocument)
  return {
    dataLayer: (fakeWindow.dataLayer as unknown[]) ?? [],
    exposed: fakeWindow.__NODARO_GA__,
    scripts: created.map((element) => element.src ?? ""),
  }
}

/** Every id configured, Clarity's included, as a production build has them. */
const ALL_IDS = { gtm: "GTM-TEST99", ga: "G-TEST1234", clarity: "clartest01" }

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

  // Flow's production pages have two hosts: flow.nodaro.ai, their own, and
  // app.nodaro.ai, which keeps serving them in full. Both are measured.
  it("loads Clarity and Tag Manager on both of Flow's production hosts", () => {
    for (const hostname of ["app.nodaro.ai", "flow.nodaro.ai"]) {
      const run = runLoader({ hostname, ids: ALL_IDS })
      expect(run.scripts, hostname).toEqual([
        "https://www.clarity.ms/tag/clartest01",
        "https://www.googletagmanager.com/gtm.js?id=GTM-TEST99",
      ])
      expect(run.exposed, hostname).toEqual({ measurementId: "G-TEST1234", internal: false })
    }
  })

  // No third-party script on any staging host, and a local build must not send
  // its traffic to the live property either.
  it("loads neither on a staging host, the site's staging, a local build or a look-alike host", () => {
    for (const hostname of ["next.app.nodaro.ai", "next.flow.nodaro.ai", "next.nodaro.ai", "localhost", "flow.nodaro.ai.example.com", "notflow.nodaro.ai"]) {
      const run = runLoader({ hostname, ids: ALL_IDS, staffBrowser: true })
      expect(run.scripts, hostname).toEqual([])
      expect(run.exposed, hostname).toBeUndefined()
    }
  })
})
