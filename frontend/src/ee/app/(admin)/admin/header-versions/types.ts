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
  /** Where the site's worlds row leads, as the site says itself. */
  readonly worlds: SiteWorlds
}

/** One world's link on one site: where it leads, whether the site gave that address itself (else the header's own), and what it answered. */
export interface SiteWorldLink {
  readonly id: string
  readonly href: string
  readonly own: boolean
  readonly answer: LinkAnswer
}

/** Where a site's worlds row leads (`links` in the list's order; none when the row is hidden), or why it is not known. */
export type SiteWorlds =
  | { readonly status: "reported"; readonly worldsRow: boolean; readonly links: readonly SiteWorldLink[] }
  | { readonly status: "not_reported" }
  | { readonly status: "no_answer" }
  | { readonly status: "invalid"; readonly message: string }

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

/** One thing named in a figure, with an optional line about it. Plain text, never markup. */
export interface Named {
  readonly name: string
  readonly note?: string
}

export interface PhoneBand {
  readonly name: string
  readonly detail?: string
  readonly measure?: string
  readonly note?: string
}

export type AnatomyPart = "logo" | "worlds" | "developers" | "language" | "credits" | "account"

export interface AnatomyFigure {
  readonly heading: string
  readonly barLabel: string
  readonly parts: Readonly<Record<AnatomyPart, Named>>
  readonly caption?: string
}

export interface RuntimeFigure {
  readonly inside: readonly Named[]
  readonly toProducts: string
  readonly fromPages: string
  readonly services: readonly { readonly name: string; readonly address?: string; readonly via?: string; readonly note?: string }[]
  readonly caption?: string
}

export interface WorldsFigure {
  readonly heading: string
  readonly listLabel: string
  readonly groups: Readonly<Record<"simple" | "advanced", Named>>
  readonly toProducts: string
  readonly toDestinations: string
  readonly caption?: string
}

export interface ReleaseFigure {
  readonly heading: string
  readonly lanes: readonly { readonly name: string; readonly where?: string; readonly steps: readonly { readonly name: string; readonly gate?: string; readonly strong?: boolean }[] }[]
  readonly caption?: string
}

export interface PhoneFigure {
  readonly heading: string
  readonly header: PhoneBand
  readonly page: PhoneBand
  readonly productBar: PhoneBand
  readonly bottomBar: PhoneBand
  readonly a11y: { readonly measure?: string; readonly note?: string }
  readonly caption?: string
}

export interface ContractFigure {
  readonly heading: string
  readonly columns: readonly { readonly title: string; readonly items: readonly Named[] }[]
  readonly caption?: string
}

/** The words of each figure the page draws; a figure the file leaves out is not drawn. */
export interface MapFigures {
  readonly anatomy?: AnatomyFigure
  readonly runtime?: RuntimeFigure
  readonly worlds?: WorldsFigure
  readonly release?: ReleaseFigure
  readonly phone?: PhoneFigure
  readonly contract?: ContractFigure
}

/** The HTTP status a world's address answered (after redirects), or no answer. */
export type LinkAnswer = { readonly status: "answered"; readonly code: number } | { readonly status: "no_answer"; readonly message: string }

export interface WorldLink {
  readonly id: string
  readonly label: string
  readonly href: string
  readonly group: "simple" | "advanced"
  readonly answer: LinkAnswer
}

/** The header's explanations of itself, as its own repository keeps them. */
export type HeaderMapResult =
  | { readonly status: "ok"; readonly asOf: string; readonly url: string; readonly figures: MapFigures; readonly worlds: readonly WorldLink[] }
  | { readonly status: "missing" }
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
  /** How the header works, and what its worlds' addresses answer. */
  readonly headerMap: HeaderMapResult
  readonly products: readonly ProductView[]
  readonly checkedAt: string
}
