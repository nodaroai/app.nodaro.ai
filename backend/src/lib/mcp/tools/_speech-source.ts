import { resolveAssetId } from "../asset-resolver.js"

/**
 * Resolve an `audio_asset_id` that is documented as "audio OR video job id".
 *
 * `resolveAssetId` is kind-strict, so asking it for audio refuses every
 * ordinary video job ("expected audio, got job of type …") — yet the routes
 * behind these verbs take any media URL, and a video is the common input
 * (captioning a clip, aligning a talking-head take, isolating a voice out of
 * one). Try audio first, then video; ownership is enforced inside
 * `resolveAssetId` on BOTH attempts, and any other failure (not found, foreign
 * id, an image) propagates untouched.
 *
 * One helper rather than a copy per verb: every tool description that makes
 * this promise has to resolve the same way.
 */
export async function resolveSpeechSourceUrl(assetId: string, userId: string): Promise<string | null> {
  try {
    return await resolveAssetId({ assetId, userId, expectedKind: "audio" })
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("expected audio")) throw err
    return resolveAssetId({ assetId, userId, expectedKind: "video" })
  }
}
