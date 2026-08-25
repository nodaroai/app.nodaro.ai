/**
 * The money-bearing dimensions a KIE wire body implies — resolution, audio,
 * videoInput, durationLabel, duration, characters. A generic port of the raw
 * dimension reads in a private deployment fork's own options object, WITHOUT
 * that fork's price-key composition — which lives in the deployment's egress
 * decorator, never in core.
 *
 * Read the BODY, not the caller's options: the body is what KIE bills against,
 * post every per-model remap (resolutionMap, extraParams, snapping). Dimensions
 * the body does not state are OMITTED, never guessed — a decorator that prices
 * on them must see the truth or omit the lever.
 */
/** A wire field names a supplied video when it is a non-empty string or a
 *  non-empty array of URLs. Empty arrays / null are "no video" — omitted, never
 *  guessed. */
function hasVideoSource(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 : v != null
}

export function deriveKieEgressDimensions(
  body: Record<string, unknown>,
): Record<string, string | number | boolean | undefined> {
  const out: Record<string, string | number | boolean | undefined> = {}

  const res = body.resolution ?? body.output_resolution ?? body.video_resolution
  if (res != null) out.resolution = String(res)

  // Audio on/off is a real cost lever. Models spell the flag differently — Kling
  // reads `sound`, Seedance/VEO read `generate_audio` — and the wire body carries
  // whichever ONE the chosen model reads (written by `applyVideoAudioToggle`), so
  // all three keys are honoured here or the lever is silently dropped on Kling.
  if (typeof body.audio === "boolean") out.audio = body.audio
  else if (typeof body.generate_audio === "boolean") out.audio = body.generate_audio
  else if (typeof body.sound === "boolean") out.audio = body.sound

  // A supplied VIDEO (not image) is a distinct, cheaper cost tier on several
  // models ("with video input" vs generated-from-nothing). `video_urls` (plural)
  // is the standard V2V / motion-control array field; an empty array is not a
  // supplied video, so it does not flag the lever.
  if (
    hasVideoSource(body.video_url) ||
    hasVideoSource(body.video_urls) ||
    hasVideoSource(body.video_list) ||
    hasVideoSource(body.input_video)
  ) {
    out.videoInput = true
  }

  const seconds = Number(body.duration ?? body.duration_seconds)
  if (Number.isFinite(seconds) && seconds > 0) {
    out.duration = seconds
    out.durationLabel = `${Math.round(seconds)}s`
  }

  const dialogue = Array.isArray(body.dialogue) ? (body.dialogue as unknown[]) : null
  const text =
    typeof body.text === "string"
      ? body.text
      : dialogue
        ? dialogue
            .map((l) => (l && typeof l === "object" && "text" in l ? String((l as { text: unknown }).text ?? "") : ""))
            .join("")
        : null
  if (text && text.length > 0) out.characters = text.length

  return out
}
