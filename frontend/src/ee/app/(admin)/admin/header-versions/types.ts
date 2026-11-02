/** The shape `GET /v1/admin/header-versions` answers (`backend/src/ee/lib/header-versions/header-versions.ts`). */

export interface DeployView {
  readonly sha: string
  readonly commitUrl: string
  readonly deployedAt: string
  readonly deploying: boolean
  readonly lastFailed: boolean
}

export type VersionSource = "lockfile" | "package-json" | "site-file" | "pin"

export type Standing = "newest" | "behind" | "ahead"

export type SiteResult =
  | {
      readonly status: "ok"
      readonly version: string | null
      readonly header: boolean | null
      readonly source: VersionSource
      readonly deploy: DeployView | null
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

export type SiteEnvironment = "production" | "staging"

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
  readonly configured: boolean
  /** Entries of the deployment's product list that were refused (`index` -1: the whole setting). */
  readonly invalidProducts: readonly { readonly index: number; readonly reason: string }[]
  readonly latest: LatestResult
  readonly products: readonly ProductView[]
  readonly checkedAt: string
}
