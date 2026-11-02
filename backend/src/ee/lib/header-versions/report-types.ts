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
  /** Where the site's worlds row leads, as the site says itself. */
  readonly worlds: SiteWorlds
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

/** One thing named in a figure, with an optional line about it. Plain text, never markup. */
export interface Named {
  readonly name: string
  readonly note?: string
}

/** A band of the phone figure; `measure` names the CSS property that sizes it. */
export interface PhoneBand {
  readonly name: string
  readonly detail?: string
  readonly measure?: string
  readonly note?: string
}

/** The words of each figure the page draws; a figure the file leaves out is not drawn. */
export interface MapFigures {
  readonly anatomy?: {
    readonly heading: string
    readonly barLabel: string
    readonly parts: Readonly<Record<"logo" | "worlds" | "developers" | "language" | "credits" | "account", Named>>
    readonly caption?: string
  }
  readonly runtime?: {
    readonly inside: readonly Named[]
    readonly toProducts: string
    readonly fromPages: string
    readonly services: readonly { readonly name: string; readonly address?: string; readonly via?: string; readonly note?: string }[]
    readonly caption?: string
  }
  readonly worlds?: {
    readonly heading: string
    readonly listLabel: string
    readonly groups: Readonly<Record<"simple" | "advanced", Named>>
    readonly toProducts: string
    readonly toDestinations: string
    readonly caption?: string
  }
  readonly release?: {
    readonly heading: string
    readonly lanes: readonly { readonly name: string; readonly where?: string; readonly steps: readonly { readonly name: string; readonly gate?: string; readonly strong?: boolean }[] }[]
    readonly caption?: string
  }
  readonly phone?: {
    readonly heading: string
    readonly header: PhoneBand
    readonly page: PhoneBand
    readonly productBar: PhoneBand
    readonly bottomBar: PhoneBand
    readonly a11y: { readonly measure?: string; readonly note?: string }
    readonly caption?: string
  }
  readonly contract?: {
    readonly heading: string
    readonly columns: readonly { readonly title: string; readonly items: readonly Named[] }[]
    readonly caption?: string
  }
}

/**
 * What a world's address answered when the page asked it: the HTTP status
 * after redirects, or no answer. A site that serves one page at every address
 * answers 200 even where no such page exists; only a real "not found" tells.
 */
export type LinkAnswer = { readonly status: "answered"; readonly code: number } | { readonly status: "no_answer"; readonly message: string }

/** A world of the header's worlds row, at the address the header gives it by default. */
export interface WorldLink {
  readonly id: string
  readonly label: string
  readonly href: string
  readonly group: "simple" | "advanced"
  readonly answer: LinkAnswer
}

/** One world's link on one site: where it leads, whether the site gave that address itself (else the header's own), and what it answered. */
export interface SiteWorldLink {
  readonly id: string
  readonly href: string
  readonly own: boolean
  readonly answer: LinkAnswer
}

/**
 * Where a site's worlds row leads, as its own `/shell-worlds.json` says:
 * every world of the header's list in its order (none when the row is
 * hidden, or the list is unknown); `not_reported` when the site serves no
 * such file; `no_answer` when the site did not answer, or failed;
 * `invalid` when it serves one this page cannot read.
 */
export type SiteWorlds =
  | { readonly status: "reported"; readonly worldsRow: boolean; readonly links: readonly SiteWorldLink[] }
  | { readonly status: "not_reported" }
  | { readonly status: "no_answer" }
  | { readonly status: "invalid"; readonly message: string }

/** The header's explanations of itself, as its own repository keeps them. */
export type HeaderMapResult =
  | {
      readonly status: "ok"
      /** The header version the text was written for. */
      readonly asOf: string
      /** The file on GitHub. */
      readonly url: string
      readonly figures: MapFigures
      readonly worlds: readonly WorldLink[]
    }
  /** The header's repository keeps no such file (yet). */
  | { readonly status: "missing" }
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
  /** How the header works, and what its worlds' addresses answer. */
  readonly headerMap: HeaderMapResult
  readonly products: readonly ProductView[]
  readonly checkedAt: string
}

export interface HeaderVersionsService {
  report(opts: { fresh: boolean }): Promise<HeaderVersionsReport>
}
