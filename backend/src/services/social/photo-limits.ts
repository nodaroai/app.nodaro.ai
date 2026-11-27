/**
 * The photo byte limits the networks declare (`SocialProvider.photoMaxBytes`).
 * A leaf module, so the provider descriptors carry a limit without loading the
 * fitter itself (`photo-fit.ts`).
 */

/**
 * Meta's photo limits: Facebook refuses a photo of 10 MB or more ("Photos
 * should be less than 10 MB"), Instagram a JPEG over 8 MB. One limit for every
 * Meta network: Instagram's, which leaves Facebook room to spare.
 */
export const META_PHOTO_MAX_BYTES = 8_000_000
