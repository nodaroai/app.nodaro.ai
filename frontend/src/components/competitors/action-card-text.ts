import type { ActionCard } from "@nodaro/shared"
import type { MessageKey } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"

type T = (key: MessageKey, vars?: Record<string, string | number>) => string

export interface CardText {
  readonly title: string
  readonly why: string
  readonly action: string
  /** The post's own words, shown as a quote (untrusted text: render as text, dir auto). */
  readonly quote?: string
}

const PRIORITY: Readonly<Record<ActionCard["priority"], MessageKey>> = {
  1: "cards.priority1",
  2: "cards.priority2",
  3: "cards.priority3",
}

export function priorityLabel(card: Pick<ActionCard, "priority">, t: T): string {
  return t(PRIORITY[card.priority])
}

/** 12_345 -> "12K" in the reader's locale. */
export function compactNumber(n: number): string {
  return formatNumber(n, { notation: "compact", maximumFractionDigits: 1 })
}

export function platformLabel(platform: unknown): string {
  if (typeof platform !== "string") return ""
  return platform in SOCIAL_PLATFORM_META ? SOCIAL_PLATFORM_META[platform as keyof typeof SOCIAL_PLATFORM_META].name : platform === "telegram" ? "Telegram" : platform
}

const str = (v: unknown): string => (typeof v === "string" ? v : "")
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

function unitLabel(unit: unknown, t: T): string {
  if (unit === "points") return t("cards.unitPoints")
  if (unit === "likes") return t("cards.unitLikes")
  return t("cards.unitViews")
}

function ratioLabel(params: ActionCard["params"], t: T): string {
  if (params.over100 === true) return t("cards.ratioOver100")
  const ratio = num(params.ratio)
  return t("cards.ratio", { n: formatNumber(ratio, { maximumFractionDigits: ratio < 10 ? 1 : 0 }) })
}

/**
 * A card in the reader's language, from its kind and numbers. A kind this
 * build does not know falls back to the server's English text.
 */
export function cardText(card: ActionCard, t: T): CardText {
  const p = card.params
  const own = p.own === true
  const brand = str(p.brand)
  const platform = platformLabel(p.platform)
  switch (card.kind) {
    case "outlier":
      return {
        title: own ? t("cards.outlierTitleOwn", { platform, ratio: ratioLabel(p, t) }) : t("cards.outlierTitle", { brand, platform, ratio: ratioLabel(p, t) }),
        why: t("cards.outlierWhy", { reach: compactNumber(num(p.reach)), unit: unitLabel(p.unit, t), usual: compactNumber(num(p.usual)), platform }),
        action: own ? t("cards.outlierActionOwn") : t("cards.outlierAction"),
      }
    case "launch":
      return { title: t("cards.launchTitle", { brand }), why: "", quote: str(p.firstLine), action: t("cards.launchAction") }
    case "complaints":
      return {
        title: own ? t("cards.complaintsTitleOwn") : t("cards.complaintsTitle", { brand }),
        why: num(p.count) === 1 ? t("cards.complaintsWhyOne") : t("cards.complaintsWhy", { count: num(p.count) }),
        quote: str(p.example),
        action: own ? t("cards.complaintsActionOwn") : t("cards.complaintsAction"),
      }
    case "spreading":
      return {
        title: own ? t("cards.spreadingTitleOwn") : t("cards.spreadingTitle", { brand }),
        why: t("cards.perDayWhy", { reach: compactNumber(num(p.reach)), unit: unitLabel(p.unit, t), perDay: compactNumber(num(p.perDay)) }),
        quote: str(p.firstLine),
        action: own ? t("cards.spreadingActionOwn") : t("cards.spreadingAction"),
      }
    case "sound":
      return {
        title: t("cards.soundTitle", { sound: str(p.soundTitle) || t("cards.untitledSound"), count: num(p.posts), brand }),
        why: t("cards.soundWhy", { views: compactNumber(num(p.views)) }),
        action: t("cards.soundAction"),
      }
    case "market_sound": {
      const brands = Array.isArray(p.brands) ? p.brands.join(", ") : ""
      return {
        title: t("cards.marketSoundTitle", { sound: str(p.soundTitle) || t("cards.untitledSound"), count: Array.isArray(p.brands) ? p.brands.length : 0 }),
        why: t("cards.marketSoundWhy", { brands }),
        action: t("cards.marketSoundAction"),
      }
    }
    case "mentions_up":
      return {
        title: own ? t("cards.mentionsTitleOwn") : t("cards.mentionsTitle", { brand }),
        why: own ? t("cards.mentionsWhyOwn", { now: num(p.now), before: num(p.before) }) : t("cards.mentionsWhy", { now: num(p.now), before: num(p.before) }),
        action: t("cards.mentionsAction"),
      }
    case "pace":
      return {
        title: t("cards.paceTitle", { brand, platform }),
        why: t("cards.paceWhy", { recent: num(p.recent), before: num(p.before) }),
        action: t("cards.paceAction"),
      }
    case "top_in_sources":
      return {
        title: t("cards.topTitle"),
        why: t("cards.perDayWhy", { reach: compactNumber(num(p.reach)), unit: unitLabel(p.unit, t), perDay: compactNumber(num(p.perDay)) }),
        quote: str(p.firstLine),
        action: t("cards.topAction"),
      }
    default:
      return { title: card.title, why: card.why, action: card.action }
  }
}
