// GPT Image text-to-image endpoints SILENTLY IGNORE a supplied reference image —
// they generate purely from the prompt, which destroys character/entity identity
// when an anchor is passed (e.g. Studio asset shots: angles, poses, expressions).
// Their image-to-image siblings consume the anchor via `input_urls`. When
// reference image(s) are present, `generateImage` (`image.ts`) swaps the t2i
// provider for its i2i sibling below so the anchor is actually honored.
//
// TARGETED to GPT Image (and MiniMax H3 Image and Seedream 5.5, whose
// text-to-image endpoints take no image at all) — do NOT widen to a blanket
// "any t2i + refs → i2i" rule: models like nano-banana and the earlier seedream
// t2i legitimately accept reference images via `image_input` as a STYLE
// reference, and remapping them would change their behavior. Credit reservation
// already happened at the route; a model priced per input image prices a
// text-to-image id sent images on its edit id (`buildCreditModelIdentifier`), so
// the price follows this swap.
//
// A module of its own, with no imports, so a lane that decides a lever before
// calling `generateImage` (the ratio a Scene or surround run sends) can ask
// which model the request will reach without loading the provider.
export const GPT_IMAGE_T2I_TO_I2I: Readonly<Record<string, string>> = {
  "gpt-image-2": "gpt-image-2-i2i",
  "gpt-image-2-5-flare": "gpt-image-2-5-flare-i2i",
  "gpt-image-2-5-sunburst": "gpt-image-2-5-sunburst-i2i",
  "gpt-image-2-6-flare": "gpt-image-2-6-flare-i2i",
  "gpt-image-2-6-sunburst": "gpt-image-2-6-sunburst-i2i",
  "gpt-image-2-6-economy": "gpt-image-2-6-economy-i2i",
  "gpt-image": "gpt-image-i2i",
  "minimax-h3-image": "minimax-h3-image-i2i",
  "seedream-5-5": "seedream-5-5-i2i",
}

/**
 * The model `generateImage` sends a request to: the edit sibling above when
 * images go with it, else the model it was given. Its lever lists (the ratios
 * it takes) are the ones a lane snaps against — Seedream 5.5's edit takes
 * "auto", its text-to-image does not. Grok 2's own reference swap is left out:
 * that chain sends no ratio at all.
 */
export function kieImageModelSent(provider: string, imageCount: number): string {
  return imageCount > 0 ? (GPT_IMAGE_T2I_TO_I2I[provider] ?? provider) : provider
}
