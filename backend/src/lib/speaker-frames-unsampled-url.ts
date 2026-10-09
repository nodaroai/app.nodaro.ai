/**
 * Speaker Frames' unsampled-source placeholder (P3.6 relay, round 2, decided
 * 2026-10-09). Its own module so the generic relay (`nodaro-exclusive-relay.ts`)
 * can recognise it without loading the Speaker Frames relay.
 */

/**
 * The URL a relayed edit gives every source Speaker Frames does not sample
 * (round 2, decided 2026-10-09): `https://unsampled.invalid/<source id>`.
 * `.invalid` is reserved never to resolve (RFC 6761), so nothing can be
 * fetched from it by anyone; it is a well-formed https URL, so shared's
 * `validateEdl` and the plugin's edit coercion take it as they take any
 * source URL; and it is one URL per source id, so a clip pack still names one
 * file per id (the plugin refuses a pack that names two). nodaro.ai never
 * reads it: its relayed path detects on the proxies only.
 */
export const SPEAKER_FRAMES_UNSAMPLED_URL_BASE = "https://unsampled.invalid/"

export function speakerFramesUnsampledUrl(sourceId: string): string {
  return `${SPEAKER_FRAMES_UNSAMPLED_URL_BASE}${encodeURIComponent(sourceId)}`
}

/** True for the placeholder: the generic re-host leaves it as it is. */
export function isSpeakerFramesUnsampledUrl(url: unknown): boolean {
  return typeof url === "string" && url.startsWith(SPEAKER_FRAMES_UNSAMPLED_URL_BASE)
}
