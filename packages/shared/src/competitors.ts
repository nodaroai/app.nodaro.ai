/**
 * Competitors — the wire contract of the competitor tracking area.
 *
 * A person tracks brands (competitors, or their own brand): their accounts,
 * where to look for posts that name them, and a schedule. Each scan reads the
 * accounts and searches the name, one Social Search page per search, and
 * produces action cards: what happened, why it matters, what to do, with the
 * posts it rests on.
 *
 * Why public: these are the shapes `/v1/competitors*` answers and the SDK's
 * `competitors` resource types; the card `kind` vocabulary is what a client
 * phrases a card by. How a card is decided is not part of the contract.
 */
import type { SocialPlatform, SocialPost } from "./social-search.js"
import { SOCIAL_SEARCH_CREDITS_PER_PAGE } from "./social-search.js"

/** The accounts a scan reads straight from. */
export const COMPETITOR_ACCOUNT_KEYS = ["tiktok", "instagram", "youtube", "x", "linkedin", "meta_ads"] as const
export type CompetitorAccountKey = (typeof COMPETITOR_ACCOUNT_KEYS)[number]

/** Where a scan looks for posts that name the brand. */
export const COMPETITOR_ABOUT_PLATFORMS = ["tiktok", "instagram", "youtube", "x", "reddit", "linkedin"] as const
export type CompetitorAboutPlatform = (typeof COMPETITOR_ABOUT_PLATFORMS)[number]
export const COMPETITOR_DEFAULT_ABOUT_PLATFORMS: readonly CompetitorAboutPlatform[] = ["tiktok", "instagram", "youtube", "x", "reddit"]

export const COMPETITOR_SCHEDULES = ["off", "weekly", "daily"] as const
export type CompetitorSchedule = (typeof COMPETITOR_SCHEDULES)[number]

/** One search per account and per about-platform. */
export const COMPETITOR_SCAN_MAX_SEARCHES = COMPETITOR_ACCOUNT_KEYS.length + COMPETITOR_ABOUT_PLATFORMS.length
export const COMPETITOR_SCAN_NODE_TYPE = "competitor-scan"
/** How many brands one person can track. */
export const COMPETITORS_MAX = 50

export type CompetitorAccounts = Partial<Record<CompetitorAccountKey, string>>

export interface TrackedCompetitor {
  readonly id: string
  readonly brand: string
  readonly website: string
  readonly accounts: CompetitorAccounts
  readonly aboutPlatforms: readonly CompetitorAboutPlatform[]
  /** The person's own brand: cards speak to them. */
  readonly isOwn: boolean
  readonly schedule: CompetitorSchedule
  readonly nextScanAt: string | null
  readonly lastScanAt: string | null
  readonly lastScanId: string | null
  /** Why the last scan (or scheduled start) fell short; null when it did not. */
  readonly lastScanError: string | null
  /** A scan is running now. */
  readonly scanning: boolean
  /** Searches one scan runs; a scan costs this many Social Search pages. */
  readonly searches: number
  readonly createdAt: string
  readonly updatedAt: string
}

export const ACTION_CARD_KINDS = [
  "outlier",
  "launch",
  "complaints",
  "spreading",
  "sound",
  "mentions_up",
  "pace",
  "market_sound",
  "top_in_sources",
] as const
export type ActionCardKind = (typeof ACTION_CARD_KINDS)[number]

/** 1 = act now · 2 = an opening worth taking · 3 = good to know. */
export type ActionCardPriority = 1 | 2 | 3

export interface ActionCard {
  /** Stable across scans for the same finding. */
  readonly id: string
  readonly kind: ActionCardKind
  readonly priority: ActionCardPriority
  /** How strong the finding is within its kind, 0 to 1. The API returns
   *  cards already in order (priority, then kind, then strength). */
  readonly strength?: number
  /** The tracked brand it is about; null for a market card. */
  readonly subjectId: string | null
  /**
   * The numbers and words to phrase the card with. Common: `brand`, `own`.
   * Per kind: outlier `platform, ratio, over100, reach, usual, unit` ·
   * launch `firstLine, posts` · complaints `count, example` · spreading and
   * top_in_sources `platform, reach, perDay, unit, firstLine` · sound
   * `soundTitle, posts, views` · market_sound `soundTitle, brands, views` ·
   * mentions_up `now, before` · pace `platform, recent, before`.
   */
  readonly params: Readonly<Record<string, string | number | boolean | readonly string[]>>
  /** Ids of the posts it rests on (at most four). */
  readonly evidence: readonly string[]
  /** English text, for surfaces that do not phrase cards themselves. */
  readonly title: string
  readonly why: string
  readonly action: string
}

/** A post a scan found, with whose it is. */
export type CompetitorPost = SocialPost & { readonly role: "own" | "about" | "market" }

export interface CompetitorScanCounts {
  readonly own: number
  readonly about: number
  readonly searches: number
  readonly failedSearches: number
  /** The searches that returned, as `<own|about>:<platform>`. */
  readonly okSearches?: readonly string[]
}

export interface CompetitorScanSummary {
  readonly id: string
  readonly at: string
  readonly counts: CompetitorScanCounts
  readonly cards: number
}

export interface CompetitorScan {
  readonly id: string
  readonly at: string
  readonly counts: CompetitorScanCounts
  readonly posts: readonly CompetitorPost[]
  readonly cards: readonly ActionCard[]
}

/** `GET /v1/competitors/:id`. */
export interface CompetitorDetail extends TrackedCompetitor {
  readonly latestScan: CompetitorScan | null
  /** Newest first, at most twelve. */
  readonly scans: readonly CompetitorScanSummary[]
}

/** `GET /v1/competitors/cards`: every card, most urgent first, and the posts they rest on. */
export interface CompetitorCardsResult {
  readonly cards: readonly ActionCard[]
  readonly posts: Readonly<Record<string, CompetitorPost>>
}

/** `POST /v1/competitor-discover`: a brand's accounts found from its website. */
export interface CompetitorDiscovery {
  readonly brand: string
  readonly website: string
  readonly accounts: Partial<Record<CompetitorAccountKey, { readonly value: string; readonly from: "site" | "guess" }>>
}

export type CreateCompetitorInput = {
  readonly brand: string
  readonly website?: string
  readonly accounts?: CompetitorAccounts
  readonly aboutPlatforms?: readonly CompetitorAboutPlatform[]
  readonly isOwn?: boolean
  /** Default weekly. */
  readonly schedule?: CompetitorSchedule
}

export type UpdateCompetitorInput = Partial<CreateCompetitorInput>

/** Searches a scan of this configuration runs. */
export function competitorScanSearches(c: { readonly accounts?: CompetitorAccounts; readonly aboutPlatforms?: readonly string[] }): number {
  const accounts = COMPETITOR_ACCOUNT_KEYS.filter((k) => (c.accounts?.[k] ?? "").trim() !== "").length
  const about = (c.aboutPlatforms ?? []).filter((p) => (COMPETITOR_ABOUT_PLATFORMS as readonly string[]).includes(p)).length
  return accounts + about
}

/** The credit id of a scan of `n` searches. */
export function competitorScanCreditId(n: number): string {
  const clamped = Math.min(Math.max(Math.round(n), 1), COMPETITOR_SCAN_MAX_SEARCHES)
  return `${COMPETITOR_SCAN_NODE_TYPE}:${clamped}`
}

/** A scan costs one Social Search page per search: every id it can reserve. */
export const COMPETITOR_SCAN_CREDIT_COSTS: Readonly<Record<string, number>> = Object.fromEntries(
  Array.from({ length: COMPETITOR_SCAN_MAX_SEARCHES }, (_, i) => [competitorScanCreditId(i + 1), (i + 1) * SOCIAL_SEARCH_CREDITS_PER_PAGE] as const),
)

/** The credits a scan of this many searches costs. */
export function competitorScanCredits(searches: number): number {
  return searches <= 0 ? 0 : COMPETITOR_SCAN_CREDIT_COSTS[competitorScanCreditId(searches)] ?? 0
}

/** Whether a platform is one the about-search covers (used by pickers). */
export function isCompetitorAboutPlatform(value: string): value is CompetitorAboutPlatform & SocialPlatform {
  return (COMPETITOR_ABOUT_PLATFORMS as readonly string[]).includes(value)
}
