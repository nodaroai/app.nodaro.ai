/**
 * The audio a Generate Video Pro segment is sent with and priced at — one rule,
 * run by the backend (the plugin toolkit's provider options, the pro pricing)
 * and by the editor (the pro node's estimate), so the audio a segment renders
 * and the audio it is charged for are one value.
 */
import type { VideoAudioRequest } from "@nodaro/shared/models"

/**
 * The audio a Generate Video Pro request asks for when it names none: the pro
 * engine sends its request's `generateAudio` to every segment, on unless the
 * request turns it off.
 */
export const GVP_GENERATE_AUDIO_DEFAULT = true

/**
 * The audio fields a plugin's video generation hands its provider — what the
 * plugin toolkit's `toProviderOptions` forwards: the plugin's `generateAudio`
 * and nothing else (the plugin contract has no `sound`). The toolkit builds its
 * provider options from this, and Generate Video Pro prices each segment from
 * it ({@link gvpSegmentAudio}), so the audio a segment is priced at and the
 * audio its provider is handed are one value.
 */
export function pluginVideoAudioRequest(generateAudio: boolean | undefined): VideoAudioRequest {
  return { generateAudio }
}

/**
 * The audio a Generate Video Pro segment is PRICED with, as the audio argument
 * of `buildVideoCreditModelIdentifier`: the fields the segment's provider is
 * handed ({@link pluginVideoAudioRequest}) for the `generateAudio` the run sends
 * it, else {@link GVP_GENERATE_AUDIO_DEFAULT}. The identifier reads them through
 * the same resolver the provider's runner renders from (`videoAudioPricedOn`,
 * `@nodaro/shared`), so every segment is charged the audio it renders, on every
 * model:
 *   - PixVerse V6 Max (its switch reads `generateAudio`): the field's value;
 *   - Kling 3.0 (reads only `sound`, which a segment is never handed): its own
 *     default, on — the `:audio` row, whatever `generateAudio` says;
 *   - Kling 2.6 (the same, default off): the silent row;
 *   - every model whose price does not depend on audio: no audio dimension, so
 *     its rows are untouched.
 */
export function gvpSegmentAudio(generateAudio: boolean | undefined): VideoAudioRequest {
  return pluginVideoAudioRequest(generateAudio ?? GVP_GENERATE_AUDIO_DEFAULT)
}
