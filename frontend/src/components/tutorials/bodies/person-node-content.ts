// Prose for the Person Node tutorial.
//
// The picks themselves are NOT here: they are read off the person/backdrop/
// framing/mood nodes and resolved to labels through the same catalogs the
// pickers use, so editing the template updates the tutorial.
//
// Copy is held as dictionary keys and translated at render.

import type { MessageKey } from "@/lib/i18n"

/** Each lesson is one run: its input nodes and the image they produced. */
export const LESSONS = [
  {
    n: 1,
    title: "tut.pnLesson1Title",
    sub: "tut.pnLesson1Sub",
    inputs: ["node_2"],
    result: "node_1",
    body: "tut.pnLesson1Body",
    callout: "tut.pnLesson1Callout",
  },
  {
    n: 2,
    title: "tut.pnLesson2Title",
    sub: "tut.pnLesson2Sub",
    inputs: ["node_3"],
    result: "node_4",
    body: "tut.pnLesson2Body",
  },
  {
    n: 3,
    title: "tut.pnLesson3Title",
    sub: "tut.pnLesson3Sub",
    inputs: ["node_9", "node_6", "node_7", "node_8"],
    result: "node_5",
    body: "tut.pnLesson3Body",
    closing: "tut.pnLesson3Closing",
    /** How the parts of the prompt stack up, in the order they read. */
    order: ["tut.pnOrderScene", "tut.pnOrderFraming", "tut.pnOrderMood", "tut.pnOrderCharacter"],
  },
] as const satisfies ReadonlyArray<{
  n: number
  inputs: readonly string[]
  result: string
  title: MessageKey
  sub: MessageKey
  body: MessageKey
  callout?: MessageKey
  closing?: MessageKey
  order?: readonly MessageKey[]
}>

export const RAIL_STEPS: ReadonlyArray<{ n: number; title: MessageKey; sub: MessageKey }> = [
  { n: 1, title: "tut.pnLesson1Title", sub: "tut.pnRailStep1Sub" },
  { n: 2, title: "tut.pnLesson2Title", sub: "tut.pnLesson2Sub" },
  { n: 3, title: "tut.pnRailStep3Title", sub: "tut.pnRailStep3Sub" },
]

export const RAIL_NOTE: { eyebrow: MessageKey; body: MessageKey } = {
  eyebrow: "tut.pnNoteEyebrow",
  body: "tut.pnNoteBody",
}

/** Node type → the node's canvas label shown above a stacked input card in
 *  lesson 3. Node labels are localized at render through `lib/i18n/labels.ts`. */
export const KIND_LABELS: Record<string, string> = {
  person: "Person",
  backdrop: "Backdrop",
  framing: "Framing",
  mood: "Mood",
}
