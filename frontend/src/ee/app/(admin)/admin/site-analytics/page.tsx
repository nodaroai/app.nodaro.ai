import { useState } from "react"
import { ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { siteDomainOf } from "./format"
import { analyticsLink, searchConsoleLink } from "./google-links"
import { RealtimeCard } from "./realtime-card"
import { SearchSection } from "./search-section"
import { SetupPanel } from "./setup-panel"
import { SourcesSection } from "./sources-section"
import { TrafficSection } from "./traffic-section"
import { SITE_ANALYTICS_DAYS, type SiteAnalyticsDays } from "./types"
import { useRefreshSiteAnalytics, useSiteAnalytics } from "./use-site-analytics"

/** Google's own screen for the same numbers, in a new tab — for whoever has access there. */
function GoogleLink({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
        <ExternalLink className="h-3.5 w-3.5 ms-1.5" />
      </a>
    </Button>
  )
}

/**
 * Google Analytics and Search Console for every admin, read on the server
 * with the deployment's service account — nobody needs a Google login.
 */
export default function AdminSiteAnalyticsPage() {
  const [days, setDays] = useState<SiteAnalyticsDays>(28)
  const { data, isLoading, isPlaceholderData, error } = useSiteAnalytics(days)
  const refresh = useRefreshSiteAnalytics()
  const busy = isPlaceholderData || refresh.isPending

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Site Analytics</h1>
          <p className="text-sm text-muted-foreground">Google Analytics and Search Console, read with the platform’s Google account.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />}
          {SITE_ANALYTICS_DAYS.map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
              {d} days
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => refresh.mutate(days)} disabled={!data || busy}>
            <RefreshCw className={`h-4 w-4 me-2 ${refresh.isPending ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {data?.setup.ga4PropertyId && <GoogleLink href={analyticsLink(data.setup.ga4PropertyId, days)} label="Google Analytics" />}
          {data?.setup.searchConsoleSite && <GoogleLink href={searchConsoleLink(data.setup.searchConsoleSite)} label="Search Console" />}
        </div>
      </div>

      {refresh.error && <p className="text-sm text-destructive">{refresh.error.message}</p>}

      {isLoading && !data ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{error?.message ?? "Failed to load site analytics."}</p>
      ) : (
        <>
          {data.setup.problems.length > 0 && <SetupPanel setup={data.setup} />}
          <RealtimeCard configured={data.setup.ga4PropertyId !== null && data.setup.serviceAccountEmail !== null} email={data.setup.serviceAccountEmail} />
          <TrafficSection result={data.traffic} days={data.days} email={data.setup.serviceAccountEmail} siteDomain={siteDomainOf(data.setup.searchConsoleSite)} />
          <SourcesSection result={data.sources} days={data.days} email={data.setup.serviceAccountEmail} />
          <SearchSection result={data.search} email={data.setup.serviceAccountEmail} />
          {data.setup.serviceAccountEmail && data.setup.problems.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Read as <span className="font-mono">{data.setup.serviceAccountEmail}</span>
              {data.setup.ga4PropertyId ? ` · GA4 property ${data.setup.ga4PropertyId}` : ""}
              {data.setup.searchConsoleSite ? ` · ${data.setup.searchConsoleSite}` : ""}
            </p>
          )}
        </>
      )}
    </div>
  )
}
