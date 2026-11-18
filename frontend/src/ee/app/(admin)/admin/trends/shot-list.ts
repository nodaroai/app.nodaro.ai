// The shot list step's setting (`steps.shotList`, pure): the clip described
// shot by shot, per style — Precise off until turned on, Flex always on —
// and each style's speech (decided 2026-11-18: "off", "who", "words"; "off" is
// never written), and its mouths ("spoken", the default, never written). The server's rules in backend/src/lib/cast-swap-steps.ts.

import type { ShotListSetting, ShotListSpeech, ShotListSpeechMouth, ShotListStyleSetting } from "@/lib/api"

/** "Speech in the script": its choices, in the order offered. */
export const SHOT_LIST_SPEECH_OPTIONS: ReadonlyArray<{ value: ShotListSpeech; label: string }> = [
  { value: "off", label: "Off" },
  { value: "who", label: "Who speaks and when" },
  { value: "words", label: "Who speaks, when and the words" },
]

/**
 * The models that read video on the LLM nodes only that the Video Remake shot list may be written by, by name (decided
 * 2026-11-18): the Video Remake shot list is the one other place Gemini 4 Hydrogen is offered. The server's
 * `SHOT_LIST_LLM_NODE_MEDIA_MODELS` (backend/src/lib/cast-swap-steps.ts); a test holds the two equal.
 */
export const SHOT_LIST_LLM_NODE_MEDIA_MODELS: readonly string[] = ["gemini-4-hydrogen"]

/** "What the other mouths do": its choices, the default ("spoken", never written) first (decided 2026-11-18). */
export const SHOT_LIST_SPEECH_MOUTH_OPTIONS: ReadonlyArray<{ value: ShotListSpeechMouth; label: string }> = [
  { value: "spoken", label: "Mouths closed when not speaking (singing left alone)" },
  { value: "all", label: "Mouths closed when not speaking" },
  { value: "none", label: "Say nothing about other mouths" },
]

/** Whether either style asks for speech ("who" or "words"): the server's `shotListSpeechSet`. */
export function shotListSpeechSet(s: ShotListSetting | undefined): boolean {
  return [s?.precise?.speech, s?.flex?.speech].some((speech) => speech !== undefined && speech !== "off")
}

/** Whether the shot list as set needs an engine that runs it: Precise on, an LLM of its own, or speech (the server's `shotListNeedsEngine`). */
export function shotListNeedsEngine(s: ShotListSetting | undefined): boolean {
  if (!s) return false
  return s.precise?.mode === "on" || s.precise?.llm !== undefined || s.flex?.llm !== undefined || (s.flex !== undefined && s.flex.mode !== "on") || shotListSpeechSet(s)
}

/** A style's step without `speech` "off" (the same as left out), and without its mouths value unless speech is on and it is not the default. */
function withoutOffSpeech(s: ShotListStyleSetting): ShotListStyleSetting {
  // A style turned off has no speech (decided 2026-11-18), as on the server.
  const speechOn = s.mode === "on" && (s.speech === "who" || s.speech === "words")
  const { speech, speechMouth, ...rest } = s
  return {
    ...rest,
    ...(speechOn ? { speech } : {}),
    ...(speechOn && speechMouth !== undefined && speechMouth !== "spoken" ? { speechMouth } : {}),
  }
}

/**
 * The setting with each style at its defaults left out (Precise off, Flex on, no LLM, no speech) and a speech "off"
 * left out; undefined when nothing is left. Precise's speech is kept only while Precise is on.
 */
export function normaliseShotList(s: ShotListSetting | undefined): ShotListSetting | undefined {
  if (!s) return undefined
  const out: ShotListSetting = {}
  const precise = s.precise && withoutOffSpeech(s.precise)
  const flex = s.flex && withoutOffSpeech(s.flex)
  if (precise && (precise.mode === "on" || precise.llm)) out.precise = precise.mode === "on" ? precise : withoutSpeech(precise)
  if (flex && (flex.mode !== "on" || flex.llm || flex.speech)) out.flex = flex
  return Object.keys(out).length > 0 ? out : undefined
}

/** A style's step without any speech (nor its mouths). */
function withoutSpeech(s: ShotListStyleSetting): ShotListStyleSetting {
  const { speech: _speech, speechMouth: _mouth, ...rest } = s
  return rest
}
