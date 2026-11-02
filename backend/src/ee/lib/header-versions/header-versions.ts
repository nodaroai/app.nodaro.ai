import { config } from "../../../lib/config.js"
import { createTtlCache } from "../site-analytics/ttl-cache.js"
import { createCommitFiles, type CommitFiles } from "./commit-files.js"
import { liveDeployment, type Deployed, type DeploymentRecord } from "./deployed.js"
import { createDeploymentSource, type DeploymentSource } from "./deployment-source.js"
import { createGitHubReader, type FetchLike, type GitHubReader } from "./github.js"
import { HEADER_REPO, parseHeaderProducts, type HeaderProduct, type ParsedProducts, type SiteEnvironment } from "./products.js"
import { releasesOf, type Release } from "./read-version.js"
import { createReleaseNotes, type ReleaseNotes, type SiteVersion } from "./release-notes.js"
import { createReleaseSummaries, type Summarize } from "./release-summary.js"
import type { HeaderVersionsReport, HeaderVersionsService, LatestResult, ProductView, ReleaseNotesResult, SiteResult, SiteView } from "./report-types.js"
import { failure, ranked, readLockfileSite, readSiteFileSite } from "./site-readings.js"

export type {
  DeployView,
  HeaderVersionsReport,
  HeaderVersionsService,
  LatestResult,
  ProductView,
  ReleaseNote,
  ReleaseNotesResult,
  SiteResult,
  SiteView,
  Standing,
  VersionSource,
} from "./report-types.js"

const ENVIRONMENTS: readonly SiteEnvironment[] = ["production", "staging"]
export { ranked } from "./site-readings.js"

/**
 * Which version of the shared header every product serves, on its live site
 * and its test site, beside the newest release. Read-only; every admin sees
 * the same answer, built at most once a minute per process. Deployments and
 * their statuses are asked again on every build (conditionally, see
 * `github.ts`); what never changes is kept: a file at a commit, the commits
 * between two release tags, and a release's plain summary.
 */

const REPORT_TTL_MS = 60_000
/** A held-down Refresh gets the answer of the last 15 seconds. */
const MIN_FRESH_MS = 15_000

/** What a build reads from; GitHub's parts are `null` without the token. */
interface Sources {
  readonly github: GitHubReader | null
  readonly files: CommitFiles | null
  readonly deployments: DeploymentSource | null
  readonly notes: ReleaseNotes | null
  readonly fetch: FetchLike
  readonly now: () => number
  readonly products: ParsedProducts
}

/** A repository's deployments, or why GitHub would not list them. */
interface Listing {
  readonly records: readonly DeploymentRecord[] | null
  readonly refusal: SiteResult | null
}

async function listDeployments(src: Sources, repo: string): Promise<Listing> {
  if (!src.deployments) return { records: null, refusal: null }
  try {
    return { records: await src.deployments.of(repo), refusal: null }
  } catch (error) {
    return { records: null, refusal: failure(error, `${repo}'s deployments`) }
  }
}

function liveOf(src: Sources, product: HeaderProduct, environment: SiteEnvironment, listing: Listing): Promise<Deployed | null> {
  const { github } = src
  if (!github || !listing.records) return Promise.resolve(null)
  return liveDeployment(listing.records, environment, (record) => github.statuses(product.repo, record.id))
}

/** The App's kind of site: its own file needs no GitHub, so a status GitHub fails to answer only loses the commit line. */
async function siteFileResult(src: Sources, product: HeaderProduct, environment: SiteEnvironment, listing: Listing): Promise<SiteResult> {
  const host = product.hosts[environment]
  let deployed: Deployed | null = null
  let refusal = listing.refusal
  try {
    deployed = await liveOf(src, product, environment, listing)
  } catch (error) {
    refusal = failure(error, `${host}'s deployments`)
  }
  return readSiteFileSite(src, product, host, deployed, refusal)
}

async function siteView(src: Sources, product: HeaderProduct, environment: SiteEnvironment, listing: Listing): Promise<SiteView> {
  const host = product.hosts[environment]
  const view = (result: SiteResult): SiteView => ({ host, url: `https://${host}`, result })
  try {
    if (product.source === "site-file") return view(await siteFileResult(src, product, environment, listing))
    if (!src.files) return view({ status: "not_configured" })
    if (listing.refusal) return view(listing.refusal)
    const deployed = await liveOf(src, product, environment, listing)
    return view(deployed ? await readLockfileSite(src.files, product, deployed) : { status: "no_deploy" })
  } catch (error) {
    return view(failure(error, `${host}'s header version`))
  }
}

async function productView(src: Sources, product: HeaderProduct): Promise<ProductView> {
  const listing = await listDeployments(src, product.repo)
  const [production, staging] = await Promise.all([siteView(src, product, "production", listing), siteView(src, product, "staging", listing)])
  return { id: product.id, label: product.label, repo: product.repo, icon: product.icon, sites: { production, staging } }
}

/** The header's releases, oldest first, and the newest of them. */
async function headerReleases(src: Sources): Promise<{ latest: LatestResult; releases: readonly Release[] }> {
  if (!src.github) return { latest: { status: "not_configured" }, releases: [] }
  try {
    const releases = releasesOf(await src.github.tags(HEADER_REPO))
    return { latest: { status: "ok", version: releases.at(-1)?.version ?? null, tagsUrl: `https://github.com/${HEADER_REPO}/tags` }, releases }
  } catch (error) {
    return { latest: failure(error, "the header's releases"), releases: [] }
  }
}

/** The versions the sites serve that a release can be compared with: never a pin (not what was installed) or a range. */
function siteVersions(views: readonly ProductView[]): SiteVersion[] {
  return views.flatMap((view) =>
    ENVIRONMENTS.flatMap((environment) => {
      const { result } = view.sites[environment]
      if (result.status !== "ok" || result.version === null || result.source === "pin" || result.source === "package-json") return []
      return [{ productId: view.id, environment, version: result.version }]
    }),
  )
}

function releaseNotes(src: Sources, latest: LatestResult, releases: readonly Release[], views: readonly ProductView[]): Promise<ReleaseNotesResult> {
  if (!src.notes) return Promise.resolve({ status: "not_configured" })
  if (latest.status !== "ok") return Promise.resolve(latest)
  return src.notes.since(releases, siteVersions(views))
}

/** The name the page titles itself with; a failed read only loses the title. */
async function headerPackage(src: Sources): Promise<string | null> {
  if (!src.files) return null
  return src.files.headerPackage().catch(() => null)
}

async function build(src: Sources): Promise<HeaderVersionsReport> {
  const [{ latest, releases }, views, packageName] = await Promise.all([
    headerReleases(src),
    Promise.all(src.products.products.map((product) => productView(src, product))),
    headerPackage(src),
  ])
  const release = latest.status === "ok" ? latest.version : null
  const versions = releases.map((r) => r.version)
  const rank = (site: SiteView): SiteView => ({ ...site, result: ranked(site.result, release, versions) })
  return {
    configured: src.github !== null,
    invalidProducts: src.products.invalid,
    headerPackage: packageName,
    latest,
    releaseNotes: await releaseNotes(src, latest, releases, views),
    products: views.map((view) => ({ ...view, sites: { production: rank(view.sites.production), staging: rank(view.sites.staging) } })),
    checkedAt: new Date(src.now()).toISOString(),
  }
}

/**
 * The report service. `env.productsJson` is the deployment's product list
 * (`HEADER_VERSIONS_PRODUCTS`); without a token (and no `github` given)
 * GitHub is never asked, and only a site's own file answers. `deps` are test
 * seams.
 */
export function createHeaderVersions(
  env: { githubToken: string; productsJson?: string },
  deps: { fetch?: FetchLike; github?: GitHubReader; now?: () => number; products?: readonly HeaderProduct[]; summarize?: Summarize } = {},
): HeaderVersionsService {
  const fetch: FetchLike = deps.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const now = deps.now ?? Date.now
  const token = env.githubToken.trim()
  const github = deps.github ?? (token ? createGitHubReader(token, { fetch }) : null)
  const src: Sources = {
    github,
    files: github ? createCommitFiles(github) : null,
    deployments: github ? createDeploymentSource(github) : null,
    notes: github ? createReleaseNotes(github, deps.summarize ?? createReleaseSummaries()) : null,
    fetch,
    now,
    products: deps.products ? { products: deps.products, invalid: [] } : parseHeaderProducts(env.productsJson),
  }
  const reports = createTtlCache<HeaderVersionsReport>({ ttlMs: REPORT_TTL_MS, maxEntries: 1, minFreshMs: MIN_FRESH_MS, now })
  return {
    async report({ fresh }) {
      return (await reports.get("all", () => build(src), { fresh })).value
    },
  }
}

let shared: HeaderVersionsService | null = null

/** The deployment's service, built on first use from its environment — never at import. */
export function headerVersions(): HeaderVersionsService {
  shared ??= createHeaderVersions({ githubToken: config.HEADER_VERSIONS_GITHUB_TOKEN, productsJson: config.HEADER_VERSIONS_PRODUCTS })
  return shared
}
