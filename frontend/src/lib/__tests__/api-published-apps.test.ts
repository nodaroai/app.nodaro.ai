import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import {
  publishApp,
  getMyApps,
  updateApp,
  deactivateApp,
  getPublishedApp,
  runPublishedApp,
  getAppRuns,
  getAppRun,
  deleteAppRun,
  getAppAnalytics,
  getAppAnalyticsRuns,
} from "../api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

function sessionWith(token: string) {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  })
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetSession.mockReset()
  sessionWith("test-token")
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// publishApp
// ---------------------------------------------------------------------------

describe("publishApp", () => {
  it("sends POST to /v1/apps/publish with body", async () => {
    const app = { id: "app-1", name: "My App", slug: "my-app" }
    const mock = mockFetchJson(app)
    vi.stubGlobal("fetch", mock)

    const result = await publishApp({
      workflowId: "wf-1",
      name: "My App",
      slug: "my-app",
      description: "A test app",
    })

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/publish")
    expect(opts.method).toBe("POST")
    const body = JSON.parse(opts.body as string)
    expect(body).toEqual({
      workflowId: "wf-1",
      name: "My App",
      slug: "my-app",
      description: "A test app",
    })
    expect(result).toEqual(app)
  })
})

// ---------------------------------------------------------------------------
// getMyApps
// ---------------------------------------------------------------------------

describe("getMyApps", () => {
  it("sends GET to /v1/apps/mine", async () => {
    const apps = [{ id: "app-1" }, { id: "app-2" }]
    const mock = mockFetchJson(apps)
    vi.stubGlobal("fetch", mock)

    const result = await getMyApps()

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/mine")
    expect(opts.method).toBe("GET")
    expect(result).toEqual(apps)
  })
})

// ---------------------------------------------------------------------------
// updateApp
// ---------------------------------------------------------------------------

describe("updateApp", () => {
  it("sends PATCH to /v1/apps/:appId with body", async () => {
    const updated = { id: "app-1", name: "Renamed" }
    const mock = mockFetchJson(updated)
    vi.stubGlobal("fetch", mock)

    const result = await updateApp("app-1", { name: "Renamed", isListed: true })

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/app-1")
    expect(opts.method).toBe("PATCH")
    const body = JSON.parse(opts.body as string)
    expect(body).toEqual({ name: "Renamed", isListed: true })
    expect(result).toEqual(updated)
  })

  it("URL-encodes special characters in appId", async () => {
    const mock = mockFetchJson({ id: "a/b" })
    vi.stubGlobal("fetch", mock)

    await updateApp("a/b", { name: "X" })

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/a%2Fb")
  })
})

// ---------------------------------------------------------------------------
// deactivateApp
// ---------------------------------------------------------------------------

describe("deactivateApp", () => {
  it("sends DELETE to /v1/apps/:appId", async () => {
    const mock = mockFetchJson(null)
    vi.stubGlobal("fetch", mock)

    await deactivateApp("app-99")

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/app-99")
    expect(opts.method).toBe("DELETE")
  })

  it("URL-encodes special characters in appId", async () => {
    const mock = mockFetchJson(null)
    vi.stubGlobal("fetch", mock)

    await deactivateApp("id with spaces")

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/id%20with%20spaces")
  })
})

// ---------------------------------------------------------------------------
// getPublishedApp
// ---------------------------------------------------------------------------

describe("getPublishedApp", () => {
  it("sends GET to /v1/app/:slug", async () => {
    const app = { id: "app-1", slug: "cool-app" }
    const mock = mockFetchJson(app)
    vi.stubGlobal("fetch", mock)

    const result = await getPublishedApp("cool-app")

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/cool-app")
    expect(opts.method).toBe("GET")
    expect(result).toEqual(app)
  })

  it("URL-encodes special characters in slug", async () => {
    const mock = mockFetchJson({ id: "x" })
    vi.stubGlobal("fetch", mock)

    await getPublishedApp("my app/test")

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/my%20app%2Ftest")
  })
})

// ---------------------------------------------------------------------------
// runPublishedApp
// ---------------------------------------------------------------------------

describe("runPublishedApp", () => {
  it("sends POST to /v1/app/:slug/run with inputOverrides", async () => {
    const runResult = { executionId: "ex-1", runId: "run-1", status: "running" }
    const mock = mockFetchJson(runResult)
    vi.stubGlobal("fetch", mock)

    const overrides = { node1: { prompt: "custom" } }
    const result = await runPublishedApp("my-app", overrides)

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/my-app/run")
    expect(opts.method).toBe("POST")
    const body = JSON.parse(opts.body as string)
    expect(body).toEqual({ inputOverrides: overrides })
    expect(result).toEqual(runResult)
  })

  it("sends POST with undefined inputOverrides when none provided", async () => {
    const mock = mockFetchJson({ executionId: "ex-2", runId: "run-2", status: "running" })
    vi.stubGlobal("fetch", mock)

    await runPublishedApp("my-app")

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body).toEqual({ inputOverrides: undefined })
  })

  it("URL-encodes special characters in slug", async () => {
    const mock = mockFetchJson({ executionId: "e", runId: "r", status: "running" })
    vi.stubGlobal("fetch", mock)

    await runPublishedApp("slug/special")

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/slug%2Fspecial/run")
  })
})

// ---------------------------------------------------------------------------
// getAppRuns
// ---------------------------------------------------------------------------

describe("getAppRuns", () => {
  it("sends GET to /v1/app/:slug/runs without cursor", async () => {
    const data = { data: [{ id: "run-1" }], nextCursor: null }
    const mock = mockFetchJson(data)
    vi.stubGlobal("fetch", mock)

    const result = await getAppRuns("my-app")

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/my-app/runs")
    expect(opts.method).toBe("GET")
    expect(result).toEqual(data)
  })

  it("appends cursor as query param when provided", async () => {
    const mock = mockFetchJson({ data: [], nextCursor: null })
    vi.stubGlobal("fetch", mock)

    await getAppRuns("my-app", "cursor-abc")

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/my-app/runs?cursor=cursor-abc")
  })

  it("URL-encodes special characters in slug", async () => {
    const mock = mockFetchJson({ data: [], nextCursor: null })
    vi.stubGlobal("fetch", mock)

    await getAppRuns("slug&special")

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/slug%26special/runs")
  })
})

// ---------------------------------------------------------------------------
// getAppRun
// ---------------------------------------------------------------------------

describe("getAppRun", () => {
  it("sends GET to /v1/app/:slug/runs/:runId", async () => {
    const run = { id: "run-1", appId: "app-1" }
    const mock = mockFetchJson(run)
    vi.stubGlobal("fetch", mock)

    const result = await getAppRun("my-app", "run-1")

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/my-app/runs/run-1")
    expect(opts.method).toBe("GET")
    expect(result).toEqual(run)
  })

  it("URL-encodes special characters in slug and runId", async () => {
    const mock = mockFetchJson({ id: "r" })
    vi.stubGlobal("fetch", mock)

    await getAppRun("my app", "run/1")

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/my%20app/runs/run%2F1")
  })
})

// ---------------------------------------------------------------------------
// deleteAppRun
// ---------------------------------------------------------------------------

describe("deleteAppRun", () => {
  it("sends DELETE to /v1/app/:slug/runs/:runId", async () => {
    const mock = mockFetchJson(null)
    vi.stubGlobal("fetch", mock)

    await deleteAppRun("my-app", "run-1")

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/my-app/runs/run-1")
    expect(opts.method).toBe("DELETE")
  })

  it("URL-encodes special characters in slug and runId", async () => {
    const mock = mockFetchJson(null)
    vi.stubGlobal("fetch", mock)

    await deleteAppRun("s/l", "r&1")

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/app/s%2Fl/runs/r%261")
  })
})

// ---------------------------------------------------------------------------
// getAppAnalytics
// ---------------------------------------------------------------------------

describe("getAppAnalytics", () => {
  it("sends GET to /v1/apps/:appId/analytics", async () => {
    const analytics = {
      today: { totalRuns: 5, uniqueRunners: 3, totalCredits: 10, successfulRuns: 4, failedRuns: 1 },
      last7Days: { totalRuns: 20, uniqueRunners: 8, totalCredits: 40, successfulRuns: 18, failedRuns: 2 },
      last30Days: { totalRuns: 100, uniqueRunners: 30, totalCredits: 200, successfulRuns: 95, failedRuns: 5 },
      allTime: { totalRuns: 500, uniqueRunners: 100, totalCredits: 1000, successfulRuns: 480, failedRuns: 20 },
      daily: [],
    }
    const mock = mockFetchJson(analytics)
    vi.stubGlobal("fetch", mock)

    const result = await getAppAnalytics("app-1")

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/app-1/analytics")
    expect(opts.method).toBe("GET")
    expect(result).toEqual(analytics)
  })

  it("URL-encodes special characters in appId", async () => {
    const mock = mockFetchJson({ today: {}, last7Days: {}, last30Days: {}, allTime: {}, daily: [] })
    vi.stubGlobal("fetch", mock)

    await getAppAnalytics("app/1")

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/app%2F1/analytics")
  })
})

// ---------------------------------------------------------------------------
// getAppAnalyticsRuns
// ---------------------------------------------------------------------------

describe("getAppAnalyticsRuns", () => {
  it("sends GET to /v1/apps/:appId/analytics/runs without cursor", async () => {
    const data = { data: [{ id: "run-1", runnerId: "u-1", creditsUsed: 5 }], nextCursor: null }
    const mock = mockFetchJson(data)
    vi.stubGlobal("fetch", mock)

    const result = await getAppAnalyticsRuns("app-1")

    expect(mock).toHaveBeenCalledOnce()
    const [url, opts] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/app-1/analytics/runs")
    expect(opts.method).toBe("GET")
    expect(result).toEqual(data)
  })

  it("appends cursor as query param when provided", async () => {
    const mock = mockFetchJson({ data: [], nextCursor: null })
    vi.stubGlobal("fetch", mock)

    await getAppAnalyticsRuns("app-1", "cur-xyz")

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/app-1/analytics/runs?cursor=cur-xyz")
  })

  it("URL-encodes special characters in appId", async () => {
    const mock = mockFetchJson({ data: [], nextCursor: null })
    vi.stubGlobal("fetch", mock)

    await getAppAnalyticsRuns("app&id")

    const [url] = mock.mock.calls[0]
    expect(url).toBe("/v1/apps/app%26id/analytics/runs")
  })
})
