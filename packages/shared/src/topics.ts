/**
 * Topics — the wire contract of topic tracking.
 *
 * A person follows a hashtag or phrase with no brand around it ("ai video")
 * on the platforms they pick. Each scan searches the term on each platform,
 * 20, 40 or 60 posts per search, keeps the posts that really name it, and
 * produces cards about what is spreading. Scans are kept like a tracked
 * brand's, and run on a schedule or on demand.
 *
 * Why public: these are the shapes `/v1/topics*` answers. How a card is
 * decided is not part of the contract.
 */
import type { ActionCard, CompetitorSchedule } from "./competitors.js"
import { COMPETITOR_SCAN_PAGE_CREDIT_ID } from "./competitors.js"
import type { SocialPlatform, SocialPost } from "./social-search.js"
import { SOCIAL_SEARCH_CREDITS_PER_PAGE, socialSearchEffectiveCount, socialSearchPages } from "./social-search.js"

/** Where a topic can be searched. */
export const TOPIC_PLATFORMS = ["tiktok", "instagram", "youtube", "x", "reddit", "linkedin"] as const
export type TopicPlatform = (typeof TOPIC_PLATFORMS)[number]
export const TOPIC_DEFAULT_PLATFORMS: readonly TopicPlatform[] = ["tiktok", "instagram", "youtube", "x"]

/** Posts each search of a topic reads: one, two or three Social Search pages. */
export const TOPIC_POST_COUNTS = [20, 40, 60] as const
export type TopicPostCount = (typeof TOPIC_POST_COUNTS)[number]

export const TOPIC_SCAN_NODE_TYPE = "topic-scan"
/** A topic scan is charged this id per Social Search page it runs, summed. */
export const TOPIC_SCAN_PAGE_CREDIT_ID = "topic-scan:per-page"
/** The most topics any person can follow (the platform's own ceiling; a plan allows fewer). */
export const TOPICS_MAX = 200

/** The per-page scan rates (a brand's and a topic's), at their base price: one Social Search page each. */
export const SCAN_PAGE_CREDIT_COSTS: Readonly<Record<string, number>> = {
  [COMPETITOR_SCAN_PAGE_CREDIT_ID]: SOCIAL_SEARCH_CREDITS_PER_PAGE,
  [TOPIC_SCAN_PAGE_CREDIT_ID]: SOCIAL_SEARCH_CREDITS_PER_PAGE,
}

export interface TrackedTopic {
  readonly id: string
  /** Its display name. */
  readonly name: string
  /** The hashtag or phrase it searches. */
  readonly term: string
  readonly platforms: readonly TopicPlatform[]
  readonly postCount: TopicPostCount
  readonly schedule: CompetitorSchedule
  readonly nextScanAt: string | null
  readonly lastScanAt: string | null
  readonly lastScanId: string | null
  /** Why the last scan (or scheduled start) fell short; null when it did not. */
  readonly lastScanError: string | null
  /** A scan is running now. */
  readonly scanning: boolean
  /** Social Search pages one scan runs: the scan costs this many pages. */
  readonly pages: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** What a plan allows a person on the Topics page. */
export interface TopicLimits {
  /** Topics a person can follow; 0 = none; null = no cap. */
  readonly topics: number | null
}

/** `GET /v1/topics`. */
export interface TopicListResult {
  readonly data: readonly TrackedTopic[]
  /** Your plan's caps. Absent when the plan could not be read just now: neither locked nor unlimited, only unknown. */
  readonly limits?: TopicLimits
  /** How many months of scans your plan keeps. Absent when the plan could not be read just now. */
  readonly historyMonths?: number
}

export interface CreateTopicInput {
  readonly name: string
  /** The hashtag or phrase to search. Default: the name. */
  readonly term?: string
  /** Default: TikTok, Instagram, YouTube and X. */
  readonly platforms?: readonly TopicPlatform[]
  /** Default 20. */
  readonly postCount?: TopicPostCount
  /** Default weekly. */
  readonly schedule?: CompetitorSchedule
}

export type UpdateTopicInput = Partial<CreateTopicInput>

export interface TopicScanCounts {
  /** Posts the scan kept (the ones that name the term). */
  readonly posts: number
  readonly searches: number
  readonly failedSearches: number
  /** The platforms whose search returned. */
  readonly okSearches?: readonly string[]
}

export interface TopicScan {
  readonly id: string
  readonly at: string
  readonly counts: TopicScanCounts
  readonly posts: readonly SocialPost[]
  readonly cards: readonly ActionCard[]
}

export interface TopicScanSummary {
  readonly id: string
  readonly at: string
  readonly counts: TopicScanCounts
  readonly cards: number
}

/** `GET /v1/topics/:id`. */
export interface TopicDetail extends TrackedTopic {
  readonly latestScan: TopicScan | null
  /** Newest first, at most twelve. */
  readonly scans: readonly TopicScanSummary[]
}

/** One platform as one scan found it. */
export interface TopicHistoryPlatform {
  readonly platform: SocialPlatform
  /** Posts kept there. */
  readonly posts: number
  /** Their summed reach (views, plays or points); null when the platform gives none. */
  readonly reach: number | null
}

export interface TopicHistoryPoint {
  readonly id: string
  readonly at: string
  readonly platforms: readonly TopicHistoryPlatform[]
}

/** `GET /v1/topics/:id/history`: the topic's scans, oldest first. */
export interface TopicHistory {
  readonly scans: readonly TopicHistoryPoint[]
}

/** `GET /v1/topics/cards`: the cards of every topic's latest scan, most urgent first, and the posts they rest on. */
export interface TopicCardsResult {
  readonly cards: readonly ActionCard[]
  readonly posts: Readonly<Record<string, SocialPost>>
}

/** Social Search pages a topic scan runs: each platform's search at the topic's post count (some platforms read one page only). */
export function topicScanPages(t: { readonly platforms: readonly string[]; readonly postCount: number }): number {
  return t.platforms
    .filter((p): p is TopicPlatform => (TOPIC_PLATFORMS as readonly string[]).includes(p))
    .reduce((sum, platform) => sum + socialSearchPages(socialSearchEffectiveCount(platform, "keyword", t.postCount)), 0)
}

/** The credits a topic scan of this many pages costs, before the live price table loads. */
export function topicScanCredits(pages: number): number {
  return !Number.isFinite(pages) || pages <= 0 ? 0 : Math.round(pages) * SOCIAL_SEARCH_CREDITS_PER_PAGE
}

/** Whether a value is one of the topic platforms. */
export function isTopicPlatform(value: string): value is TopicPlatform {
  return (TOPIC_PLATFORMS as readonly string[]).includes(value)
}
