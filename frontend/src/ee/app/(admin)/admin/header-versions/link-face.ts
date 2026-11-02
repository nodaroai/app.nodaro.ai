import type { Tone } from "./site-face"
import type { LinkAnswer, WorldLink } from "./types"

/**
 * What a world's address answered, said plainly. Only a real "not found" is
 * called missing: a site that sends one page for every address answers 200
 * even where no such page exists, so "answers" never claims the page is there.
 */

export interface LinkFace {
  readonly label: string
  readonly tone: Tone
  /** The status code, or why nothing answered. */
  readonly detail: string
}

const GONE: ReadonlySet<number> = new Set([404, 410])

export const isNotFound = (answer: LinkAnswer): boolean => answer.status === "answered" && GONE.has(answer.code)

export function linkFace(answer: LinkAnswer): LinkFace {
  if (answer.status === "no_answer") return { label: "No answer", tone: "off", detail: answer.message }
  const detail = `HTTP ${answer.code}`
  if (GONE.has(answer.code)) return { label: "Not found", tone: "bad", detail }
  if (answer.code >= 400) return { label: "Error", tone: "behind", detail }
  return { label: "Answers", tone: "newest", detail }
}

export const notFoundCount = (worlds: readonly WorldLink[]): number => worlds.filter((world) => isNotFound(world.answer)).length

/**
 * The line over the list. All is well only when every address answered;
 * an address that refused otherwise, or never answered, was not checked, and
 * is counted as such — never folded into "no address answers not found".
 */
export function linkVerdict(worlds: readonly WorldLink[]): { readonly text: string; readonly tone: Tone } {
  const missing = notFoundCount(worlds)
  const unchecked = worlds.filter((world) => !isNotFound(world.answer) && linkFace(world.answer).tone !== "newest").length
  if (missing === 0 && unchecked === 0) return { text: "No address answers “not found”.", tone: "newest" }
  const said = [
    ...(missing > 0 ? [`${missing} of ${worlds.length} addresses answer “not found”`] : []),
    ...(unchecked > 0 ? [`${unchecked} of ${worlds.length} could not be checked`] : []),
  ]
  return { text: `${said.join("; ")}.`, tone: missing > 0 ? "bad" : "behind" }
}
