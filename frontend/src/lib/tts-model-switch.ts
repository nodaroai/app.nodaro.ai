import { ttsHasLever, ttsLanguageCodes } from "@nodaro/shared"

/** The text-to-speech node fields a model switch can invalidate, keyed as node data spells them. */
export interface TtsSwitchFields {
  similarityBoost?: number
  style?: number
  speed?: number
  languageCode?: string
}

/** What a switch writes besides the provider: cleared levers (`undefined` removes the key on merge) and a reset language. */
export interface TtsSwitchPatch {
  similarityBoost?: undefined
  style?: undefined
  speed?: undefined
  languageCode?: string
}

/** [the lever on the model's sheet, the node field that stores it]. Stability is honoured by every model and never cleared. */
const CLEARABLE_LEVERS = [
  ["similarity", "similarityBoost"],
  ["style", "style"],
  ["speed", "speed"],
] as const

/**
 * What to write next to `{ provider: next }` when a USER switches a
 * text-to-speech node to another model: every voice setting the new model does
 * not honour is cleared (a hidden slider must not keep a value that comes back
 * if the node is switched again), and a language the new model is not offered in
 * resets to auto-detect (`""`). Returns only what changes, so a node that
 * already fits the new model yields `{}`.
 *
 * Call it from the handler of the user's choice — the panel's model dropdown,
 * the Voice Library pick that snaps the model, the quick strip's dropdown. Do
 * NOT call it from an effect on `provider`: one panel instance is reused when
 * the selection moves to another node, and an effect also fires on undo, redo
 * and a copilot edit — each would rewrite a node the user only looked at.
 *
 * This is not the invariant. A node written straight into workflow JSON, or a
 * provider injected by a field mapping, never passes through here; what keeps
 * those correct is the provider funnel (`directElevenLabsTTS`), which sends only
 * the levers the model honours whatever the node carries.
 */
export function ttsModelSwitchPatch(next: string, data: TtsSwitchFields): TtsSwitchPatch {
  const patch: TtsSwitchPatch = {}
  for (const [lever, field] of CLEARABLE_LEVERS) {
    if (!ttsHasLever(next, lever) && data[field] !== undefined) patch[field] = undefined
  }
  if (data.languageCode && !ttsLanguageCodes(next).includes(data.languageCode)) patch.languageCode = ""
  return patch
}
