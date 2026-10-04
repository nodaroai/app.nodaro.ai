import { adviceFamilyOf, isMeasurableCard, type ActionCard, type AdviceFamily, type AdviceRecord, type CardAction, type CardOutcome } from "@nodaro/shared"
import type { MessageKey } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import { compactNumber, platformLabel } from "./action-card-text"

type T = (key: MessageKey, vars?: Record<string, string | number>) => string

/** worked: a verdict that it worked · neutral: about the usual · muted: below it · pending: no verdict (yet). */
export type OutcomeTone = "worked" | "neutral" | "muted" | "pending"

export interface OutcomeText {
  readonly tone: OutcomeTone
  readonly headline: string
  /** The numbers behind a verdict, or what happens next. */
  readonly detail?: string
  /** Whether linking the post that came of it would help. */
  readonly askLink: boolean
}

export function isVerdict(outcome: Pick<CardOutcome, "state">): boolean {
  return outcome.state === "worked" || outcome.state === "flat" || outcome.state === "missed"
}

/** "2.1x" in the reader's locale. */
export function ratioText(ratio: number | undefined, t: T): string {
  const n = typeof ratio === "number" && Number.isFinite(ratio) ? ratio : 0
  return t("cards.ratio", { n: formatNumber(n, { maximumFractionDigits: n < 10 ? 1 : 0 }) })
}

function unitText(unit: CardOutcome["unit"], t: T): string {
  if (unit === "points") return t("cards.unitPoints")
  if (unit === "likes") return t("cards.unitLikes")
  return t("cards.unitViews")
}

/** The numbers behind a verdict: "8.4K views, against your usual 4K on TikTok". */
function verdictNumbers(o: CardOutcome, t: T): string | undefined {
  if (typeof o.reach !== "number" || typeof o.usual !== "number") return undefined
  return t("marks.numbers", { reach: compactNumber(o.reach), unit: unitText(o.unit, t), usual: compactNumber(o.usual), platform: platformLabel(o.platform) })
}

/** How a marked card went, in the reader's language. */
export function outcomeText(o: CardOutcome, t: T): OutcomeText {
  const ratio = ratioText(o.ratio, t)
  switch (o.state) {
    case "worked":
      return { tone: "worked", headline: t("marks.worked", { ratio }), detail: verdictNumbers(o, t), askLink: false }
    case "flat":
      return { tone: "neutral", headline: t("marks.flat", { ratio }), detail: verdictNumbers(o, t), askLink: false }
    case "missed":
      return { tone: "muted", headline: t("marks.missed", { ratio }), detail: verdictNumbers(o, t), askLink: false }
    case "waiting":
      return { tone: "pending", headline: t("marks.waiting"), detail: t("marks.waitingDetail"), askLink: false }
    case "not_found":
      return { tone: "pending", headline: t("marks.notFound"), askLink: true }
    case "older_than_advice":
      return { tone: "pending", headline: t("marks.olderThanAdvice"), askLink: true }
    case "no_baseline":
      return { tone: "pending", headline: t("marks.noBaseline", { platform: platformLabel(o.platform) || t("marks.thisPlatform") }), askLink: false }
    case "posts_since":
      return { tone: "pending", headline: t("marks.postsSince", { ratio }), detail: t("marks.pickForVerdict"), askLink: true }
    case "no_posts_yet":
      return { tone: "pending", headline: t("marks.noPostsYet"), askLink: true }
    case "no_brand":
      return { tone: "pending", headline: t("marks.noBrand"), askLink: false }
    default:
      return { tone: "pending", headline: t("marks.noPostsYet"), askLink: true }
  }
}

const FAMILY: Readonly<Record<AdviceFamily, MessageKey>> = {
  sound: "marks.familySound",
  outlier: "marks.familyOutlier",
  launch: "marks.familyLaunch",
  complaints: "marks.familyComplaints",
}

export function familyLabel(family: AdviceFamily, t: T): string {
  return t(FAMILY[family])
}

/** "3 of 4 worked for you". */
export function recordPill(r: Pick<AdviceRecord, "worked" | "tried">, t: T): string {
  return t("marks.recordPill", { worked: r.worked, tried: r.tried })
}

/** The record of a card's family, when there is enough of it to show (only on cards that can be marked). */
export function recordForCard(record: readonly AdviceRecord[] | undefined, card: Pick<ActionCard, "kind" | "params">): AdviceRecord | undefined {
  const family = isMeasurableCard(card) ? adviceFamilyOf(card.kind) : null
  return family ? record?.find((r) => r.family === family && r.shown) : undefined
}

/** Whether the record moved any card (the wall then says it is sorted by it too). */
export function recordMovesCards(record: readonly AdviceRecord[] | undefined): boolean {
  return (record ?? []).some((r) => r.tier !== "neutral")
}

/** One dot per verdict, worked first: what the record rests on. */
export function recordDots(r: Pick<AdviceRecord, "worked" | "flat" | "missed">): ReadonlyArray<"worked" | "flat" | "missed"> {
  const dots = (n: number, state: "worked" | "flat" | "missed") => Array.from({ length: Math.max(0, n) }, () => state)
  return [...dots(r.worked, "worked"), ...dots(r.flat, "flat"), ...dots(r.missed, "missed")]
}

/** A mark the server has not answered for yet. */
export function isPendingMark(action: Pick<CardAction, "id">): boolean {
  return action.id.startsWith("pending:")
}

/** Verdicts the person has not seen yet: the wall says the results are in. */
export function unseenVerdicts(actions: readonly CardAction[]): CardAction[] {
  return actions.filter((a) => a.verdict !== null && a.seenAt === null && !isPendingMark(a))
}
