import type { VideoCharacterReference } from "@nodaro/shared"
import { applyPromptPolicies } from "./prompt-policy.js"

/**
 * Run a character reference's free-form `description` through the deployment
 * prompt-policy funnel (modesty clause, minor floor, ...).
 *
 * Why this exists: the description is sent to the upstream's character-create
 * call and shapes the person it renders — it is subject text exactly like a
 * `describedReferences` line, but it never joins the assembled `prompt`, so
 * `applyPromptPolicies` on the prompt does not see it. Without this a client
 * could route subject text through `characterReferences[].description` and
 * skip every registered policy.
 *
 * `name` is deliberately NOT policed: it is a short display label, and a policy
 * clause appended to a label would corrupt it. The same goes for a voice's
 * `exampleLine`. A voice `description` IS policed (see below). With no policy registered this
 * is the identity (a fresh array of the same values).
 */
export function applyPromptPoliciesToCharacterReferences(
  refs: readonly VideoCharacterReference[] | undefined,
): VideoCharacterReference[] | undefined {
  if (!refs) return undefined
  const police = (text: string): string => applyPromptPolicies({ prompt: text, negativePrompt: "", kind: "video" }).prompt
  return refs.map((ref) => ({
    ...ref,
    description: police(ref.description),
    // The voice description is free text that shapes who speaks, sent to the
    // upstream's audio-persona call: it rides the SAME funnel as the character
    // description. `preset` is an enum and `exampleLine` a ≤120-char sample the
    // persona says — a policy clause appended to either would corrupt it.
    ...(ref.voice
      ? {
          voice: {
            ...ref.voice,
            ...(ref.voice.description ? { description: police(ref.voice.description) } : {}),
          },
        }
      : {}),
  }))
}
