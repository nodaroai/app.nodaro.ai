/**
 * Read Inspiration and Read Competitor — the nodes that read posts the person
 * already has (the Inspiration library; a tracked brand's scans) and emit them
 * the way Social Search does: `json` the posts (`SocialPost[]`), `text` their
 * digest (`socialPostsDigest`), one list item per post. Both engines' output
 * branches read this ONE list, so a new reader is routed like the rest.
 *
 * The routes behind them (`/v1/inspiration-read`, `/v1/competitor-read`) are
 * free: they read what the account already holds.
 */

export const INSPIRATION_READ_NODE_TYPE = "inspiration-read" as const
export const COMPETITOR_READ_NODE_TYPE = "competitor-read" as const

export const SOCIAL_POST_READER_NODE_TYPES: ReadonlySet<string> = new Set([INSPIRATION_READ_NODE_TYPE, COMPETITOR_READ_NODE_TYPE])

export function isSocialPostReaderNodeType(type: unknown): boolean {
  return typeof type === "string" && SOCIAL_POST_READER_NODE_TYPES.has(type)
}

/** The most posts one run reads. */
export const SOCIAL_READ_LIMIT_MAX = 100
export const SOCIAL_READ_DEFAULT_LIMIT = 20
/** A window in hours reaches back at most 30 days; in days, at most a year (Competitors keep at most twelve months of scans). */
export const SOCIAL_READ_WINDOW_HOURS_MAX = 720
export const SOCIAL_READ_WINDOW_DAYS_MAX = 365

/** `window`: the last N hours or days. `day`: one calendar day in the node's timezone. */
export const SOCIAL_READ_PERIODS = ["window", "day"] as const
export type SocialReadPeriod = (typeof SOCIAL_READ_PERIODS)[number]

/** Which of a brand's posts Read Competitor reads: its own, posts about it, or both. */
export const COMPETITOR_READ_ROLES = ["own", "about", "all"] as const
export type CompetitorReadRole = (typeof COMPETITOR_READ_ROLES)[number]

/** A calendar day as the node stores it. */
export const SOCIAL_READ_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
