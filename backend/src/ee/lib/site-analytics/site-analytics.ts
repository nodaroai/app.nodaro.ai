import { config } from "../../../lib/config.js"
import { readGaReport, type SiteAnalyticsDays, type TrafficReport } from "./ga4-report.js"
import { GoogleApiError, type FetchLike } from "./google-api.js"
import { createTokenSource, KeyFileError } from "./google-token.js"
import { createInspectionBudget, INSPECTIONS_PER_DAY, redisCounterStore, type InspectionBudget } from "./inspection-budget.js"
import { inspectUrl, readSearchReport, searchConsoleToday, siteUrlOf, type IndexStatus, type SearchReport } from "./search-console.js"
import { resolveSetup, type SiteAnalyticsEnv } from "./setup.js"
import { createTtlCache } from "./ttl-cache.js"

export type { SiteAnalyticsEnv } from "./setup.js"

/** Why a part of the page has no data: Google's words, its status and its code (PERMISSION_DENIED, SERVICE_DISABLED, …). */
export interface SectionFailure {
  readonly status: "error"
  readonly message: string
  readonly httpStatus?: number
  readonly reason?: string
}

/** One part of the page: Google's answer, why there is none, or what Google said when it refused. */
export type SectionResult<T> = { readonly status: "ok"; readonly data: T; readonly fetchedAt: string } | { readonly status: "not_configured" } | SectionFailure

/** What an admin needs to finish the setup: the account to grant (never its key) and what is missing. */
export interface SetupView {
  readonly serviceAccountEmail: string | null
  readonly ga4PropertyId: string | null
  readonly searchConsoleSite: string | null
  readonly problems: readonly string[]
}

export interface SiteAnalyticsReport {
  readonly days: SiteAnalyticsDays
  readonly setup: SetupView
  readonly traffic: SectionResult<TrafficReport>
  readonly search: SectionResult<SearchReport>
}

export type InspectResult =
  | { readonly status: "ok"; readonly data: IndexStatus }
  | { readonly status: "not_configured" }
  | { readonly status: "not_in_site" }
  | SectionFailure

export interface SiteAnalyticsService {
  report(days: SiteAnalyticsDays, opts: { fresh: boolean }): Promise<SiteAnalyticsReport>
  inspect(url: string, opts: { fresh: boolean }): Promise<InspectResult>
}

/** Reports change slowly and cost quota; ten minutes keeps the page live without asking Google on every view. */
const REPORT_TTL_MS = 10 * 60_000
/** A page's index verdict is kept a day: URL Inspection is the scarce quota. */
const INSPECTION_TTL_MS = 24 * 3_600_000
const INSPECTIONS_KEPT = 2_000
/** "Refresh" / "Check again" within a minute of the last answer gets that answer. */
const MIN_FRESH_MS = 60_000

class BudgetSpentError extends Error {}

function failure(error: unknown, what: string): SectionFailure {
  if (error instanceof GoogleApiError) {
    return { status: "error", message: error.message, httpStatus: error.status, ...(error.reason ? { reason: error.reason } : {}) }
  }
  if (error instanceof KeyFileError) return { status: "error", message: error.message, reason: "KEY_FILE" }
  if (error instanceof BudgetSpentError) {
    return {
      status: "error",
      httpStatus: 429,
      reason: "DAILY_BUDGET",
      message: `Today's budget of ${INSPECTIONS_PER_DAY.toLocaleString("en-US")} page checks is used up. It resets at midnight Pacific time.`,
    }
  }
  console.error(`[site-analytics] ${what} failed:`, error)
  return { status: "error", message: `Could not reach Google for ${what}.` }
}

export function createSiteAnalytics(
  env: SiteAnalyticsEnv,
  deps: { fetch?: FetchLike; now?: () => number; budget?: InspectionBudget } = {},
): SiteAnalyticsService {
  const fetch: FetchLike = deps.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const now = deps.now ?? Date.now
  const budget = deps.budget ?? createInspectionBudget(redisCounterStore)
  const setup = resolveSetup(env)
  const token = setup.account ? createTokenSource(setup.account, { fetch, now }) : null
  const reports = createTtlCache<TrafficReport | SearchReport>({ ttlMs: REPORT_TTL_MS, maxEntries: 20, minFreshMs: MIN_FRESH_MS, now })
  const inspections = createTtlCache<IndexStatus>({ ttlMs: INSPECTION_TTL_MS, maxEntries: INSPECTIONS_KEPT, minFreshMs: MIN_FRESH_MS, now })

  const view: SetupView = {
    serviceAccountEmail: setup.account?.clientEmail ?? null,
    ga4PropertyId: setup.ga4PropertyId,
    searchConsoleSite: setup.searchConsoleSite,
    problems: setup.problems,
  }

  async function section<T extends TrafficReport | SearchReport>(
    key: string,
    ready: boolean,
    what: string,
    load: (accessToken: string) => Promise<T>,
    fresh: boolean,
  ): Promise<SectionResult<T>> {
    if (!ready || !token) return { status: "not_configured" }
    try {
      const cached = await reports.get(key, async () => load(await token()), { fresh })
      return { status: "ok", data: cached.value as T, fetchedAt: new Date(cached.fetchedAt).toISOString() }
    } catch (error) {
      return failure(error, what)
    }
  }

  return {
    async report(days, { fresh }) {
      const { ga4PropertyId: propertyId, searchConsoleSite: site } = setup
      const [traffic, search] = await Promise.all([
        section<TrafficReport>(`traffic:${days}`, propertyId !== null, "Analytics", (t) => readGaReport({ propertyId: propertyId ?? "", days, token: t, fetch, now: new Date(now()) }), fresh),
        section<SearchReport>(`search:${days}`, site !== null, "Search Console", (t) => readSearchReport({ site: site ?? "", days, token: t, fetch, now: new Date(now()) }), fresh),
      ])
      return { days, setup: view, traffic, search }
    },

    async inspect(url, { fresh }) {
      const site = setup.searchConsoleSite
      if (!site || !token) return { status: "not_configured" }
      // The parsed page is what is checked, sent, cached and answered — never the raw text.
      const page = siteUrlOf(url, site)
      if (!page) return { status: "not_in_site" }
      try {
        const cached = await inspections.get(
          page,
          async () => {
            // The token first: a key or sign-in that fails must not spend a check.
            const accessToken = await token()
            if (!(await budget.take(searchConsoleToday(new Date(now()))))) throw new BudgetSpentError()
            return inspectUrl({ site, url: page, token: accessToken, fetch, now: new Date(now()) })
          },
          { fresh },
        )
        return { status: "ok", data: cached.value }
      } catch (error) {
        return failure(error, "the page check")
      }
    },
  }
}

let shared: SiteAnalyticsService | null = null

/** The deployment's service, built on first use from its environment — never at import. */
export function siteAnalytics(): SiteAnalyticsService {
  shared ??= createSiteAnalytics({
    serviceAccountJson: config.SITE_ANALYTICS_SERVICE_ACCOUNT_JSON,
    ga4PropertyId: config.SITE_ANALYTICS_GA4_PROPERTY_ID,
    searchConsoleSite: config.SITE_ANALYTICS_SEARCH_CONSOLE_SITE,
  })
  return shared
}
