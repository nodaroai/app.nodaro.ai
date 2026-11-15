/**
 * What Edit with AI can do to a video, as the panel offers it: one card per
 * ability, in groups, and the words a card writes into the request.
 *
 * The request stays the one source of truth. Tapping a card adds its words to
 * the request, or takes out every part of the request that asks for it; the
 * cards and the "Will do" line read the request back (`requestSteps`, the
 * same multilingual reading the run falls back on). When the run starts, the
 * planner reads the request and decides.
 */
import type { MessageKey } from "@/lib/i18n"
import { planFromRequest, type EditStep } from "./edit-plan"

export type AbilityGroup = "tidy" | "add"

export interface Ability {
  readonly key: EditStep
  readonly group: AbilityGroup
  /** The step reads the video's words: it needs the video listened to, once. */
  readonly listens: boolean
}

/** The cards, in the order the panel shows them. */
export const ABILITIES: readonly Ability[] = [
  { key: "pauses", group: "tidy", listens: true },
  { key: "fillers", group: "tidy", listens: true },
  { key: "captions", group: "add", listens: true },
  { key: "music", group: "add", listens: false },
]

export const ABILITY_GROUPS: readonly AbilityGroup[] = ["tidy", "add"]

export const GROUP_TITLE: Record<AbilityGroup, MessageKey> = {
  tidy: "freecutAi.group.tidy",
  add: "freecutAi.group.add",
}

export const ABILITY_NAME: Record<EditStep, MessageKey> = {
  pauses: "freecutAi.step.pauses",
  fillers: "freecutAi.step.fillers",
  captions: "freecutAi.step.captions",
  music: "freecutAi.step.music",
}

export const ABILITY_HINT: Record<EditStep, MessageKey> = {
  pauses: "freecutAi.hint.pauses",
  fillers: "freecutAi.hint.fillers",
  captions: "freecutAi.hint.captions",
  music: "freecutAi.hint.music",
}

/** The words a card writes into the request, in the person's language. Each must read back as its own step. */
export const ABILITY_PHRASE: Record<EditStep, MessageKey> = {
  pauses: "freecutAi.phrase.pauses",
  fillers: "freecutAi.phrase.fillers",
  captions: "freecutAi.phrase.captions",
  music: "freecutAi.phrase.music",
}

/** Whether any of these steps reads the video's words. */
export const listensFor = (steps: readonly EditStep[]) => steps.some((step) => ABILITIES.find((a) => a.key === step)?.listens)

/** The steps the request asks for, in card order: what the cards and the "Will do" line show. */
export function requestSteps(request: string): EditStep[] {
  const asked = new Set(planFromRequest(request).steps)
  return ABILITIES.map((a) => a.key).filter((step) => asked.has(step))
}

// A request's parts: split at a list mark, a sentence end, or a word that joins
// two asks ("and", "e", Hebrew's ו before a verb), so taking a card out of the
// request takes out only the part that asks for it.
const CLAUSE_SPLIT = /\s*(?:[,;،、，；\n]|[.。!?](?=\s|$)|\s+(?:and|e|y|und|et|그리고)\s+|\s+(?=ו(?:ל|ת)))\s*/iu

export function requestClauses(request: string): string[] {
  return request
    .split(CLAUSE_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

const capitalized = (text: string) => (text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text)

/**
 * The request with one card's words added at the end (`separator` is the
 * language's list comma), or with every part that asks for that step taken out.
 */
export function toggleStepInRequest(request: string, step: EditStep, phrase: string, separator: string): string {
  if (requestSteps(request).includes(step)) {
    const kept = requestClauses(request).filter((part) => !planFromRequest(part).steps.includes(step))
    return capitalized(kept.join(separator))
  }
  const base = request.trim().replace(/[.。]$/u, "")
  return capitalized(base ? `${base}${separator}${phrase}` : phrase)
}
