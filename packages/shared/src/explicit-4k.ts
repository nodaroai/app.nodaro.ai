/**
 * Video models on which ONLY an explicit 4K renders 4K (decided 2026-11-25:
 * Seedance 2.5, and Seedance 2.5 Extend). The spellings that mean 4K are
 * {@link isFourKResolution}'s: `4k`, `2160p` and `UHD`, in any case (decided
 * 2026-11-27); each is read as `4k` on every path ({@link explicitFourKOf}). Any
 * other size the model does not list — a K-style value that is not 4K (`2k`,
 * `1K`, `8K`), a Lip Sync `1440p` — lands where it landed before the model
 * gained 4K, never snapped up to it. Other models keep their own rules.
 */
export const EXPLICIT_4K_ONLY_VIDEO_MODELS: ReadonlySet<string> = new Set(["seedance-2-5", "seedance-2-5-extend"])

/** The spellings an explicit-4K model reads as 4K (compared trimmed, in lower case). */
export const FOUR_K_SPELLINGS: readonly string[] = ["4k", "2160p", "uhd"]

/** Whether a requested resolution is a 4K spelling (`4k`, `2160p`, `UHD`; any case). Read it only for an {@link EXPLICIT_4K_ONLY_VIDEO_MODELS} model. */
export function isFourKResolution(resolution: unknown): boolean {
  return typeof resolution === "string" && FOUR_K_SPELLINGS.includes(resolution.trim().toLowerCase())
}

/**
 * `"4k"` when `model` is an {@link EXPLICIT_4K_ONLY_VIDEO_MODELS} model and
 * `resolution` is one of its 4K spellings, else undefined: the one reading of
 * those spellings, so what is held, sent and recorded is 4K alike.
 */
export function explicitFourKOf(model: string | undefined, resolution: unknown): "4k" | undefined {
  return model !== undefined && EXPLICIT_4K_ONLY_VIDEO_MODELS.has(model) && isFourKResolution(resolution) ? "4k" : undefined
}

/** The note an adjustment carries when a 4K spelling other than `4k` was read as 4K. */
export function fourKSpellingReason(label: string, asked: string): string {
  return `${label} reads "${asked}" as 4K — using "4k".`
}

/**
 * The resolutions a LOOSE request (anything but a 4K spelling) may land on
 * for `provider`: its catalog `resolutions`, less 4K on an
 * {@link EXPLICIT_4K_ONLY_VIDEO_MODELS} model. A 4K spelling, and any other
 * model, gets `resolutions` unchanged.
 */
export function resolutionsALooseRequestMayLandOn<T extends string>(provider: string, asked: unknown, resolutions: readonly T[]): readonly T[] {
  if (!EXPLICIT_4K_ONLY_VIDEO_MODELS.has(provider) || isFourKResolution(asked)) return resolutions
  return resolutions.filter((r) => r.toLowerCase() !== "4k")
}
