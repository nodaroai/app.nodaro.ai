import type { SiteEnvironment } from "./products.js"

/** The shape the Header versions report answers — `GET /v1/admin/header-versions`. */

/** The deployment a site serves: its commit and how it went live. */
export interface DeployView {
  readonly sha: string
  readonly commitUrl: string
  readonly deployedAt: string
  readonly deploying: boolean
  readonly lastFailed: boolean
}

/**
 * Where a version was read: the deployed lockfile, the deployed `package.json`
 * (a declared range — not what was installed), the site's own file, or the
 * deployed pin (the site does not publish its file yet).
 */
export type VersionSource = "lockfile" | "package-json" | "site-file" | "pin"

/** How a version compares with the newest release. */
export type Standing = "newest" | "behind" | "ahead"

/** One site's answer: the version it serves, or why there is none. */
export type SiteResult =
  | {
      readonly status: "ok"
      /** `null`: this deployment carries no header. */
      readonly version: string | null
      /** Whether the site shows the header; `null` when only the pin was read. */
      readonly header: boolean | null
      readonly source: VersionSource
      readonly deploy: DeployView | null
      /** Against the newest release; `null` when either side is unknown, or for a range or a pin. */
      readonly standing: Standing | null
      /** How many releases a site behind lacks (counted on the header's tags); `null` when not behind or unknown. */
      readonly releasesBehind: number | null
    }
  | { readonly status: "not_configured" }
  | { readonly status: "no_deploy" }
  | { readonly status: "error"; readonly message: string }

export interface SiteView {
  readonly host: string
  readonly url: string
  readonly result: SiteResult
}

export interface ProductView {
  readonly id: string
  readonly label: string
  readonly repo: string
  /** The picture's name from the product list; `null` when the list gives none. */
  readonly icon: string | null
  readonly sites: Readonly<Record<SiteEnvironment, SiteView>>
}

export type LatestResult =
  | { readonly status: "ok"; readonly version: string | null; readonly tagsUrl: string }
  | { readonly status: "not_configured" }
  | { readonly status: "error"; readonly message: string }

/** One change a release brought: a merged pull request, or a commit when the release merged none. */
export interface ReleaseChange {
  readonly title: string
  readonly kind: "feature" | "fix" | "other"
  /** The pull request; `null` for a commit pushed without one. */
  readonly url: string | null
}

/** A release newer than the oldest version a site serves: what it brought, and the sites without it. */
export interface ReleaseNote {
  readonly version: string
  /** The release in plain words for the admin; `null` while it is being written, or when no model could. */
  readonly summary: string | null
  readonly releasedAt: string | null
  /** The release's changes on GitHub (the comparison with the release before it). */
  readonly url: string
  readonly changes: readonly ReleaseChange[]
  /** The sites serving an older version. */
  readonly missingOn: readonly { readonly productId: string; readonly environment: SiteEnvironment }[]
}

export type ReleaseNotesResult =
  /** Newest first; `older`: releases past the ones listed; `compared`: the sites whose version was compared (0: none could be). */
  | { readonly status: "ok"; readonly releases: readonly ReleaseNote[]; readonly older: number; readonly compared: number }
  | { readonly status: "not_configured" }
  | { readonly status: "error"; readonly message: string }

export interface HeaderVersionsReport {
  /** Whether the GitHub token is set; without it only a site's own file can be read. */
  readonly configured: boolean
  /** Entries of the deployment's product list that were refused (`index` -1: the whole setting). */
  readonly invalidProducts: readonly { readonly index: number; readonly reason: string }[]
  /** The header's package name, as its own repository gives it; `null` without the token or when unreadable. */
  readonly headerPackage: string | null
  readonly latest: LatestResult
  /** What each release since the oldest version in use brought. */
  readonly releaseNotes: ReleaseNotesResult
  readonly products: readonly ProductView[]
  readonly checkedAt: string
}

export interface HeaderVersionsService {
  report(opts: { fresh: boolean }): Promise<HeaderVersionsReport>
}
