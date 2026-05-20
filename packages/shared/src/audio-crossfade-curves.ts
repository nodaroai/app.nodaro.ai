/**
 * Curated subset of FFmpeg `acrossfade=curve=...` options for combine-videos
 * audio crossfades. We expose 5 well-understood presets out of the ~21 raw
 * curves FFmpeg supports; the rest are either visually indistinguishable to
 * non-audio-engineers or rarely useful in this context.
 *
 * Default `linear` matches today's behavior — adding this catalog is a pure
 * additive change for existing workflows.
 */

export interface AudioCrossfadeCurve {
  readonly id: string
  /** FFmpeg `acrossfade=curve=...` name. */
  readonly ffmpeg: string
  readonly label: string
  readonly description: string
}

export const AUDIO_CROSSFADE_CURVES: readonly AudioCrossfadeCurve[] = [
  {
    id: "linear",
    ffmpeg: "tri",
    label: "Linear",
    description: "Straight-line fade. Default; predictable but can dip in the middle for music.",
  },
  {
    id: "equal-power",
    ffmpeg: "qsin",
    label: "Equal Power",
    description: "Quarter-sine. Keeps perceived loudness roughly constant across the crossfade — best for music.",
  },
  {
    id: "smooth",
    ffmpeg: "hsin",
    label: "Smooth (Sine)",
    description: "Half-sine. Gentler than equal-power; good for dialogue and ambient.",
  },
  {
    id: "logarithmic",
    ffmpeg: "log",
    label: "Logarithmic",
    description: "Compensates for the ear's logarithmic loudness response. Long, slow tails.",
  },
  {
    id: "exponential",
    ffmpeg: "exp",
    label: "Exponential",
    description: "Sharp out / slow in (or vice versa). Punchy — good for impact moments.",
  },
]

export const AUDIO_CROSSFADE_CURVE_IDS: readonly string[] =
  AUDIO_CROSSFADE_CURVES.map((c) => c.id)

export const DEFAULT_AUDIO_CROSSFADE_CURVE_ID = "linear"

const CURVES_BY_ID: ReadonlyMap<string, AudioCrossfadeCurve> = new Map(
  AUDIO_CROSSFADE_CURVES.map((c) => [c.id, c]),
)

export function getAudioCrossfadeCurve(id: string): AudioCrossfadeCurve | undefined {
  return CURVES_BY_ID.get(id)
}

/**
 * Resolve a curve id to its FFmpeg `acrossfade=curve=` name. Unknown ids fall
 * back to `tri` (linear) — this matches the route's Zod default so callers
 * downstream of validation never see undefined.
 */
export function resolveAudioCrossfadeCurve(id: string | undefined): string {
  if (!id) return "tri"
  return CURVES_BY_ID.get(id)?.ffmpeg ?? "tri"
}
