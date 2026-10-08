import { columns, GA_DATA_API, type GaAnswer } from "./ga4-columns.js"
import type { SiteAnalyticsDays } from "./ga4-report.js"
import { googleJson, type FetchLike } from "./google-api.js"

/**
 * Where visits came from — GA's acquisition reports: a session's channel,
 * its source and medium as GA attributes them, its campaign, the five UTM
 * fields as they were tagged, and the path it landed on. Rows GA cannot
 * attribute ("(not set)", "(direct)") are kept: they are the denominator;
 * the page can hide them.
 */
export interface SourceRow {
  /** The row's values, one per dimension of its table — ["google", "organic"], ["/pricing"]. */
  readonly labels: readonly string[]
  readonly sessions: number
  readonly activeUsers: number
  readonly newUsers: number
  /** 0–1: engaged sessions over sessions. */
  readonly engagementRate: number
  /** Sessions' key events (sign-ups and the like, as the property marks them). */
  readonly keyEvents: number
}

export interface SourceTable {
  readonly rows: readonly SourceRow[]
  /** How many rows GA has in all — more than `rows` when it sent only the top ones. */
  readonly total: number
}

export interface SourcesReport {
  readonly channels: SourceTable
  /** GA's attribution — organic and referral visits included, with or without a UTM. */
  readonly sourceMedium: SourceTable
  /** Any campaign GA knows of — a UTM one, an ads one, or GA's own "(organic)", "(direct)". */
  readonly campaigns: SourceTable
  /**
   * The five UTM fields as tagged: source, medium, campaign, content, term.
   * Visits without tags are left out at Google (`TAGGED_ONLY`), so the row
   * cap counts tagged visits — except "(not set)" ones, which the page hides.
   */
  readonly utm: SourceTable
  /**
   * The path a session started on. Only the path: the site a session landed
   * on is not something GA keeps per session (its site name is per event,
   * and pairing the two would count a session once per site it touched).
   */
  readonly landingPages: SourceTable
}

const METRICS = ["sessions", "activeUsers", "newUsers", "engagementRate", "keyEvents"] as const

/**
 * A visit that came without UTM tags still gets manual fields: GA fills the
 * source and medium from what it detected and names the channel as the
 * campaign — "(organic)", "(referral)", "(ai-assistant)". A tagged link that
 * set no campaign gets "(not set)" there instead. Without this filter those
 * fill-ins (one row per referring site) take the 100 rows Google sends and
 * push tagged visits out of the table.
 */
const TAGGED_ONLY = {
  notExpression: {
    andGroup: {
      expressions: [
        { filter: { fieldName: "sessionManualCampaignName", stringFilter: { matchType: "FULL_REGEXP", value: "\\(.+\\)" } } },
        { notExpression: { filter: { fieldName: "sessionManualCampaignName", stringFilter: { matchType: "EXACT", value: "(not set)" } } } },
      ],
    },
  },
} as const

const TABLES: Readonly<Record<keyof SourcesReport, { readonly dimensions: readonly string[]; readonly limit: number; readonly filter?: unknown }>> = {
  channels: { dimensions: ["sessionDefaultChannelGroup"], limit: 50 },
  sourceMedium: { dimensions: ["sessionSource", "sessionMedium"], limit: 100 },
  campaigns: { dimensions: ["sessionCampaignName"], limit: 100 },
  utm: {
    dimensions: ["sessionManualSource", "sessionManualMedium", "sessionManualCampaignName", "sessionManualAdContent", "sessionManualTerm"],
    limit: 100,
    filter: TAGGED_ONLY,
  },
  landingPages: { dimensions: ["landingPage"], limit: 100 },
}
/** The order the five tables travel in one batch (at most five reports fit one). */
const ORDER: ReadonlyArray<keyof SourcesReport> = ["channels", "sourceMedium", "campaigns", "utm", "landingPages"]

/** The five tables over the N days ending yesterday. */
export function sourcesRequests(days: SiteAnalyticsDays): unknown[] {
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "yesterday" }]
  return ORDER.map((name) => ({
    dateRanges,
    dimensions: TABLES[name].dimensions.map((dimension) => ({ name: dimension })),
    metrics: METRICS.map((metric) => ({ name: metric })),
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: TABLES[name].limit,
    ...(TABLES[name].filter ? { dimensionFilter: TABLES[name].filter } : {}),
  }))
}

function tableOf(answer: GaAnswer | undefined, name: keyof SourcesReport): SourceTable {
  const report = columns(answer)
  return {
    rows: report.rows.map((row) => ({
      labels: TABLES[name].dimensions.map((dimension) => report.dimension(row, dimension)),
      sessions: report.metric(row, "sessions"),
      activeUsers: report.metric(row, "activeUsers"),
      newUsers: report.metric(row, "newUsers"),
      engagementRate: report.metric(row, "engagementRate"),
      keyEvents: report.metric(row, "keyEvents"),
    })),
    total: report.rowCount,
  }
}

export async function readSourcesReport(opts: { propertyId: string; days: SiteAnalyticsDays; token: string; fetch: FetchLike }): Promise<SourcesReport> {
  const batch = await googleJson<{ reports?: GaAnswer[] }>(opts.fetch, `${GA_DATA_API}/properties/${opts.propertyId}:batchRunReports`, opts.token, {
    requests: sourcesRequests(opts.days),
  })
  const at = (name: keyof SourcesReport) => tableOf(batch.reports?.[ORDER.indexOf(name)], name)
  return {
    channels: at("channels"),
    sourceMedium: at("sourceMedium"),
    campaigns: at("campaigns"),
    utm: at("utm"),
    landingPages: at("landingPages"),
  }
}
