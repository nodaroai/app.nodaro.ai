/**
 * How `finalizeJobWithMedia` (lib/job-finalize.ts) stores what a job delivers
 * beside its result, and the attempts every image is stored with: the extra
 * image sets (every layer of a split image) — refused before any claim when
 * finalize cannot honour them, stored a few at a time under the job's own key
 * family, and filed in the Library. job-finalize.ts re-exports the public names.
 */
import { uploadImageVariantsMaybeWatermark } from "../workers/shared.js"
import { IMAGE_TYPES, type FinalizeJobType } from "./job-finalize-types.js"

/**
 * A set of extra images a job delivers beside its result — every layer of a
 * split image. Finalize stores them exactly as it stores the result (the same
 * uploader: the watermark rule and the user's storage), each under its own key
 * in this job's key family (`<jobId>-<key>-<n>`), and writes their stored URLs,
 * in order, on `output_data[key]`.
 */
export interface ExtraImageSet {
  /** The `output_data` key the stored URLs land on: a plain word (letters and digits), never one finalize writes itself. */
  readonly key: string
  /** Each image: the provider's URL and, filed in the Library, the name it is filed under. */
  readonly images: ReadonlyArray<{ readonly url: string; readonly name?: string }>
  /** File each image in the Library beside the result, under its name (`output_data.libraryImages`, read by createAssetFromJob). */
  readonly library?: true
  /**
   * An image that still cannot be stored after its attempts (`storeAttempts`)
   * is DROPPED from the set — the job completes with the rest — instead of
   * failing the finalize. Its index is reported (`DroppedExtraImages`), so the
   * caller can say so and charge only for what was stored.
   */
  readonly dropUnstorable?: true
}

/** The stored URLs of each extra image set, by its key, in its order (a dropped image has none). */
export type StoredExtraImages = Readonly<Record<string, readonly string[]>>

/** The indices (into `images`) of each set's images that were dropped, by key; empty when every image was stored. */
export type DroppedExtraImages = Readonly<Record<string, readonly number[]>>

/** How many extra images are stored at once: a 100-layer split must not open 100 uploads together. */
export const EXTRA_IMAGE_UPLOAD_CONCURRENCY = 6

/** The wait before store attempt `n + 1` (n from 1): a short, growing pause for a transient fault. */
function storeRetryDelayMs(attempt: number): number {
  return 400 * attempt
}

/**
 * Store, trying up to `attempts` times; every attempt writes the same
 * deterministic keys. A failed attempt of ONE image leaves no object and
 * counts nothing (an upload is counted against the user's storage only once
 * it succeeded, and a failed one is aborted), so retrying it never counts a
 * byte twice. An attempt of several images at once (the result's variants) is
 * not all-or-nothing: a variant it stored before another failed stays, counted,
 * and the next attempt stores and counts it again.
 *
 * A store that SUCCEEDED leaves an object at the job's key, counted against the
 * user's storage, that nothing names until the completion writes `output_data`.
 * A finalize that then does not complete the job — a later step throws, or a
 * cancel wins the completion — deletes each object it stored and gives its
 * bytes back, under its claim (lib/job-finalize-discard.ts). A failed attempt's
 * stray variant is not among them: this finalize never learnt its URL.
 */
export async function storeWithAttempts<T>(attempts: number, store: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    try {
      return await store()
    } catch (err) {
      lastErr = err
      if (attempt < attempts) await new Promise((r) => setTimeout(r, storeRetryDelayMs(attempt)))
    }
  }
  throw lastErr
}

/** The output_data keys finalize writes on an image job, which an extra set may never take. */
const FINALIZE_IMAGE_KEYS: ReadonlySet<string> = new Set([
  "imageUrl", "imageUrls", "imageMimeType", "thumbnailUrl", "providerTaskId", "kieTaskId", "seed", "fallbackUsed", "providerMs", "libraryImages",
])

/** Refuses an extra-set declaration finalize cannot honour; thrown before any claim or write. */
export function assertExtraImageSets(jobType: FinalizeJobType, sets: ReadonlyArray<ExtraImageSet> | undefined): void {
  if (!sets?.length) return
  if (!IMAGE_TYPES.has(jobType)) throw new Error(`[job-finalize] ${jobType}: extra image sets are for an image job`)
  const seen = new Set<string>()
  for (const set of sets) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(set.key) || FINALIZE_IMAGE_KEYS.has(set.key) || seen.has(set.key)) {
      throw new Error(`[job-finalize] extra image set key "${set.key}" must be a plain word, used once, and not one finalize writes`)
    }
    seen.add(set.key)
  }
}

/**
 * Store every extra image set: each image through `uploadImageVariantsMaybeWatermark`
 * (the result's own uploader — watermark and storage accounting alike) under
 * `<jobId>-<key>-<n>` (n from 1, the image's place in its set), a few at a
 * time, each tried up to `attempts` times. Post-provider, like the result's
 * upload: a failure is the uploader's PostProcessingError — unless the set
 * drops an unstorable image (`dropUnstorable`), which is then left out of the
 * stored list and reported by index.
 *
 * Each image stored is reported to `onStored` as it lands, and a failure is
 * thrown only once every upload of its batch has settled: the caller then
 * knows every object this store left, with none still being written.
 */
export async function storeExtraImageSets(
  sets: ReadonlyArray<ExtraImageSet>,
  jobId: string,
  userId: string | undefined,
  watermark: boolean,
  attempts: number,
  onStored: (url: string) => void,
): Promise<{ stored: StoredExtraImages; dropped: DroppedExtraImages }> {
  const stored: Record<string, readonly string[]> = {}
  const dropped: Record<string, readonly number[]> = {}
  for (const set of sets) {
    const urls: Array<string | null> = []
    for (let i = 0; i < set.images.length; i += EXTRA_IMAGE_UPLOAD_CONCURRENCY) {
      const batch = set.images.slice(i, i + EXTRA_IMAGE_UPLOAD_CONCURRENCY)
      const settled = await Promise.allSettled(batch.map(async (image, j): Promise<string | null> => {
        const n = i + j + 1
        try {
          const [url] = await storeWithAttempts(attempts, () => uploadImageVariantsMaybeWatermark([image.url], `${jobId}-${set.key}-${n}`, userId, watermark))
          onStored(url!)
          return url!
        } catch (err) {
          if (!set.dropUnstorable) throw err
          console.warn(`[job-finalize] ${jobId}: ${set.key} image ${n} could not be stored after ${attempts} attempt(s), dropped: ${err instanceof Error ? err.message : String(err)}`)
          return null
        }
      }))
      const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
      if (failed) throw failed.reason
      urls.push(...settled.map((s) => (s as PromiseFulfilledResult<string | null>).value))
    }
    stored[set.key] = urls.filter((u): u is string => u !== null)
    dropped[set.key] = urls.flatMap((u, i) => (u === null ? [i] : []))
  }
  return { stored, dropped }
}

/** The Library entries of the sets that ask to be filed: each stored URL with its image's name (a dropped image is not filed). */
export function libraryImagesOf(sets: ReadonlyArray<ExtraImageSet>, stored: StoredExtraImages, dropped: DroppedExtraImages): Array<{ url: string; name?: string }> {
  return sets.filter((set) => set.library).flatMap((set) => {
    const gone = new Set(dropped[set.key] ?? [])
    const kept = set.images.filter((_, i) => !gone.has(i))
    return kept.map((image, i) => ({
      url: stored[set.key]![i]!,
      ...(typeof image.name === "string" && image.name.trim() ? { name: image.name.trim() } : {}),
    }))
  })
}
