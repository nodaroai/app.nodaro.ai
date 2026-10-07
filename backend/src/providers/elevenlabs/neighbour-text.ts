/**
 * The two neighbour-text fields a Text to Speech request may carry — what is spoken just BEFORE and just AFTER
 * this clip in the finished piece — and the ONE normaliser every exit that puts them on a wire runs them through.
 *
 * The rule itself (cap, trim, previous keeps its end / next its start, non-strings are absent) lives in
 * `@nodaro/shared` so the editor's run and these exits are the same function. Like the voice settings
 * (voice-settings.ts), the fields arrive from every lane exactly as the enqueuer wrote them, and only the REST
 * route validates them. The exits are `directElevenLabsTTS` (direct-tts.ts) and the self-host relay
 * `NodaroCloudAudioProvider` (nodaro/audio.ts) — `providers/__tests__/tts-voice-settings-exits.test.ts` drives
 * both with the same inputs. Whether the fields are SENT at all is the model's sheet
 * (`MODEL_CATALOG[id].tts.stitching`), asked by the exit.
 */
export { TTS_NEIGHBOUR_TEXT_MAX_CHARS, normalizeTtsNeighbourText } from "@nodaro/shared"
export type { TtsNeighbourText } from "@nodaro/shared"
