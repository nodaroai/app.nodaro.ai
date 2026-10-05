import { createElement, type ReactNode } from "react"
import type { MessageKey } from "@/lib/i18n"
import { interpolateNodes } from "@/lib/i18n/interpolate-nodes"
import type { PeopleSay } from "./card-facts"

type T = (key: MessageKey, vars?: Record<string, string | number>) => string

/**
 * What people say about a brand on a platform, as a sentence ("you" for the
 * person's own brand). The quote is bidi-isolated, so the closing mark of a
 * Latin quote stays on its side inside a Hebrew sentence.
 */
export function sayText(say: PeopleSay, isOwn: boolean, t: T): ReactNode {
  const key: MessageKey = say.kind === "complaints" ? "competitors.sayComplaints" : isOwn ? "competitors.saySpreadingYou" : "competitors.saySpreading"
  return interpolateNodes(t(key), { quote: createElement("bdi", null, say.quote) })
}
