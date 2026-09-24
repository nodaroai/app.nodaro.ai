// The only hand-written content in this tutorial.
//
// Names, one-line mechanisms and the "why it matters" paragraphs have no home in
// the graph, so they live here. Everything else — the images, the prompts, the
// picker values, the model names, even the grid order's fallback — is read off
// the template snapshot by `image-editing-edits.ts`.
//
// Keyed by node id, which is what ties a paragraph to the edit it explains. An
// id that is no longer in the template is simply unused; an edit with no entry
// still renders, using its canvas label.
//
// Copy is held as dictionary keys and translated at render.

import type { MessageKey } from "@/lib/i18n"

export interface EditProse {
  /** Short name shown on the tile and in the trace header. */
  name: MessageKey
  /** One line naming the mechanism, under the name. */
  sub: MessageKey
  /** Why this edit is worth understanding. */
  why: MessageKey
}

/**
 * Grid order — the reading order of the nine results, left to right, top to
 * bottom. Written prompts first, then the picker-driven edits, then the two
 * structural ones. It is also the fallback ordering the derivation uses.
 */
export const EDIT_ORDER = [
  "node_6",
  "node_7",
  "node_9",
  "node_11",
  "node_15",
  "node_19",
  "node_21",
  "node_28",
  "node_29",
] as const

export const EDIT_PROSE: Record<string, EditProse> = {
  node_6: {
    name: "tut.iedNavyName",
    sub: "tut.iedSubWritten",
    why: "tut.iedNavyWhy",
  },
  node_7: {
    name: "tut.iedGoldenName",
    sub: "tut.iedSubLighting",
    why: "tut.iedGoldenWhy",
  },
  node_9: {
    name: "tut.iedTealName",
    sub: "tut.iedSubColor",
    why: "tut.iedTealWhy",
  },
  node_11: {
    name: "tut.iedAnimeName",
    sub: "tut.iedSubTwoStyles",
    why: "tut.iedAnimeWhy",
  },
  node_15: {
    name: "tut.iedAtomicName",
    sub: "tut.iedSubEra",
    why: "tut.iedAtomicWhy",
  },
  node_19: {
    name: "tut.iedCyberName",
    sub: "tut.iedSubStyle",
    why: "tut.iedCyberWhy",
  },
  node_21: {
    name: "tut.ied85mmName",
    sub: "tut.iedSubLens",
    why: "tut.ied85mmWhy",
  },
  node_28: {
    name: "tut.iedNoBgName",
    sub: "tut.iedSubNoSettings",
    why: "tut.iedNoBgWhy",
  },
  node_29: {
    name: "tut.iedTokyoName",
    sub: "tut.iedSubWritten",
    why: "tut.iedTokyoWhy",
  },
}

/** The headline band above the three columns. */
export const HEADLINE: MessageKey = "tut.iedHeadline"

export const SUBLINE: MessageKey = "tut.iedSubline"

export const FACTS: readonly MessageKey[] = ["tut.iedChipEdits", "tut.iedChipSharedOriginal", "tut.iedChipNonDestructive"]

export const IN_COLUMN: { title: MessageKey; sub: MessageKey } = {
  title: "tut.theOriginal",
  sub: "tut.iedInSub",
}

/** The count is read off the graph, so the heading says "9 results" without
 *  anyone having to keep the word "Nine" true. `countLabel` takes `{n}`. */
export const OUT_COLUMN: { countLabel: MessageKey; sub: MessageKey } = {
  countLabel: "present.resultsCount",
  sub: "tut.iedOutSub",
}

/** Sits under the critic's score. The critic is the one node here that saves
 *  money rather than making a picture, which is why it gets the room. */
export const CRITIC_LINE: MessageKey = "tut.iedCriticLine"

/** Shown in the trace column when an edit has no configuration to name. */
export const NO_SETTINGS: MessageKey = "tut.iedNoSettings"
