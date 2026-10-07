import { formatDate } from "@/lib/i18n/format"
import type { TFunction } from "@/lib/i18n"

/**
 * Small pieces every card that shows a post shares: the letter on a tile with
 * no picture, the short date, the view count.
 */

/** A name's first letter, upper-cased, for a tile with no picture ("@acme" and "#acme" read "A"). */
export function initialOf(name: string): string {
  const c = name.replace(/^[@#]/, "").trim()
  return c ? c.charAt(0).toUpperCase() : "?"
}

/** "Oct 6, 08:45" in the interface language; empty when the value is not a date. */
export function postDateLabel(value: unknown): string {
  const t = typeof value === "string" ? Date.parse(value) : NaN
  return Number.isNaN(t) ? "" : formatDate(t, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** "1 view" / "119 views" — `views` as the source shows it ("1.52M" stays as written). */
export function viewsLabel(views: string, t: TFunction): string {
  return views.trim() === "1" ? t("post.viewsOne") : t("post.views", { views })
}
