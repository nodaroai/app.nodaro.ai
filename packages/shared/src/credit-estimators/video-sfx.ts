/**
 * Video SFX pricing — which price row a run is charged from, by the length of
 * the input video. One mapping for every place that names the row: the route
 * (`POST /v1/video-sfx`), the workflow run's reservation, the node's Run
 * button and the workflow estimates.
 *
 * Each bucket is a `model_pricing` row (`replicate-mmaudio:<n>s`); the credit
 * amounts live there, never here. Worked examples (repeated in
 * docs/nodes/ai-video/video-sfx.md):
 *   5 s → `:8s`,  12 s → `:15s`,  31 s → `:60s`,  180 s → `:300s`.
 */

export const VIDEO_SFX_PRICING = {
  /** The longest input video a run accepts, in seconds. */
  MAX_DURATION_SEC: 300,
  /** The length priced (and generated) when the input video cannot be measured. */
  FALLBACK_DURATION_SEC: 8,
} as const

const VIDEO_SFX_BUCKETS: ReadonlyArray<{ readonly upToSec: number; readonly creditId: string }> = [
  { upToSec: 8, creditId: "replicate-mmaudio:8s" },
  { upToSec: 15, creditId: "replicate-mmaudio:15s" },
  { upToSec: 30, creditId: "replicate-mmaudio:30s" },
  { upToSec: 60, creditId: "replicate-mmaudio:60s" },
  { upToSec: 120, creditId: "replicate-mmaudio:120s" },
  { upToSec: 300, creditId: "replicate-mmaudio:300s" },
]

/**
 * The price row for an input video of `durationSec` seconds. An unknown or
 * non-positive length prices the fallback length; anything past the cap prices
 * the last bucket (the route refuses such a video before it gets here).
 */
export function videoSfxCreditId(durationSec: number | null | undefined): string {
  const seconds =
    typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : VIDEO_SFX_PRICING.FALLBACK_DURATION_SEC
  const bucket = VIDEO_SFX_BUCKETS.find((b) => seconds <= b.upToSec) ?? VIDEO_SFX_BUCKETS[VIDEO_SFX_BUCKETS.length - 1]!
  return bucket.creditId
}
