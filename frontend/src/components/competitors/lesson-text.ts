import type { BrandLesson } from "@nodaro/shared"
import type { MessageKey } from "@/lib/i18n"
import { formatDate, formatNumber } from "@/lib/i18n/format"

type T = (key: MessageKey, vars?: Record<string, string | number>) => string

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === "string" ? v : "")

export function lessonUnit(unit: unknown, t: T): string {
  if (unit === "points") return t("cards.unitPoints")
  if (unit === "likes") return t("cards.unitLikes")
  return t("cards.unitViews")
}

/** 2.4 -> "2.4x", 12.3 -> "12x", in the reader's locale. */
export function liftLabel(lift: number, t: T): string {
  return t("cards.ratio", { n: formatNumber(lift, { maximumFractionDigits: lift < 10 ? 1 : 0 }) })
}

/** 0 -> Sunday, in the reader's language (the day the lesson counted, UTC). */
export function weekdayName(day: number): string {
  // 2023-01-01 was a Sunday.
  return formatDate(Date.UTC(2023, 0, 1 + day), { weekday: "long", timeZone: "UTC" })
}

const FORMAT_KEY: Readonly<Record<string, MessageKey>> = {
  video: "competitors.formatVideo",
  image: "competitors.formatImage",
  text: "competitors.formatText",
}

/** What the lesson's posts share, in the reader's language ("Videos of 15
 *  seconds or less"); null for a kind this build does not know yet. */
function traitText(lesson: BrandLesson, t: T): string | null {
  const p = lesson.params
  switch (lesson.kind) {
    case "short_videos":
      return t("competitors.lessonShortVideos", { sec: num(p.maxSec) })
    case "long_videos":
      return t("competitors.lessonLongVideos", { sec: num(p.minSec) })
    case "format": {
      const key = FORMAT_KEY[str(p.format)]
      return t("competitors.lessonFormat", { format: key ? t(key) : str(p.format) })
    }
    case "question_hook":
      return t("competitors.lessonQuestionHook")
    case "number_hook":
      return t("competitors.lessonNumberHook")
    case "short_caption":
      return t("competitors.lessonShortCaption", { chars: num(p.chars) })
    case "long_caption":
      return t("competitors.lessonLongCaption", { chars: num(p.chars) })
    case "hashtag":
      return t("competitors.lessonHashtag", { tag: str(p.tag) })
    case "sound":
      return t("competitors.lessonSound", { sound: str(p.sound) })
    case "weekday":
      return t("competitors.lessonWeekday", { day: weekdayName(num(p.day)) })
    default:
      return null
  }
}

export interface LessonText {
  /** "Videos of 15 seconds or less: 2.4x the usual views". */
  readonly line: string
  /** "4 posts, 3 of the best". */
  readonly basis: string
}

export function lessonText(lesson: BrandLesson, t: T): LessonText {
  const p = lesson.params
  const trait = traitText(lesson, t)
  // A kind the plugin ships before this build knows it: the server's English.
  if (trait === null) return { line: lesson.text, basis: "" }
  return {
    line: t("competitors.lessonLine", {
      trait,
      lift: liftLabel(num(p.lift), t),
      unit: lessonUnit(p.unit, t),
    }),
    basis: t("competitors.lessonBasis", { posts: num(p.posts), winners: num(p.winners) }),
  }
}

