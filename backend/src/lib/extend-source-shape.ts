/**
 * The only picture shapes some Extend Video providers continue, with the
 * relative tolerance a measured source may be off by. Only providers with such
 * a rule are listed; every other one continues any shape (or holds its model's
 * own reference-video range, `refVideoAspectProblem`).
 *
 * Gemini Omni Flash 1.2 Extend (decided 2026-11-17): the model renders 16:9 or
 * 9:16 only — a square source came back 16:9 with its own part centre-cropped
 * — so a source of any other shape is refused before anything is held (the
 * route, a workflow run) and again by the worker. The set is closed under a
 * quarter turn, so a rotation tag never changes the verdict.
 */
const EXTEND_SOURCE_ASPECTS: Readonly<Record<string, { readonly aspects: readonly { readonly label: string; readonly ratio: number }[]; readonly tolerance: number } | undefined>> = {
  "gemini-omni-flash-1-2-extend": {
    aspects: [
      { label: "16:9", ratio: 16 / 9 },
      { label: "9:16", ratio: 9 / 16 },
    ],
    tolerance: 0.02,
  },
}

/** "16:9" style text of a width ÷ height ratio: "1.33:1" at or above 1, "1:1.33" below it. */
function aspectText(ratio: number): string {
  const n = (v: number) => String(Math.round(v * 100) / 100)
  return ratio >= 1 ? `${n(ratio)}:1` : `1:${n(1 / ratio)}`
}

/**
 * Why an Extend Video `provider` cannot continue a source of `width` ×
 * `height` pixels, as a finished sentence, or undefined when it can. A
 * provider with no rule, or a size that is not known (not a positive number),
 * is never refused: a probe that failed must not refuse a run, and the worker
 * measures the source again.
 */
export function extendSourceAspectProblem(provider: string, width: number | undefined, height: number | undefined): string | undefined {
  const rule = EXTEND_SOURCE_ASPECTS[provider]
  if (!rule || !width || !height || !(width > 0) || !(height > 0)) return undefined
  const ratio = width / height
  if (rule.aspects.some((a) => Math.abs(ratio / a.ratio - 1) <= rule.tolerance)) return undefined
  const shapes = rule.aspects.map((a) => a.label).join(" or ")
  return (
    `This engine extends only ${shapes} videos — this one is ${width}×${height} (${aspectText(ratio)}). ` +
    `Crop it to ${shapes}, or pick a Seedance engine, which keeps the video's own shape.`
  )
}

/**
 * A probed picture's DISPLAY size: its stored width times its sample aspect
 * ratio (when the probe read one other than 1), its height as stored — so an
 * anamorphic 1440×1080 clip with a 4:3 sample aspect plays, and is judged, as
 * 1920×1080. A probe with no sample aspect: the stored size.
 */
export function displayVideoSize(probe: { readonly width: number; readonly height: number; readonly sampleAspectRatio?: number }): { width: number; height: number } {
  const sar = probe.sampleAspectRatio
  return sar !== undefined && Number.isFinite(sar) && sar > 0 && sar !== 1
    ? { width: Math.round(probe.width * sar), height: probe.height }
    : { width: probe.width, height: probe.height }
}
