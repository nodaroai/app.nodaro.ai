import type { CompetitorPlatformTally } from "@nodaro/shared"
import type { MessageKey } from "@/lib/i18n"
import { compactNumber } from "./action-card-text"
import { lessonText } from "./lesson-text"

type T = (key: MessageKey, vars?: Record<string, string | number>) => string

/** Per unit: the phrase for exactly one, and for any other count. */
const USUAL_KEY: Readonly<Record<NonNullable<CompetitorPlatformTally["unit"]>, readonly [MessageKey, MessageKey]>> = {
  views: ["competitors.usualViewsOne", "competitors.usualViews"],
  likes: ["competitors.usualLikesOne", "competitors.usualLikes"],
  points: ["competitors.usualPointsOne", "competitors.usualPoints"],
}

/** "201K views": a brand's usual reach on a platform, in its unit; null while not known. */
export function usualText(tally: Pick<CompetitorPlatformTally, "usual" | "unit"> | null, t: T): string | null {
  if (!tally || tally.usual === null || tally.unit === null) return null
  const [one, other] = USUAL_KEY[tally.unit]
  return t(tally.usual === 1 ? one : other, { n: compactNumber(tally.usual) })
}

export interface WorksText {
  readonly text: string
  /** faint: why it cannot be told yet, not a finding. */
  readonly faint: boolean
}

/**
 * What works for a brand on a platform: its strongest lesson there, or why
 * there is none — kept until its next scan, too few posts, or nothing stands
 * out among them.
 */
export function whatWorksText(tally: CompetitorPlatformTally, t: T): WorksText {
  if (tally.top) return { text: lessonText(tally.top, t).line, faint: false }
  // Only the name is searched there (no account of theirs is read): there are no posts of theirs to learn from.
  if (!tally.searched.includes("own") && tally.own === 0) return { text: "—", faint: true }
  if (tally.unit === null) return { text: t("competitors.afterNextScan"), faint: true }
  if (tally.usual === null) return { text: t("competitors.tooFewPosts"), faint: true }
  return { text: t("competitors.nothingStandsOut"), faint: true }
}
