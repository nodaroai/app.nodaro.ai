// Prose for the Camera Coverage tutorial.
//
// ONLY text that has no home in the workflow lives here. The reference prompt,
// the brief, the shot lines, every image and every count are read off the
// template snapshot at render time, so republishing the template cannot leave
// this file lying. The copy is the design handoff's, verbatim; the only thing
// composed at runtime is the shot count, which is the one figure that could
// silently drift from the template.

import { tx, type MessageKey, type TFunction } from "@/lib/i18n"

// Copy is held as dictionary keys; the few sentences that carry a count are
// functions that take the caller's `t`, so they re-translate on a language switch.

export const HEADLINE: MessageKey = "tut.ccvHeadline"

export const SUBLINE: MessageKey = "tut.ccvSubline"

/** Headline chips after the derived "N shots" one. */
export const FACTS: readonly MessageKey[] = ["tut.ccvChipNodes", "tut.ccvChipCuttable"]

/** "ten", so a sentence can say "ten runs" the way the design does, without
 *  hardcoding a figure the template may one day contradict. Past twelve, digits.
 *  Each locale spells the number in its own dictionary — Hebrew keeps digits,
 *  because its number words agree in gender with the noun they count. */
const COUNT_WORDS: readonly MessageKey[] = [
  "tut.countZero",
  "tut.countOne",
  "tut.countTwo",
  "tut.countThree",
  "tut.countFour",
  "tut.countFive",
  "tut.countSix",
  "tut.countSeven",
  "tut.countEight",
  "tut.countNine",
  "tut.countTen",
  "tut.countEleven",
  "tut.countTwelve",
]
export function countWord(n: number, t: TFunction): string {
  const key = COUNT_WORDS[n]
  return key ? t(key) : String(n)
}
function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// --- column 1: the reference frame ------------------------------------------

export const IN_COLUMN: { title: MessageKey; sub: MessageKey } = {
  title: "tut.ccvInTitle",
  sub: "tut.ccvInSub",
}

export const REFERENCE_PROMPT_EYEBROW: MessageKey = "tut.ccvRefPromptEyebrow"

/**
 * The brief, condensed. The full brief on the canvas is nine rules; these are
 * the five load-bearing ones, in the brief's own order. It is a control, not
 * an output — hence teal, the same colour role the Image Critic has in the
 * image-editing tutorial.
 */
export const BRIEF: { eyebrow: MessageKey; rules: readonly MessageKey[] } = {
  eyebrow: "tut.ccvBriefEyebrow",
  rules: [
    "tut.ccvBriefRule1",
    "tut.ccvBriefRule2",
    "tut.ccvBriefRule3",
    "tut.ccvBriefRule4",
    "tut.ccvBriefRule5",
  ],
}

// --- column 2: the shot list ------------------------------------------------

export const LIST_COLUMN = {
  title: "tut.ccvListTitle" as MessageKey,
  sub: (count: number, t: TFunction) => t("tut.ccvListSub", { count: capital(countWord(count, t)) }),
  meta: "tut.ccvListMeta" as MessageKey,
} as const

export const LEVER = {
  eyebrow: "tut.ccvLeverEyebrow" as MessageKey,
  body: (count: number, t: TFunction) => t("tut.ccvLeverBody", { count: countWord(count, t) }),
} as const

/**
 * Short names for what each line IS, by position. Authored, because the lines
 * themselves are 25-word camera setups and the list has to be scannable. The
 * positions follow the brief's coverage order (wide, two mediums, two close-ups,
 * over-the-shoulder, reverse, insert, dynamic angle, profile), which is what
 * makes a position-keyed label safe — and the seed contract test checks each
 * label against the line it names, so a re-published run that changes the
 * order fails there rather than mislabelling shots in the tutorial.
 */
export const SHOT_KINDS: readonly MessageKey[] = [
  "tut.ccvKindWide",
  "tut.ccvKindMediumWaist",
  "tut.ccvKindMediumThreeQ",
  "tut.ccvKindCloseProfile",
  "tut.ccvKindTightClose",
  "tut.ccvKindOverShoulder",
  "tut.ccvKindReverse",
  "tut.ccvKindInsert",
  "tut.ccvKindLowAngle",
  "tut.ccvKindCleanProfile",
]

/** The kind for a 1-based shot position; a plain fallback past the authored ten.
 *  `t` defaults to the live locale for non-render callers. */
export function kindFor(index: number, t: TFunction = tx): string {
  const key = SHOT_KINDS[index - 1]
  return key ? t(key) : t("tut.shotN", { n: index })
}

// --- column 3: the contact sheet --------------------------------------------

export const OUT_COLUMN = {
  title: "tut.ccvOutTitle" as MessageKey,
  sub: (count: number, t: TFunction) => t("tut.ccvOutSub", { count: capital(countWord(count, t)) }),
} as const

export const statusLine = (generated: number, count: number, t: TFunction) =>
  t("tut.ccvStatusLine", { generated, count })

export const shotTag = (index: number, count: number, t: TFunction) =>
  t("tut.ccvShotTag", { n: String(index).padStart(2, "0"), count })

export const SHEET_EYEBROW = (count: number, t: TFunction) => t("tut.ccvSheetEyebrow", { count: countWord(count, t) })

/** The three spec rows under the selected shot. ANCHOR is the point of the whole
 *  tutorial: every one of the runs is fed the same reference frame. */
export const SPECS = {
  anchor: { key: "tut.ccvSpecAnchor" as MessageKey, value: "tut.ccvSpecAnchorValue" as MessageKey },
  prompt: { key: "node.prompt" as MessageKey, value: (index: number, t: TFunction) => t("tut.ccvSpecPromptValue", { n: index }) },
  node: {
    key: "tut.nodeEyebrow" as MessageKey,
    value: (label: string, index: number, t: TFunction) => t("tut.ccvSpecNodeValue", { label, n: index }),
  },
} as const

export const NOT_RUN: MessageKey = "tut.ccvNotRun"
