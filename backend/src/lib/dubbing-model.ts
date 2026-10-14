import { DUBBING_MAX_SPAN_MINUTES } from "@nodaro/render-rules"

/** Every per-minute row a dub is charged on: the dubbing API's, and the separately priced project API's. */
export const DUBBING_MODEL_IDENTIFIERS = ["elevenlabs-dubbing", "elevenlabs-dubbing-v2"] as const

/** The longest span a dub may cover, in whole minutes (the route refuses longer). */
export const DUBBING_MAX_MINUTES = DUBBING_MAX_SPAN_MINUTES

/** Hebrew requires the separately priced project API. Keep dispatch and billing aligned. */
export function dubbingModelIdentifier(targetLanguage: unknown): string {
  return typeof targetLanguage === "string" && /^(he|heb)$/i.test(targetLanguage)
    ? DUBBING_MODEL_IDENTIFIERS[1] : DUBBING_MODEL_IDENTIFIERS[0]
}
