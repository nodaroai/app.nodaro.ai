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
  /**
   * How the advice the person acted on went, per family. Within a priority,
   * cards of a family marked `proven` come first and `weak` ones last; the
   * order of priorities never changes. Empty until there are verdicts.
   */
  readonly record?: readonly AdviceRecord[]
}

// ── Did it work? ("I did this" on a card) ─────────────────────────────────

/**
 * Advice is summed up by family: a competitor's sound and a sound around the
 * market are both "sound"; "outlier" is making a post like a competitor's
 * best one.
 */
export const ADVICE_FAMILIES = ["sound", "outlier", "launch", "complaints"] as const
export type AdviceFamily = (typeof ADVICE_FAMILIES)[number]

/** The family a card's advice belongs to; null for a card whose advice is not a post. */
export function adviceFamilyOf(kind: string): AdviceFamily | null {
  if (kind === "sound" || kind === "market_sound") return "sound"
  if (kind === "outlier" || kind === "launch" || kind === "complaints") return kind
  return null
}

/**
 * Whether "I did this" applies: the card's advice ends in a post of the
 * person's own. Complaints about their own brand end in replies, so not those.
 * The server is the judge; this only decides whether to offer the button.
 */
export function isMeasurableCard(card: Pick<ActionCard, "kind" | "params">): boolean {
  if (card.kind === "complaints") return card.params.own !== true
  return adviceFamilyOf(card.kind) !== null
}

/** What a card said when it was acted on (cards change with every scan). */
export interface CardSnapshot {
  readonly title: string
  readonly why: string
  readonly action: string
  readonly priority?: ActionCardPriority
  /** The card's numbers and words, to phrase it as the wall did. */
  readonly params?: ActionCard["params"]
  readonly brand?: string
  readonly platform?: string
  readonly evidence: readonly string[]
  /** A sound card's sound. */
  readonly soundId?: string
  /** When the card first showed. */
  readonly cardAt?: string
}

export const CARD_OUTCOME_STATES = [
  "worked",
  "flat",
  "missed",
  "waiting",
  "not_found",
  "older_than_advice",
  "no_baseline",
  "posts_since",
  "no_posts_yet",
  "no_brand",
] as const
/**
 * worked / flat (about the usual) / missed (below it): the verdict on the one
 * post tied to the card. waiting: that post is too new, or not scanned yet.
 * not_found: the linked post never showed up in the brand's scans.
 * older_than_advice: the linked post went up before the advice.
 * no_baseline: too few of the brand's posts on that platform to compare with.
 * posts_since: nothing tied to the card; the brand's posts since, no verdict.
 * no_posts_yet: nothing tied and no post since. no_brand: no own brand scanned.
 */
export type CardOutcomeState = (typeof CARD_OUTCOME_STATES)[number]

export interface CardOutcome {
  readonly state: CardOutcomeState
  /** The post's reach over the brand's usual. */
  readonly ratio?: number
  readonly liftLabel?: string
  readonly reach?: number
  readonly usual?: number
  readonly unit?: "views" | "points" | "likes"
  readonly platform?: string
  /** The judged post first; with no tie, the best posts since. */
  readonly postIds?: readonly string[]
  readonly ageDays?: number
  /** How the judged post was tied: the person's link, or a sound card's sound. */
  readonly matchedBy?: "link" | "sound"
  /** The brand's posts since the advice, newest first, to pick the one that came of it. */
  readonly candidates?: readonly string[]
}

/** The first verdict, kept as it was reached. */
export interface CardVerdict {
  readonly state: "worked" | "flat" | "missed"
  readonly ratio: number
  readonly reach: number
  readonly usual: number
  readonly unit: "views" | "points" | "likes"
  readonly platform: string
  readonly postId: string
  readonly matchedBy: "link" | "sound"
  readonly at: string
}

/** A card the person acted on, and how it went. */
export interface CardAction {
  readonly id: string
  /** The card on the wall it was made on. */
  readonly cardId: string
  readonly cardKind: ActionCardKind
  readonly card: CardSnapshot
  /** The tracked brand it was about; null for a market card (or a removed brand). */
  readonly subjectId: string | null
  readonly postUrl: string | null
  /** When the post was linked. */
  readonly linkedAt: string | null
  readonly actedAt: string
  readonly verdict: CardVerdict | null
  /** When the person first saw the verdict. */
  readonly seenAt: string | null
  /**
   * The card is still on the wall. Once it leaves, the mark stays (in Tried
   * and the record), and the card can be marked anew if it comes back.
   */
  readonly onWall: boolean
  readonly outcome: CardOutcome
}

/** How one family of advice went for the person, one verdict per post. */
export interface AdviceRecord {
  readonly family: AdviceFamily
  readonly tried: number
  readonly worked: number
  readonly flat: number
  readonly missed: number
  /** The mean of those posts' reach over the usual. */
  readonly avgRatio: number
  /** Enough verdicts to show this record. */
  readonly shown: boolean
  /** Whether it moves this family's cards (up when proven, down when weak). */
  readonly tier: "proven" | "weak" | "neutral"
}

/** `GET /v1/competitors/actions`: the cards the person acted on, newest first. */
export interface CompetitorActionsResult {
  readonly actions: readonly CardAction[]
  readonly record: readonly AdviceRecord[]
  /** The posts the outcomes name, by id. */
  readonly posts: Readonly<Record<string, CompetitorPost>>
}

/** `POST /v1/competitors/actions`: mark a card on the wall as done. */
export interface MarkCardInput {
  readonly cardId: string
  /** The person's own post that came of it (http(s), up to 1,000 characters). */
  readonly postUrl?: string | null
}

/** `POST` and `PATCH /v1/competitors/actions*`: the mark, and the posts its outcome names. */
export interface CardActionResult {
  readonly action: CardAction
  readonly posts: Readonly<Record<string, CompetitorPost>>
  /** POST only: false when the card was already marked (the mark is returned as it was). */
  readonly created?: boolean
}

/** `PATCH /v1/competitors/actions/:id`: link (or unlink with null) the post, or mark the verdict seen. */
export interface UpdateCardActionInput {
  readonly postUrl?: string | null
  readonly seen?: true
}

// ── What works (stage 4: learning from results) ───────────────────────────

/** The traits a brand's best posts can share. */
export const BRAND_LESSON_KINDS = [
  "short_videos",
  "long_videos",
  "format",
  "question_hook",
  "number_hook",
  "short_caption",
  "long_caption",
  "hashtag",
  "sound",
  "weekday",
] as const
export type BrandLessonKind = (typeof BRAND_LESSON_KINDS)[number]

/**
 * One thing a brand's best posts share, measured on its own posts: the posts
 * with the trait reached `lift` times what the rest did.
 */
export interface BrandLesson {
  /** `<platform>:<kind>:<key>`, stable across reads. */
  readonly id: string
  readonly kind: BrandLessonKind
  readonly platform: string
  /**
   * Always `lift` (number), `liftLabel` ("2.4x"), `posts` (with the trait),
   * `winners` (of the best among them) and `unit` ("views" | "likes" |
   * "points"). Per kind: short_videos `maxSec` · long_videos `minSec` ·
   * format `format` · short_caption and long_caption `chars` · hashtag `tag` ·
   * sound `sound` · weekday `day` (0 = Sunday, UTC).
   */
  readonly params: Readonly<Record<string, string | number | boolean | readonly string[]>>
  /** Ids of the posts it rests on, best first (at most four). */
  readonly evidence: readonly string[]
  readonly strength: number
  /** English, for surfaces that do not phrase lessons themselves. */
  readonly text: string
}

/** What works for a brand on one platform. */
export interface BrandPlatformLessons {
  readonly platform: string
  /** The brand's own posts counted there. */
  readonly posts: number
  /** Their typical reach; null while there are fewer than `minPosts`. */
  readonly usual: number | null
  readonly unit: "views" | "points" | "likes"
  /** Its best posts, best first. */
  readonly winners: readonly string[]
  /** Its weakest posts, weakest first. */
  readonly misses: readonly string[]
  readonly lessons: readonly BrandLesson[]
}

export interface BrandLessons {
  readonly subjectId: string
  /** The user's own brand ("what works for you"), not a competitor. */
  readonly isOwn: boolean
  readonly platforms: readonly BrandPlatformLessons[]
  /** Posts a platform needs before it gets lessons. */
  readonly minPosts: number
}

/** `GET /v1/competitors/:id/lessons`: what works for a tracked brand, and the posts it names. */
export interface CompetitorLessonsResult {
  readonly lessons: BrandLessons
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
