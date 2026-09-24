// Prose for the Welcome Demo tutorial.
//
// As with the other tutorials, only text that has no home in the workflow lives
// here. Prompts, model names, results, durations and the voice settings are all
// read from the template snapshot at render time.
//
// Copy is held as dictionary keys and translated at render.

import type { MessageKey } from "@/lib/i18n"

/** The node each step is about. Ids are stable — the demo workflow is seeded
 *  from `backend/src/lib/demo-workflow.ts`, not drawn by hand. */
export const NODE_IDS = {
  idea: "demo-idea",
  image: "demo-image",
  video: "demo-video",
  narration: "demo-narration",
  voice: "demo-voice",
  final: "demo-final",
} as const

export const GROUP_TITLES: Record<"idea" | "image" | "video" | "audio" | "final", { title: MessageKey; sub: MessageKey }> = {
  idea: { title: "tut.wdIdeaTitle", sub: "tut.wdIdeaSub" },
  image: { title: "tut.wdImageTitle", sub: "tut.wdImageSub" },
  video: { title: "tut.wdVideoTitle", sub: "tut.wdVideoSub" },
  audio: { title: "tut.wdAudioTitle", sub: "tut.wdAudioSub" },
  final: { title: "tut.wdFinalTitle", sub: "tut.wdFinalSub" },
}

/** The single most useful thing to say about the first node. */
export const IDEA_CALLOUT: MessageKey = "tut.wdIdeaCallout"

export const RAIL_NOTE: { eyebrow: MessageKey; body: MessageKey } = {
  eyebrow: "tut.wdNoteEyebrow",
  body: "tut.wdNoteBody",
}

/** Where Final Cut's two inputs come from, in the reader's terms rather than
 *  node ids. */
export const FINAL_INPUTS: readonly MessageKey[] = ["tut.wdVideoFrom03", "tut.wdVoiceoverFrom04"]
