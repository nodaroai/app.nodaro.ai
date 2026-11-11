import { VIDEO_REF_LIMITS_BY_PROVIDER } from "@nodaro/shared/models"
import type { VideoCharacterReference } from "@nodaro/shared/video"

/**
 * How a video request's reference images and character references count
 * against the provider's input budget — the ONE rule /v1/generate-video and
 * /v1/text-to-video both apply before `videoCharacterRefProblem` and
 * `kling4InputProblem`.
 *
 * The editor seats a wired character's portrait in `referenceImageUrls` AND
 * sends the character in `characterReferences`. On a model that counts every
 * material against one budget (`materials` on VIDEO_REF_LIMITS_BY_PROVIDER —
 * Kling 4.0 and Kling 4.0 Flash) the provider runner turns that seat into the
 * subject, so it is ONE material, never two. A character is "seated" when its
 * portrait (`imageUrl`) is one of the reference images.
 */
export interface VideoMaterialCounts {
  /** Characters whose portrait is also one of the reference images. */
  readonly seatedCharacters: number
  /**
   * The image count `videoCharacterRefProblem` budgets: on a one-budget model
   * the seats are the characters themselves, so they leave the image count;
   * on any other model (the Gemini Omni unit budget) every image counts.
   */
  readonly imageCountForCharacterRule: number
  /** The characters `kling4InputProblem` adds to the images: those not already seated. */
  readonly unseatedCharacters: number
}

export function videoMaterialCounts(args: {
  provider: string
  characterReferences: readonly Pick<VideoCharacterReference, "imageUrl">[] | undefined
  referenceImageUrls: readonly string[] | undefined
}): VideoMaterialCounts {
  const images = args.referenceImageUrls ?? []
  const characters = args.characterReferences ?? []
  const seatedCharacters = characters.filter((c) => images.includes(c.imageUrl)).length
  const oneBudget = VIDEO_REF_LIMITS_BY_PROVIDER[args.provider]?.materials !== undefined
  return {
    seatedCharacters,
    imageCountForCharacterRule: images.length - (oneBudget ? seatedCharacters : 0),
    unseatedCharacters: characters.length - seatedCharacters,
  }
}
