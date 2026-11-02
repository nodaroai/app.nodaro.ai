import type { CommitFiles } from "./commit-files.js"
import type { Deployed } from "./deployed.js"
import { GitHubError, type FetchLike } from "./github.js"
import { HEADER_REPO, PIN_FILE, SITE_FILE, type HeaderProduct } from "./products.js"
import { compareVersions, declaredInPackageJson, isExactVersion, parseSiteFile, versionFromLockfile, versionFromPin, type SiteFile } from "./read-version.js"
import type { DeployView, SiteResult, VersionSource } from "./report-types.js"

/**
 * What one site serves, read from what its deployed commit installs or from
 * the file the site publishes itself.
 */

const SITE_TIMEOUT_MS = 8_000

/** GitHub hides a repository the token cannot read behind a 404. */
const ACCESS_HINT: Readonly<Record<number, string>> = {
  401: "The token is not valid (expired or revoked).",
  403: "The token may not read this repository, or its rate limit is spent.",
  404: "The token cannot see this repository, or it has no such file.",
  429: "GitHub's rate limit is spent; the page tries again on its next refresh.",
}

/** A refusal in GitHub's own words with what usually fixes it; anything else is logged and said plainly. */
export function failure(error: unknown, what: string): { status: "error"; message: string } {
  if (error instanceof GitHubError) {
    const hint = error.status !== null ? ACCESS_HINT[error.status] : undefined
    return { status: "error", message: hint ? `${error.message} ${hint}` : error.message }
  }
  console.error(`[header-versions] ${what} failed:`, error)
  return { status: "error", message: `Could not read ${what}.` }
}

/**
 * How an exact version stands against the newest release. Not ranked: a
 * declared range, and a pin (the environment's build can install another
 * version), or when either side is unknown.
 */
export function ranked(result: SiteResult, release: string | null): SiteResult {
  if (result.status !== "ok") return result
  if (release === null || result.source === "pin" || !isExactVersion(result.version)) return { ...result, standing: null }
  const order = compareVersions(result.version, release)
  return { ...result, standing: order === 0 ? "newest" : order < 0 ? "behind" : "ahead" }
}

/** The deployment as the page shows it. */
export function deployView(repo: string, deployed: Deployed): DeployView {
  return {
    sha: deployed.sha,
    commitUrl: `https://github.com/${repo}/commit/${deployed.sha}`,
    deployedAt: deployed.deployedAt,
    deploying: deployed.deploying,
    lastFailed: deployed.lastFailed,
  }
}

/** A version read; how it stands against the newest release is added once that is known (`ranked`). */
const read = (version: string | null, header: boolean | null, source: VersionSource, deploy: DeployView | null): SiteResult => ({
  status: "ok",
  version,
  header,
  source,
  deploy,
  standing: null,
})

/** A file the commit should have and that could not be read: said so, never shown as "no header". */
const unreadable = (path: string, deployed: Deployed): SiteResult => ({
  status: "error",
  message: `Could not read ${path} at ${deployed.sha.slice(0, 7)}.`,
})

/** A product whose commit fixes its version: the deployed lockfile, else the range its package.json declares. */
export async function readLockfileSite(files: CommitFiles, product: HeaderProduct, deployed: Deployed): Promise<SiteResult> {
  const packageName = await files.headerPackage()
  if (!packageName) return { status: "error", message: `Could not read the header's package name from ${HEADER_REPO}.` }
  const deploy = deployView(product.repo, deployed)
  const installed = versionFromLockfile((await files.at(product.repo, "package-lock.json", deployed.sha)) ?? "", packageName)
  if (installed) return read(installed, true, "lockfile", deploy)
  // Every product has a package.json: none at the commit means the read failed.
  const manifest = await files.at(product.repo, "package.json", deployed.sha)
  if (manifest === null) return unreadable("package.json", deployed)
  const declared = declaredInPackageJson(manifest, packageName)
  return read(declared, declared !== null, "package-json", deploy)
}

/** The site's own `shell-version.json`, asked past any cache; `null` when it does not serve one. */
async function fetchSiteFile(fetch: FetchLike, now: () => number, host: string): Promise<SiteFile | null> {
  try {
    const res = await fetch(`https://${host}/${SITE_FILE}?t=${now()}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(SITE_TIMEOUT_MS) })
    return res.ok ? parseSiteFile(await res.text()) : null
  } catch {
    return null
  }
}

export interface SiteFileDeps {
  /** `null` without the GitHub token. */
  readonly files: CommitFiles | null
  readonly fetch: FetchLike
  readonly now: () => number
}

/**
 * A product whose site says itself what it installed: the site's file first;
 * the deployed pin only when the site does not publish one yet. `noDeployment`
 * is why no deployment is known (GitHub refused), shown when the site has no
 * file either.
 */
export async function readSiteFileSite(
  deps: SiteFileDeps,
  product: HeaderProduct,
  host: string,
  deployed: Deployed | null,
  noDeployment: SiteResult | null,
): Promise<SiteResult> {
  const deploy = deployed ? deployView(product.repo, deployed) : null
  const published = await fetchSiteFile(deps.fetch, deps.now, host)
  if (published) return read(published.version, published.header, "site-file", deploy)
  if (!deps.files) return { status: "error", message: `${host} does not publish /${SITE_FILE} yet.` }
  if (noDeployment) return noDeployment
  if (!deployed) return { status: "no_deploy" }
  const pinned = versionFromPin((await deps.files.at(product.repo, PIN_FILE, deployed.sha)) ?? "")
  return pinned ? read(pinned, null, "pin", deploy) : unreadable(`the header pin (${PIN_FILE})`, deployed)
}
