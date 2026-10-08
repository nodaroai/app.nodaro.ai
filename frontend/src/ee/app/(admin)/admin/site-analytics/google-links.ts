import type { SiteAnalyticsDays } from "./types"

/** GA's own words for the page's ranges. */
const GA_DATE_OPTION: Record<SiteAnalyticsDays, string> = { 7: "last7Days", 28: "last28Days", 90: "last90Days" }

const GA_REPORT = "business-objectives-generate-leads-overview"

/**
 * The property's "Generate leads" overview in Google Analytics, over the
 * page's range. No account number: that is one browser's order of signed-in
 * Google accounts, so Google picks the account, as with any shared GA link.
 */
export function analyticsLink(propertyId: string, days: SiteAnalyticsDays): string {
  const params = encodeURIComponent(`_u..nav=maui&_u.dateOption=${GA_DATE_OPTION[days]}&_u.comparisonOption=disabled`)
  return (
    `https://analytics.google.com/analytics/web/#/p${encodeURIComponent(propertyId)}/reports/dashboard` +
    `?params=${params}&ruid=${GA_REPORT},business-objectives,generate-leads&collectionId=business-objectives&r=${GA_REPORT}`
  )
}

/** The site's search performance in Search Console. */
export function searchConsoleLink(site: string): string {
  return `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(site)}`
}
