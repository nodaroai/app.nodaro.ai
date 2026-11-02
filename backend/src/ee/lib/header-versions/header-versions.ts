import { config } from "../../../lib/config.js"
import { createTtlCache } from "../site-analytics/ttl-cache.js"
import { createCommitFiles, type CommitFiles } from "./commit-files.js"
import { liveDeployment, type Deployed, type DeploymentRecord } from "./deployed.js"
import { createDeploymentSource, type DeploymentSource } from "./deployment-source.js"
import { createGitHubReader, type FetchLike, type GitHubReader } from "./github.js"
import { HEADER_REPO, parseHeaderProducts, type HeaderProduct, type ParsedProducts, type SiteEnvironment } from "./products.js"
import { latestRelease } from "./read-version.js"
import type { HeaderVersionsReport, HeaderVersionsService, LatestResult, ProductView, SiteResult, SiteView } from "./report-types.js"
import { failure, ranked, readLockfileSite, readSiteFileSite } from "./site-readings.js"

export type { DeployView, HeaderVersionsReport, HeaderVersionsService, LatestResult, ProductView, SiteResult, SiteView, Standing, VersionSource } from "./report-types.js"
export { ranked } from "./site-readings.js"

/**
 * Which version of the shared header every product serves, on its live site
 * and its test site, beside the newest release. Read-only; every admin sees
 * the same answer, built at most once a minute per process. Deployments and
 * their statuses are asked again on every build (conditionally, see
 * `github.ts`); only a file at a commit — which never changes — is kept.
 */

const REPORT_TTL_MS = 60_000
/** A held-down Refresh gets the answer of the last 15 seconds. */
const MIN_FRESH_MS = 15_000

/** What a build reads from; GitHub's parts are `null` without the token. */
interface Sources {
  readonly github: GitHubReader | null
  readonly files: CommitFiles | null
  readonly deployments: DeploymentSource | null
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
  return { id: product.id, label: product.label, repo: product.repo, sites: { production, staging } }
}

async function newestRelease(src: Sources): Promise<LatestResult> {
  if (!src.github) return { status: "not_configured" }
  try {
    return { status: "ok", version: latestRelease(await src.github.tags(HEADER_REPO)), tagsUrl: `https://github.com/${HEADER_REPO}/tags` }
  } catch (error) {
    return failure(error, "the header's releases")
  }
}

async function build(src: Sources): Promise<HeaderVersionsReport> {
  const [latest, views] = await Promise.all([newestRelease(src), Promise.all(src.products.products.map((product) => productView(src, product)))])
  const release = latest.status === "ok" ? latest.version : null
  const rank = (site: SiteView): SiteView => ({ ...site, result: ranked(site.result, release) })
  return {
    configured: src.github !== null,
    invalidProducts: src.products.invalid,
    latest,
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
  deps: { fetch?: FetchLike; github?: GitHubReader; now?: () => number; products?: readonly HeaderProduct[] } = {},
): HeaderVersionsService {
  const fetch: FetchLike = deps.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const now = deps.now ?? Date.now
  const token = env.githubToken.trim()
  const github = deps.github ?? (token ? createGitHubReader(token, { fetch }) : null)
  const src: Sources = {
    github,
    files: github ? createCommitFiles(github) : null,
    deployments: github ? createDeploymentSource(github) : null,
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
