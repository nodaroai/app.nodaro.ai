import { describe, expect, it } from "vitest"
import { BRAND_LESSON_KINDS, type BrandLesson } from "@nodaro/shared"
import { translate, type MessageKey } from "@/lib/i18n"
import { lessonText, weekdayName } from "../lesson-text"
import { useLocaleStore } from "@/lib/locale-store"

const t = (key: MessageKey, vars?: Record<string, string | number>) => translate("en", key, vars)
const he = (key: MessageKey, vars?: Record<string, string | number>) => translate("he", key, vars)
/** Numbers follow the reader's locale (bidi marks included), so they are compared bare. */
const bare = (s: string) => s.replace(/[‎‏]/g, "")

function lesson(kind: BrandLesson["kind"], params: BrandLesson["params"] = {}): BrandLesson {
  return {
    id: `tiktok:${kind}:x`,
    kind,
    platform: "tiktok",
    params: { lift: 2.4, liftLabel: "2.4x", posts: 4, winners: 3, unit: "views", ...params },
    evidence: ["tiktok:1"],
    strength: 2.4,
    text: "server text",
  }
}

describe("a lesson in the reader's language", () => {
  it("names the trait, the lift over the usual, and what it rests on", () => {
    expect(lessonText(lesson("short_videos", { maxSec: 15 }), t)).toEqual({
      line: "Videos of 15 seconds or less: 2.4x the usual views",
      basis: "4 posts, 3 of the best",
    })
    expect(bare(lessonText(lesson("hashtag", { tag: "tutorial", unit: "likes" }), t).line)).toBe("Tagged #tutorial: 2.4x the usual likes")
    expect(bare(lessonText(lesson("format", { format: "video" }), t).line)).toBe("Video posts: 2.4x the usual views")
  })

  it("has words for every kind the engine sends", () => {
    for (const kind of BRAND_LESSON_KINDS) {
      const text = lessonText(lesson(kind, { maxSec: 15, minSec: 45, format: "image", chars: 60, tag: "x", sound: "Morning Loop", day: 2 }), t)
      expect(text.line, kind).not.toMatch(/competitors\.|\{|undefined/)
    }
  })

  it("shows the server's English for a kind this build does not know yet", () => {
    const unknown = { ...lesson("hashtag"), kind: "new_kind" as BrandLesson["kind"], text: "On TikTok, something new." }
    expect(lessonText(unknown, t)).toEqual({ line: "On TikTok, something new.", basis: "" })
  })

  it("reads in Hebrew too, with the weekday in the reader's language", () => {
    expect(bare(lessonText(lesson("question_hook"), he).line)).toBe("פתיחה בשאלה: פי 2.4 מהרגיל בצפיות")
    // English leaves dates to the browser's own language; any other choice names its days.
    useLocaleStore.setState({ locale: "he" })
    try {
      expect(weekdayName(0)).toBe("יום ראשון")
    } finally {
      useLocaleStore.setState({ locale: "en" })
    }
  })

})
