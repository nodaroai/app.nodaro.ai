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
  readonly sites: Readonly<Record<SiteEnvironment, SiteView>>
}

export type LatestResult =
  | { readonly status: "ok"; readonly version: string | null; readonly tagsUrl: string }
  | { readonly status: "not_configured" }
  | { readonly status: "error"; readonly message: string }

export interface HeaderVersionsReport {
  /** Whether the GitHub token is set; without it only a site's own file can be read. */
  readonly configured: boolean
  /** Entries of the deployment's product list that were refused (`index` -1: the whole setting). */
  readonly invalidProducts: readonly { readonly index: number; readonly reason: string }[]
  readonly latest: LatestResult
  readonly products: readonly ProductView[]
  readonly checkedAt: string
}

export interface HeaderVersionsService {
  report(opts: { fresh: boolean }): Promise<HeaderVersionsReport>
}
