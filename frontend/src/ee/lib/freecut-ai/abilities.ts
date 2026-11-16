/**
 * What Edit with AI can do to a video, as the panel offers it: one card per
 * ability, in groups, who does it, and the words a card writes into the
 * request.
 *
 * The request stays the one source of truth. Tapping a card adds its words to
 * the request, or takes out every part of the request that asks for it; the
 * cards and the "Will do" line read the request back (`requestSteps`). A
 * request made only of the cards' words starts at once; one in the person's
 * own words is read by the planner first.
 */
import type { MessageKey } from "@/lib/i18n"
import { EDIT_STEPS, type EditStep } from "./edit-plan"
import { stepsInWords } from "./request-reading"

export type AbilityGroup = "tidy" | "add" | "look" | "format" | "make"

/** The named agents the person watches at work. */
export type AgentId = "lead" | "cutter" | "captions" | "sound" | "broll" | "picture" | "color" | "framer" | "director"

/**
 * What an ability needs from the editor beyond the first set of abilities:
 * an editor deployed before these is told apart, and the card says so.
 */
export type EditorNeed = "edit-ops-2" | "captions-word-highlight"

export interface Ability {
  readonly key: EditStep
  readonly group: AbilityGroup
  readonly agent: AgentId
  /** The step reads the video's words: it needs the video listened to, once. */
  readonly listens: boolean
  /** Asking again: "replace" redoes it in place of the last one, "another" makes one more. Otherwise done once per video. */
  readonly again?: "replace" | "another"
  readonly needs?: EditorNeed
}

/** The cards, in the order the panel shows them. */
export const ABILITIES: readonly Ability[] = [
  { key: "pauses", group: "tidy", agent: "cutter", listens: true },
  { key: "fillers", group: "tidy", agent: "cutter", listens: true },
  { key: "mistakes", group: "tidy", agent: "cutter", listens: true },
  { key: "captions", group: "add", agent: "captions", listens: true, again: "replace" },
  { key: "music", group: "add", agent: "sound", listens: false, again: "replace", needs: "edit-ops-2" },
  { key: "broll", group: "add", agent: "broll", listens: true, again: "replace", needs: "edit-ops-2" },
  { key: "titles", group: "add", agent: "captions", listens: true, again: "replace", needs: "edit-ops-2" },
  { key: "picture", group: "look", agent: "picture", listens: false, again: "another", needs: "edit-ops-2" },
  { key: "color", group: "look", agent: "color", listens: false, again: "replace", needs: "edit-ops-2" },
  { key: "zoom", group: "look", agent: "framer", listens: true },
  { key: "phone", group: "format", agent: "framer", listens: false, needs: "edit-ops-2" },
  { key: "layout", group: "format", agent: "framer", listens: true, needs: "edit-ops-2" },
  { key: "cameras", group: "format", agent: "director", listens: true },
  { key: "clips", group: "make", agent: "lead", listens: true, again: "another", needs: "edit-ops-2" },
  { key: "trailer", group: "make", agent: "lead", listens: true, again: "another", needs: "edit-ops-2" },
  { key: "chapters", group: "make", agent: "lead", listens: true, again: "replace", needs: "edit-ops-2" },
]

export const ABILITY_OF: Readonly<Record<EditStep, Ability>> = Object.fromEntries(ABILITIES.map((a) => [a.key, a])) as Record<EditStep, Ability>

export const ABILITY_GROUPS: readonly AbilityGroup[] = ["tidy", "add", "look", "format", "make"]

export const GROUP_TITLE: Record<AbilityGroup, MessageKey> = {
  tidy: "freecutAi.group.tidy",
  add: "freecutAi.group.add",
  look: "freecutAi.group.look",
  format: "freecutAi.group.format",
  make: "freecutAi.group.make",
}

export const ABILITY_NAME: Record<EditStep, MessageKey> = {
  pauses: "freecutAi.step.pauses",
  fillers: "freecutAi.step.fillers",
  mistakes: "freecutAi.step.mistakes",
  captions: "freecutAi.step.captions",
  music: "freecutAi.step.music",
  broll: "freecutAi.step.broll",
  titles: "freecutAi.step.titles",
  picture: "freecutAi.step.picture",
  color: "freecutAi.step.color",
  zoom: "freecutAi.step.zoom",
  phone: "freecutAi.step.phone",
  layout: "freecutAi.step.layout",
  cameras: "freecutAi.step.cameras",
  clips: "freecutAi.step.clips",
  trailer: "freecutAi.step.trailer",
  chapters: "freecutAi.step.chapters",
}

export const ABILITY_HINT: Record<EditStep, MessageKey> = {
  pauses: "freecutAi.hint.pauses",
  fillers: "freecutAi.hint.fillers",
  mistakes: "freecutAi.hint.mistakes",
  captions: "freecutAi.hint.captions",
  music: "freecutAi.hint.music",
  broll: "freecutAi.hint.broll",
  titles: "freecutAi.hint.titles",
  picture: "freecutAi.hint.picture",
  color: "freecutAi.hint.color",
  zoom: "freecutAi.hint.zoom",
  phone: "freecutAi.hint.phone",
  layout: "freecutAi.hint.layout",
  cameras: "freecutAi.hint.cameras",
  clips: "freecutAi.hint.clips",
  trailer: "freecutAi.hint.trailer",
  chapters: "freecutAi.hint.chapters",
}

/** The words a card writes into the request, in the person's language. Each must read back as its own step. */
export const ABILITY_PHRASE: Record<EditStep, MessageKey> = {
  pauses: "freecutAi.phrase.pauses",
  fillers: "freecutAi.phrase.fillers",
  mistakes: "freecutAi.phrase.mistakes",
  captions: "freecutAi.phrase.captions",
  music: "freecutAi.phrase.music",
  broll: "freecutAi.phrase.broll",
  titles: "freecutAi.phrase.titles",
  picture: "freecutAi.phrase.picture",
  color: "freecutAi.phrase.color",
  zoom: "freecutAi.phrase.zoom",
  phone: "freecutAi.phrase.phone",
  layout: "freecutAi.phrase.layout",
  cameras: "freecutAi.phrase.cameras",
  clips: "freecutAi.phrase.clips",
  trailer: "freecutAi.phrase.trailer",
  chapters: "freecutAi.phrase.chapters",
}

/** The speaker layout on the wide frame, the speakers side by side: the card's other phrase. */
export const LAYOUT_WIDE_PHRASE: MessageKey = "freecutAi.phrase.layoutWide"

/** Every phrase a card can write for its step: its own, and its other settings'. */
export const cardPhraseKeys = (step: EditStep): readonly MessageKey[] => (step === "layout" ? [ABILITY_PHRASE.layout, LAYOUT_WIDE_PHRASE] : [ABILITY_PHRASE[step]])

/** Whether any of these steps reads the video's words. */
export const listensFor = (steps: readonly EditStep[]) => steps.some((step) => ABILITY_OF[step]?.listens)

/** The steps the request asks for, in card order: what the cards and the "Will do" line show. */
export function requestSteps(request: string): EditStep[] {
  const asked = new Set(stepsInWords(request))
  return EDIT_STEPS.filter((step) => asked.has(step))
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
    const kept = requestClauses(request).filter((part) => !stepsInWords(part).includes(step))
    return capitalized(kept.join(separator))
  }
  const base = request.trim().replace(/[.。]$/u, "")
  return capitalized(base ? `${base}${separator}${phrase}` : phrase)
}
