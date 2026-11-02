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
      /** How many releases a site behind lacks; `null` when not behind or unknown. */
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

export type SiteEnvironment = "production" | "staging"

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
  readonly url: string | null
}

/** A release newer than the oldest version a site serves: what it brought, and the sites without it. */
export interface ReleaseNote {
  readonly version: string
  /** The release in plain words; `null` while it is being written, or when no model could. */
  readonly summary: string | null
  readonly releasedAt: string | null
  readonly url: string
  readonly changes: readonly ReleaseChange[]
  readonly missingOn: readonly { readonly productId: string; readonly environment: SiteEnvironment }[]
}

export type ReleaseNotesResult =
  /** `compared`: the sites whose version was compared (0: none could be, or no release is tagged). */
  | { readonly status: "ok"; readonly releases: readonly ReleaseNote[]; readonly older: number; readonly compared: number }
  | { readonly status: "not_configured" }
  | { readonly status: "error"; readonly message: string }

export interface HeaderVersionsReport {
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
