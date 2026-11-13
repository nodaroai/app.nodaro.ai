import {
  ttsAcceptsVoice,
  ttsDirectionFor,
  ttsHasLever,
  ttsLanguageCodes,
  ttsNamedVoiceFor,
  ttsNamedVoices,
  ttsSupportsStitching,
  ttsTakesReplica,
} from "@nodaro/shared/model-catalog"

/**
 * The text-to-speech node fields a model switch can invalidate, keyed as node data spells them. A type, not an
 * interface, so it is a plain record `ttsDirectionFor` can read.
 */
export type TtsSwitchFields = {
  /** The model the node is on BEFORE the switch: leaving a model with named voices puts the voice back. */
  provider?: string
  stability?: number
  similarityBoost?: number
  style?: number
  speed?: number
  languageCode?: string
  previousText?: string
  nextText?: string
  voiceId?: string
  voiceType?: string
  voiceDisplayName?: string
  voiceLabel?: string
  styleDirection?: string
  pace?: string
  accent?: string
  audioProfile?: string
  /** A one-off clone of a person's voice (`TextToSpeechData.replica`) and the consent given for it. */
  replica?: unknown
  replicaConsent?: unknown
}

/**
 * What a switch writes besides the provider: cleared levers and direction fields (`undefined` removes the key on
 * merge), a reset language, emptied neighbour text, and the voice snapped to one the new model speaks.
 */
export interface TtsSwitchPatch {
  similarityBoost?: undefined
  style?: undefined
  speed?: undefined
  languageCode?: string
  previousText?: ""
  nextText?: ""
  voiceId?: string
  voiceType?: "premade"
  voiceDisplayName?: string | undefined
  voiceLabel?: string | undefined
  styleDirection?: undefined
  pace?: undefined
  accent?: undefined
  audioProfile?: undefined
  replica?: undefined
  replicaConsent?: undefined
}

/**
 * [the lever on the model's sheet, the node field that stores it]. Stability is never cleared: every ElevenLabs model
 * honours it, and a model without it (Gemini, no levers at all) is never sent it by the provider funnel, so the
 * value simply waits for the node's way back.
 */
const CLEARABLE_LEVERS = [
  ["similarity", "similarityBoost"],
  ["style", "style"],
  ["speed", "speed"],
] as const

/** The neighbour-text fields: shown and sent only for a model that stitches; a hidden value must not come back on the next switch. */
const NEIGHBOUR_TEXT_FIELDS = ["previousText", "nextText"] as const

/** The style-direction fields (`TtsCapabilities.direction`): each kept only where the new model takes its value. */
const DIRECTION_FIELDS = ["styleDirection", "pace", "accent", "audioProfile"] as const

/**
 * The voice part of a switch.
 *   - To a model with named voices (Gemini) whose list lacks the node's voice: its default voice, as a premade pick.
 *     An empty voice stays empty — it runs as that default already, and the panel shows it.
 *   - Leaving a model with named voices for one that speaks the ElevenLabs voices: the voice a fresh node on that
 *     deployment starts with — none (`voiceId: ""`, as `curatedNodeDefaults` writes it). The panel then shows the
 *     ElevenLabs default it shows for an empty voice, and the server runs the deployment's allowed default; a literal
 *     ElevenLabs name would be refused under a voice lock.
 *   - Anything else: nothing.
 */
function voicePatch(next: string, data: TtsSwitchFields): TtsSwitchPatch {
  const voice = data.voiceId
  if (ttsNamedVoices(next)) {
    if (!voice || ttsAcceptsVoice(next, voice)) return {}
    const snapped = ttsNamedVoiceFor(next, voice)!
    return { voiceId: snapped, voiceType: "premade", voiceDisplayName: snapped, voiceLabel: snapped }
  }
  if (!ttsNamedVoices(data.provider)) return {}
  const patch: TtsSwitchPatch = {}
  if (voice) patch.voiceId = ""
  if (data.voiceType !== undefined && data.voiceType !== "premade") patch.voiceType = "premade"
  if (data.voiceDisplayName !== undefined) patch.voiceDisplayName = undefined
  if (data.voiceLabel !== undefined) patch.voiceLabel = undefined
  return patch
}

/**
 * What to write next to `{ provider: next }` when a USER switches a
 * text-to-speech node to another model: every voice setting the new model does
 * not honour is cleared (a hidden slider must not keep a value that comes back
 * if the node is switched again), a language the new model is not offered in
 * resets to auto-detect (`""`), the voice is moved onto one the new model speaks
 * (see `voicePatch`), and a style direction the new model does not take — or
 * whose value it does not accept (3.8's free text is not one of 3.1's styles) —
 * is cleared. Returns only what changes, so a node that already fits the new
 * model yields `{}`.
 *
 * Call it from the handler of the user's choice — the panel's model dropdown,
 * the Voice Library pick that snaps the model, the quick strip's dropdown — with
 * the node's data as it is before the switch (its `provider` is the model being
 * left). Do NOT call it from an effect on `provider`: one panel instance is
 * reused when the selection moves to another node, and an effect also fires on
 * undo, redo and a copilot edit — each would rewrite a node the user only
 * looked at.
 *
 * This is not the invariant. A node written straight into workflow JSON, or a
 * provider injected by a field mapping, never passes through here; what keeps
 * those correct is the provider funnel (`directElevenLabsTTS`), which sends only
 * the levers the model honours whatever the node carries, the route's named-voice
 * check, and `ttsDirectionFor` on every exit.
 */
export function ttsModelSwitchPatch(next: string, data: TtsSwitchFields): TtsSwitchPatch {
  const patch: TtsSwitchPatch = {}
  for (const [lever, field] of CLEARABLE_LEVERS) {
    if (!ttsHasLever(next, lever) && data[field] !== undefined) patch[field] = undefined
  }
  if (data.languageCode && !ttsLanguageCodes(next).includes(data.languageCode)) patch.languageCode = ""
  if (!ttsSupportsStitching(next)) {
    for (const field of NEIGHBOUR_TEXT_FIELDS) {
      if (data[field]) patch[field] = ""
    }
  }
  Object.assign(patch, voicePatch(next, data))
  const kept = ttsDirectionFor(next, data)
  for (const field of DIRECTION_FIELDS) {
    const value = data[field]
    if (value !== undefined && value !== "" && kept[field] === undefined) patch[field] = undefined
  }
  // A one-off clone goes on a model that does not clone (decided 2026-11-13): the run would refuse it there.
  // Its consent goes with it, even when no recording is stored.
  if (!ttsTakesReplica(next)) {
    if (data.replica !== undefined) patch.replica = undefined
    if (data.replicaConsent !== undefined) patch.replicaConsent = undefined
  }
  return patch
}
