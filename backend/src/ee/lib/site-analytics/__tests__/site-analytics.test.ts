import { beforeAll, describe, expect, it, vi } from "vitest"
import { exportPKCS8, generateKeyPair } from "jose"
import { createSiteAnalytics, type SiteAnalyticsEnv } from "../site-analytics.js"
import type { InspectionBudget } from "../inspection-budget.js"

const NOW = Date.parse("2026-10-08T12:00:00Z")
const MINUTE = 60_000
const EMAIL = "reader@nodaro-analytics.iam.gserviceaccount.com"
let env: SiteAnalyticsEnv

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true })
  const keyFile = JSON.stringify({ client_email: EMAIL, private_key: await exportPKCS8(pair.privateKey) })
  env = { serviceAccountJson: keyFile, ga4PropertyId: "537345785", searchConsoleSite: "sc-domain:nodaro.ai" }
})

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const refused = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ error: { code: status, message, ...extra } }), { status })

/** Google, as the service sees it: the token endpoint, the GA Data API and Search Console. */
function google(overrides: { ga?: () => Response; search?: () => Response } = {}) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.startsWith("https://oauth2.googleapis.com/")) return ok({ access_token: "tok", expires_in: 3600 })
    if (url.startsWith("https://analyticsdata.googleapis.com/")) return overrides.ga ? overrides.ga() : ok({ reports: [{}, {}, {}, {}] })
    if (url.includes("urlInspection")) return ok({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" } } })
    return overrides.search ? overrides.search() : ok({})
  })
}

/** A budget that counts what it is asked for; never Redis in a unit test. */
function budgetOf(limit: number): InspectionBudget & { taken: string[] } {
  const taken: string[] = []
  return {
    taken,
    async take(day) {
      taken.push(day)
      return taken.length <= limit
    },
  }
}

const calls = (fetch: ReturnType<typeof google>, prefix: string) => fetch.mock.calls.filter(([url]) => String(url).startsWith(prefix)).length
const GA = "https://analyticsdata.googleapis.com/"
const INSPECT = "https://searchconsole.googleapis.com/v1/urlInspection"

describe("the setup an admin sees", () => {
  it("nothing configured: both sections say so, Google is never called, and every missing variable is named", async () => {
    const fetch = google()
    const service = createSiteAnalytics({ serviceAccountJson: "", ga4PropertyId: "", searchConsoleSite: "" }, { fetch, now: () => NOW, budget: budgetOf(10) })
    const report = await service.report(28, { fresh: false })
    expect(report.traffic).toEqual({ status: "not_configured" })
    expect(report.search).toEqual({ status: "not_configured" })
    expect(report.setup.problems).toHaveLength(3)
    expect(report.setup.serviceAccountEmail).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("configured: names the account to grant, never its key", async () => {
    const report = await createSiteAnalytics(env, { fetch: google(), now: () => NOW, budget: budgetOf(10) }).report(28, { fresh: false })
    expect(report.setup).toEqual({ serviceAccountEmail: EMAIL, ga4PropertyId: "537345785", searchConsoleSite: "sc-domain:nodaro.ai", problems: [] })
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE KEY/)
  })

  it("a key that will not load says so in both sections, with no bytes of it", async () => {
    const broken = JSON.stringify({ client_email: EMAIL, private_key: "-----BEGIN PRIVATE KEY-----\nAAAAsecretBYTES\n-----END PRIVATE KEY-----\n" })
    const report = await createSiteAnalytics({ ...env, serviceAccountJson: broken }, { fetch: google(), now: () => NOW, budget: budgetOf(10) }).report(7, { fresh: false })
    expect(report.traffic).toMatchObject({ status: "error", reason: "KEY_FILE", message: expect.stringMatching(/private key could not be read/) })
    expect(report.search).toMatchObject({ status: "error", reason: "KEY_FILE" })
    expect(JSON.stringify(report)).not.toMatch(/secretBYTES/)
  })
})

describe("report", () => {
  it("Analytics refusing still returns Search Console, and says why Analytics is missing", async () => {
    const fetch = google({ ga: () => refused(403, "User does not have sufficient permissions for this property.", { status: "PERMISSION_DENIED" }) })
    const report = await createSiteAnalytics(env, { fetch, now: () => NOW, budget: budgetOf(10) }).report(7, { fresh: false })
    expect(report.traffic).toEqual({ status: "error", httpStatus: 403, reason: "PERMISSION_DENIED", message: "User does not have sufficient permissions for this property." })
    expect(report.search.status).toBe("ok")
  })

  it("Search Console refusing still returns Analytics", async () => {
    const fetch = google({ search: () => refused(403, "User does not have sufficient permission for site 'sc-domain:nodaro.ai'.") })
    const report = await createSiteAnalytics(env, { fetch, now: () => NOW, budget: budgetOf(10) }).report(7, { fresh: false })
    expect(report.traffic.status).toBe("ok")
    expect(report.search).toMatchObject({ status: "error", httpStatus: 403 })
  })

  it("keeps a range's report ten minutes; another range asks Google again", async () => {
    let now = NOW
    const fetch = google()
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget: budgetOf(10) })
    await service.report(28, { fresh: false })
    now = NOW + 9 * MINUTE
    await service.report(28, { fresh: false })
    expect(calls(fetch, GA)).toBe(1)
    await service.report(7, { fresh: false })
    expect(calls(fetch, GA)).toBe(2)
    // The 7-day report was read at minute 9: at minute 20 it is past its ten minutes.
    now = NOW + 20 * MINUTE
    await service.report(7, { fresh: false })
    expect(calls(fetch, GA)).toBe(3)
  })

  it("Refresh asks Google again, but not within a minute of the last answer", async () => {
    let now = NOW
    const fetch = google()
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget: budgetOf(10) })
    await service.report(28, { fresh: false })
    now = NOW + 30_000
    await service.report(28, { fresh: true })
    expect(calls(fetch, GA)).toBe(1)
    now = NOW + 61_000
    await service.report(28, { fresh: true })
    expect(calls(fetch, GA)).toBe(2)
  })

  it("stamps each section with when Google answered", async () => {
    const report = await createSiteAnalytics(env, { fetch: google(), now: () => NOW, budget: budgetOf(10) }).report(28, { fresh: false })
    expect(report.traffic).toMatchObject({ status: "ok", fetchedAt: "2026-10-08T12:00:00.000Z" })
  })
})

describe("inspect", () => {
  it("a page outside the site is refused before Google — or the budget — is asked", async () => {
    const fetch = google()
    const budget = budgetOf(10)
    const result = await createSiteAnalytics(env, { fetch, now: () => NOW, budget }).inspect("https://nodaro.ai.evil.com/", { fresh: false })
    expect(result).toEqual({ status: "not_in_site" })
    expect(fetch).not.toHaveBeenCalled()
    expect(budget.taken).toEqual([])
  })

  it("keeps a page's answer for a day, and only a call to Google spends the budget (on Search Console's day)", async () => {
    let now = NOW
    const fetch = google()
    const budget = budgetOf(10)
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget })
    expect(await service.inspect("https://nodaro.ai/docs", { fresh: false })).toMatchObject({ status: "ok", data: { verdict: "PASS" } })
    now = NOW + 23 * 3_600_000
    await service.inspect("https://nodaro.ai/docs", { fresh: false })
    expect(calls(fetch, INSPECT)).toBe(1)
    expect(budget.taken).toEqual(["2026-10-08"])
    now = NOW + 25 * 3_600_000
    await service.inspect("https://nodaro.ai/docs", { fresh: false })
    expect(calls(fetch, INSPECT)).toBe(2)
    expect(budget.taken).toEqual(["2026-10-08", "2026-10-09"])
  })

  it("the same page written another way is one check, sent as the parsed address", async () => {
    const fetch = google()
    const service = createSiteAnalytics(env, { fetch, now: () => NOW, budget: budgetOf(10) })
    await service.inspect("https://nodaro.ai/docs#models", { fresh: false })
    const second = await service.inspect("HTTPS://NODARO.AI/docs", { fresh: false })
    expect(calls(fetch, INSPECT)).toBe(1)
    const sent = fetch.mock.calls.find(([url]) => String(url).startsWith(INSPECT))?.[1]
    expect(JSON.parse(String(sent?.body)).inspectionUrl).toBe("https://nodaro.ai/docs")
    expect(second).toMatchObject({ status: "ok", data: { url: "https://nodaro.ai/docs" } })
  })

  it("Check again within a minute gets the last answer: no call to Google, no budget spent", async () => {
    let now = NOW
    const fetch = google()
    const budget = budgetOf(10)
    const service = createSiteAnalytics(env, { fetch, now: () => now, budget })
    await service.inspect("https://nodaro.ai/docs", { fresh: false })
    now = NOW + 30_000
    await service.inspect("https://nodaro.ai/docs", { fresh: true })
    expect(calls(fetch, INSPECT)).toBe(1)
    expect(budget.taken).toHaveLength(1)
    now = NOW + 61_000
    await service.inspect("https://nodaro.ai/docs", { fresh: true })
    expect(calls(fetch, INSPECT)).toBe(2)
    expect(budget.taken).toHaveLength(2)
  })

  it("a key that cannot sign in spends no check", async () => {
    const broken = JSON.stringify({ client_email: EMAIL, private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n" })
    const budget = budgetOf(10)
    const result = await createSiteAnalytics({ ...env, serviceAccountJson: broken }, { fetch: google(), now: () => NOW, budget }).inspect("https://nodaro.ai/docs", { fresh: false })
    expect(result).toMatchObject({ status: "error", reason: "KEY_FILE" })
    expect(budget.taken).toEqual([])
  })

  it("a spent budget answers without asking Google", async () => {
    const fetch = google()
    const service = createSiteAnalytics(env, { fetch, now: () => NOW, budget: budgetOf(1) })
    await service.inspect("https://nodaro.ai/a", { fresh: false })
    const refusedCheck = await service.inspect("https://nodaro.ai/b", { fresh: false })
    expect(refusedCheck).toMatchObject({ status: "error", reason: "DAILY_BUDGET", httpStatus: 429 })
    expect(calls(fetch, INSPECT)).toBe(1)
  })

  it("without a Search Console site there is nothing to inspect against", async () => {
    const service = createSiteAnalytics({ ...env, searchConsoleSite: "" }, { fetch: google(), now: () => NOW, budget: budgetOf(10) })
    expect(await service.inspect("https://nodaro.ai/docs", { fresh: false })).toEqual({ status: "not_configured" })
  })
})
