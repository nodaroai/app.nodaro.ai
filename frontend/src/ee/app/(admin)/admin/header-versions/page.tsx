import type { ReactNode } from "react"
import { ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isCloud } from "@/lib/edition"
import { cn } from "@/lib/utils"
import type { HeaderVersionsReport, ProductView, SiteEnvironment, SiteResult, SiteView, Standing } from "./types"
import { useHeaderVersions, useRefreshHeaderVersions } from "./use-header-versions"

/**
 * Header versions — which version of the shared header every product's live
 * site and test site serves right now, beside the newest
 * release. The server reads the commit each site last deployed and the version
 * that commit installs; the App says itself what its build installed and
 * whether it shows the header. Read-only.
 */

const ENVIRONMENTS: ReadonlyArray<{ key: SiteEnvironment; label: string }> = [
  { key: "production", label: "Live site" },
  { key: "staging", label: "Test site" },
]

const when = (iso: string) => new Date(iso).toLocaleString()

const BADGE_TONES = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  bad: "bg-destructive/10 text-destructive",
  quiet: "bg-muted text-muted-foreground",
} as const

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", BADGE_TONES[tone])}>{children}</span>
}

const STANDING_BADGE: Record<Standing, { tone: keyof typeof BADGE_TONES; text: string }> = {
  newest: { tone: "good", text: "Newest" },
  behind: { tone: "warn", text: "Behind" },
  ahead: { tone: "info", text: "Ahead of the release" },
}

type Reading = Extract<SiteResult, { status: "ok" }>

/**
 * A site that hides the header shows "Header off" first; the package it still
 * installs is the small print. A pin says what the commit would install, not
 * what the site installed or whether it shows it: small print too.
 */
function versionText(result: Reading): string {
  if (result.source === "pin") return "Unknown yet"
  if (result.version === null) return "No header"
  if (result.header === false) return "Header off"
  return result.source === "package-json" ? `${result.version} (declared)` : result.version
}

function smallPrint(result: Reading): string | null {
  if (result.source === "pin") return `The commit pins ${result.version}; this site does not publish what it installed yet.`
  if (result.header === false && result.version !== null) return `Package ${result.version} installed, header not shown`
  return null
}

/** A link that opens a new tab, and says so to a screen reader. */
function NewTabLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function SiteCell({ site }: { site: SiteView }) {
  const { result } = site
  return (
    <td className="px-4 py-3 align-top">
      {result.status === "ok" ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold tabular-nums" data-testid="site-version">
              {versionText(result)}
            </span>
            {result.standing && result.header !== false && <Badge tone={STANDING_BADGE[result.standing].tone}>{STANDING_BADGE[result.standing].text}</Badge>}
            {result.deploy?.deploying && <Badge tone="info">Deploying…</Badge>}
            {result.deploy?.lastFailed && <Badge tone="bad">Last deploy failed</Badge>}
          </div>
          {smallPrint(result) && <p className="text-xs text-muted-foreground">{smallPrint(result)}</p>}
          {result.deploy && (
            <p className="text-xs text-muted-foreground">
              <NewTabLink href={result.deploy.commitUrl} className="font-mono hover:underline">
                {result.deploy.sha.slice(0, 7)}
              </NewTabLink>
              {" · deployed "}
              {when(result.deploy.deployedAt)}
            </p>
          )}
        </div>
      ) : (
        <p className={cn("text-sm", result.status === "error" ? "text-destructive" : "text-muted-foreground")}>
          {result.status === "error" ? result.message : result.status === "no_deploy" ? "No successful deploy found" : "Needs the GitHub token"}
        </p>
      )}
      <NewTabLink href={site.url} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
        {site.host}
        <ExternalLink className="h-3 w-3" aria-hidden />
      </NewTabLink>
    </td>
  )
}

function ProductRow({ product }: { product: ProductView }) {
  return (
    <tr className="border-t" data-testid={`product-${product.id}`}>
      <th scope="row" className="px-4 py-3 text-start align-top font-semibold">
        {product.label}
      </th>
      {ENVIRONMENTS.map(({ key }) => (
        <SiteCell key={key} site={product.sites[key]} />
      ))}
    </tr>
  )
}

function SetupNotice({ report }: { report: HeaderVersionsReport }) {
  return (
    <div data-testid="header-versions-setup" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      GitHub is not connected, so only the App's own sites can answer. Set <code>HEADER_VERSIONS_GITHUB_TOKEN</code> to a
      fine-grained token with read-only <strong>Contents</strong> and <strong>Deployments</strong> access to:{" "}
      {[...report.products.map((p) => p.repo), "nodaroai/shell"].map((repo, i) => (
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

function LatestLine({ report }: { report: HeaderVersionsReport }) {
  const { latest } = report
  if (latest.status === "ok") {
    return (
      <>
        Newest release:{" "}
        <NewTabLink href={latest.tagsUrl} className="font-medium text-foreground hover:underline">
          {latest.version ?? "none tagged"}
        </NewTabLink>
        .{" "}
      </>
    )
  }
  if (latest.status === "error") return <span className="text-destructive">Newest release unknown: {latest.message} </span>
  return null
}

function VersionsTable({ products }: { products: HeaderVersionsReport["products"] }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 text-start font-medium">
              Product
            </th>
            {ENVIRONMENTS.map(({ key, label }) => (
              <th key={key} scope="col" className="px-4 py-2 text-start font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <ProductRow key={product.id} product={product} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function HeaderVersionsPage() {
  const { data, isLoading, isError, error } = useHeaderVersions()
  const refresh = useRefreshHeaderVersions()

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

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold">Header versions</h1>
        <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RefreshCw className={cn("me-2 h-4 w-4", refresh.isPending && "animate-spin")} />
          Refresh
        </Button>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Which version of the shared header each product serves right now, read from what each site last deployed.{" "}
        <LatestLine report={data} />
        Checked {when(data.checkedAt)}.
      </p>
      {refresh.isError && <p className="mb-4 text-sm text-destructive">Could not refresh: {refresh.error.message}</p>}
      {isError && !refresh.isError && (
        <p className="mb-4 text-sm text-destructive">Could not refresh{error instanceof Error ? `: ${error.message}` : ""}. Showing the last answer.</p>
      )}
      <ProductsNotice report={data} />
      {!data.configured && data.products.length > 0 && <SetupNotice report={data} />}
      {data.products.length > 0 && <VersionsTable products={data.products} />}
    </div>
  )
}
