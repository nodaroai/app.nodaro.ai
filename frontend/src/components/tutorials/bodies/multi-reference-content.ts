// Prose for the Multi-Reference tutorial.
//
// ONLY text that has no home in the workflow lives here. Reference names, the
// prompt, the model settings and the result image are all derived from the
// template snapshot at render time, so republishing the template cannot leave
// this file lying.
//
// Copy is held as dictionary keys and translated at render.

import type { MessageKey } from "@/lib/i18n"

/** What each reference position contributes, keyed by its `{image:N}` number. */
export const REFERENCE_ROLES: Record<number, MessageKey> = {
  1: "tut.mrcRole1",
  2: "tut.mrcRole2",
  3: "tut.mrcRole3",
  4: "tut.mrcRole4",
  5: "tut.mrcRole5",
}

/** The same idea, phrased as the result's ingredient list. */
export const CONTRIBUTIONS: Record<number, MessageKey> = {
  1: "tut.mrcContrib1",
  2: "tut.mrcRole2",
  3: "tut.mrcContrib3",
  4: "tut.mrcRole4",
  5: "tut.mrcContrib5",
}

export const DEFAULT_HINT: MessageKey = "tut.mrcDefaultHint"

/** What the clause around each token is actually doing. */
export const TOKEN_HINTS: Record<number, MessageKey> = {
  1: "tut.mrcHint1",
  2: "tut.mrcHint2",
  3: "tut.mrcHint3",
  4: "tut.mrcHint4",
  5: "tut.mrcHint5",
}

export const GROUP_TITLES: Record<"a" | "b" | "c", { title: MessageKey; sub: MessageKey }> = {
  a: { title: "tut.mrcAddRefsTitle", sub: "tut.mrcAddRefsSub" },
  b: { title: "tut.mrcWritePromptTitle", sub: "tut.mrcWritePromptSub" },
  c: { title: "common.generate", sub: "tut.mrcGenerateSub" },
}

/** The three closing columns of step 04. */
export const CLOSING_COLUMNS: ReadonlyArray<{ eyebrow: MessageKey | null; title?: MessageKey; body: MessageKey }> = [
  {
    eyebrow: null,
    title: "tut.mrcMakeItYours",
    body: "tut.mrcClosing1Body",
  },
  {
    eyebrow: "tut.mrcClosing2Eyebrow",
    body: "tut.mrcClosing2Body",
  },
  {
    eyebrow: "tut.mrcClosing3Eyebrow",
    body: "tut.mrcClosing3Body",
  },
]
