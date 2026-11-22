/**
 * A picture smaller than a model's minimum is ENLARGED to it, never refused
 * for its size alone (decided 2026-11-22, every model that states a minimum).
 *
 * A model that states a minimum side (Kling 4: 300 px; Wan 2.6: 256 px;
 * HappyHorse ref2v: 400 px; OmniHuman 2.0: 300 px, …) used to have its input
 * refused when either side fell short — a 281×369 start frame failed a whole
 * Video Remake run. The picture is now scaled up, its shape kept, until its
 * SHORTER side reaches the minimum; only a picture that cannot reach it
 * without breaking another bound the model states is refused:
 *
 * - its width ÷ height is outside the model's range (scaling never changes
 *   the shape, so no size fits), or
 * - reaching the minimum would push its LONGER side past the model's maximum
 *   (same reason: the shape fixes the long side once the short side is set),
 *   or a picture over the maximum would fall under the minimum once scaled
 *   down to it.
 *
 * How small a picture may start is not limited: a 50×50 picture goes to a
 * 300 px model as 300×300. It is the user's own input; refusing it would only
 * cost them the run, and a model sent a larger copy of it sees exactly the
 * detail it would have had.
 *
 * Pure arithmetic — the encode itself (rotate first, lanczos3, metadata
 * stripped, the format the model accepts) is `ensureImageForProvider`'s
 * (providers/kie/video.ts), the one place a provider input is re-encoded.
 * Every check of a stated minimum side goes through {@link planImageSize}:
 * `lib/__tests__/image-min-size-guard.test.ts` fails a refusal on a minimum
 * written anywhere else.
 */

/** The size bounds a model states for an input picture, in pixels and width ÷ height. All optional. */
export interface ImageSizeBounds {
  /** Each side must be at least this. */
  readonly minSide?: number
  /** Each side must be at most this. */
  readonly maxSide?: number
  /** Width ÷ height, inclusive. */
  readonly minRatio?: number
  readonly maxRatio?: number
}

export type ImageSizePlan =
  /** Both sides already meet the minimum (or none is stated). */
  | { readonly kind: "fits" }
  /** Scale to exactly this size: the shape kept, the shorter side at the minimum. */
  | { readonly kind: "enlarge"; readonly width: number; readonly height: number }
  /** No size of this shape meets every bound. `message` is a sentence for the user. */
  | { readonly kind: "refuse"; readonly reason: "ratio" | "max-side"; readonly message: string }

/**
 * What a picture of `width`×`height` (as displayed: after its EXIF
 * orientation) needs to meet `bounds`' minimum side. The ratio bounds are
 * checked here only because they decide whether an enlarge can succeed; a
 * caller that already refuses an out-of-range ratio keeps its own sentence
 * for it.
 *
 * The enlarged size rounds UP on both sides, so the shorter side is never a
 * pixel under the minimum; the longer side keeps the shape to within a pixel.
 */
export function planImageSize(width: number, height: number, bounds: ImageSizeBounds, modelLabel = "This model"): ImageSizePlan {
  const minSide = bounds.minSide
  if (!minSide) return { kind: "fits" }

  // A picture over the maximum is scaled down to it (shape kept) before it is
  // sent, so its shorter side is measured at THAT size: 2100×260 to a 256 px,
  // 2048 px model goes as 2048×254 — under the minimum, and no size of its
  // shape meets both.
  const long = Math.max(width, height)
  if (bounds.maxSide !== undefined && long > bounds.maxSide) {
    const shortSent = Math.round((Math.min(width, height) * bounds.maxSide) / long)
    if (shortSent >= minSide) return { kind: "fits" }
    return {
      kind: "refuse",
      reason: "max-side",
      message:
        `${modelLabel} needs a picture ${minSide} to ${bounds.maxSide} pixels on each side; this one is ${width}×${height}, ` +
        `so its shorter side would be ${shortSent} pixels once its longer side is brought to ${bounds.maxSide}. ` +
        `Crop it to a less extreme shape and run it again.`,
    }
  }
  if (width >= minSide && height >= minSide) return { kind: "fits" }

  const ratio = width / height
  if ((bounds.minRatio !== undefined && ratio < bounds.minRatio) || (bounds.maxRatio !== undefined && ratio > bounds.maxRatio)) {
    return {
      kind: "refuse",
      reason: "ratio",
      message:
        `${modelLabel} needs a picture at least ${minSide} pixels on each side with a width ÷ height between ` +
        `${bounds.minRatio ?? 0} and ${bounds.maxRatio ?? "any"}; this one is ${width}×${height}, so no enlarged copy of it fits. ` +
        `Crop it to a less extreme shape and run it again.`,
    }
  }

  const scale = minSide / Math.min(width, height)
  // Round up, then make sure the shorter side is the minimum exactly (a float
  // product like 281 × (300/281) may land a hair above an integer).
  let w = Math.ceil(width * scale - 1e-9)
  let h = Math.ceil(height * scale - 1e-9)
  if (width <= height) w = Math.max(w, minSide)
  else h = Math.max(h, minSide)

  if (bounds.maxSide !== undefined && Math.max(w, h) > bounds.maxSide) {
    return {
      kind: "refuse",
      reason: "max-side",
      message:
        `${modelLabel} needs a picture ${minSide} to ${bounds.maxSide} pixels on each side; this one is ${width}×${height}, ` +
        `and enlarging its shorter side to ${minSide} pixels would make its longer side ${Math.max(w, h)}. ` +
        `Crop it to a less extreme shape and run it again.`,
    }
  }
  return { kind: "enlarge", width: w, height: h }
}

/** A picture's size as displayed: EXIF orientations 5–8 turn it a quarter, swapping its sides. */
export function displayedSize(width: number, height: number, orientation: number | undefined): { width: number; height: number } {
  return orientation !== undefined && orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height }
}
