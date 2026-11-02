import { Loader2 } from "lucide-react"
import { isCloud } from "@/lib/edition"
import { HeaderExplained } from "./header-explained"
import { ProductCard } from "./product-card"
import { ReleaseNotes } from "./release-notes"
import { CARD_GAP_PX, Connector, Legend, ShellSummary } from "./shell-summary"
import type { HeaderVersionsReport } from "./types"
import { ServicesRow } from "./services-row"
import { useHeaderVersions, useRefreshHeaderVersions } from "./use-header-versions"

/**
 * Header versions — which version of the shared header every product's live
 * site and test site serves right now, beside the newest
 * release. The server reads the commit each site last deployed and the version
 * that commit installs; the App says itself what its build installed and
 * whether it shows the header. Below: what each newer release brought, what
 * the worlds' addresses answer, and how the header works in its own words
 * (kept in its repository). Read-only.
 */

/** A card is never narrower than this; past the screen's width the map scrolls sideways. */
const CARD_MIN_PX = 150

function SetupNotice({ report }: { report: HeaderVersionsReport }) {
  return (
    <div data-testid="header-versions-setup" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      GitHub is not connected, so only the App's own sites can answer. Set <code>HEADER_VERSIONS_GITHUB_TOKEN</code> to a
      fine-grained token with read-only <strong>Contents</strong> and <strong>Deployments</strong> access to:{" "}
      {[...new Set([...report.products.map((p) => p.repo), "nodaroai/shell"])].map((repo, i) => (
        <span key={repo}>
          {i > 0 && ", "}
          <code>{repo}</code>
        </span>
      ))}
      .
    </div>
  )
}

/** The deployment's product list: missing, or with entries the server refused. */
function ProductsNotice({ report }: { report: HeaderVersionsReport }) {
  if (report.products.length > 0 && report.invalidProducts.length === 0) return null
  return (
    <div data-testid="header-versions-products" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      {report.products.length === 0 && (
        <p>
          No products are listed. Set <code>HEADER_VERSIONS_PRODUCTS</code> to a JSON array of{" "}
          <code>{"{ id, label, repo, production, staging, source }"}</code>, where <code>source</code> is <code>lockfile</code> or{" "}
          <code>site-file</code>.
        </p>
      )}
      {report.invalidProducts.map((entry) => (
        <p key={entry.index}>{entry.index < 0 ? entry.reason : `Entry ${entry.index + 1}: ${entry.reason}`}</p>
      ))}
    </div>
  )
}

/**
 * Every product under the header, one card each, in the order the setting
 * lists them; under them, when the header's repository describes them, the
 * services the header reaches from every product's page.
 */
function ProductMap({ report }: { report: HeaderVersionsReport }) {
  const count = report.products.length
  const runtime = report.headerMap.status === "ok" ? report.headerMap.figures.runtime : undefined
  return (
    <>
      <Connector count={count} label={runtime?.toProducts} />
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, gap: CARD_GAP_PX }}>
        {report.products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </ul>
      {runtime && <ServicesRow runtime={runtime} products={count} gap={CARD_GAP_PX} />}
      <Legend />
      {runtime?.caption && <p className="mx-auto mt-4 max-w-[78ch] text-center text-[13px] leading-relaxed text-muted-foreground">{runtime.caption}</p>}
    </>
  )
}

function Report({ report, error }: { report: HeaderVersionsReport; error: string | null }) {
  const refresh = useRefreshHeaderVersions()
  const count = report.products.length
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="sr-only">Header versions</h1>
      {refresh.isError && <p className="mb-4 text-sm text-destructive">Could not refresh: {refresh.error.message}</p>}
      {error !== null && !refresh.isError && <p className="mb-4 text-sm text-destructive">Could not refresh{error ? `: ${error}` : ""}. Showing the last answer.</p>}
      <ProductsNotice report={report} />
      {!report.configured && count > 0 && <SetupNotice report={report} />}
      <div className="overflow-x-auto">
        <div className="rounded-2xl border bg-card px-6 pb-8 pt-7" style={{ minWidth: Math.max(640, count * (CARD_MIN_PX + CARD_GAP_PX) + 48) }}>
          <ShellSummary report={report} refreshing={refresh.isPending} onRefresh={() => refresh.mutate()} />
          {count > 0 && <ProductMap report={report} />}
        </div>
      </div>
      {count > 0 && <ReleaseNotes report={report} />}
      <HeaderExplained report={report} />
    </div>
  )
}

export default function HeaderVersionsPage() {
  const { data, isLoading, isError, error } = useHeaderVersions()

  if (!isCloud()) {
    return <div className="p-6 text-muted-foreground">Header versions are tracked on Nodaro Cloud only.</div>
  }
  if (isLoading) {
    return (
      <div role="status" className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading header versions</span>
      </div>
    )
  }
  // A failed background poll keeps the last answer on screen; only a first load that failed has nothing to show.
  if (!data) {
    return <div className="p-6 text-muted-foreground">{error instanceof Error ? error.message : "Failed to load header versions."}</div>
  }
  return <Report report={data} error={isError ? (error instanceof Error ? error.message : "") : null} />
}
