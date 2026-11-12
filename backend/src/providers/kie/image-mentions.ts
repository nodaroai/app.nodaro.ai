/**
 * Image mentions in a KIE video prompt — pure, no I/O.
 *
 * The platform numbers a request's reference images `@image_N` in the prompt
 * (and a cast member's mention points at the seat their image occupies). A
 * model whose request body does not carry those images has nothing for the
 * mention to point at, so it loses its `@` and reaches the model as plain
 * words. Grok Imagine Video 1.5 keeps the one mention its body does carry;
 * PixVerse V6 Max, which takes no reference images, keeps none.
 */

/** `@image_N`, `@imageN`, `@image(N)` — every spelling of an image mention. */
const IMAGE_MENTION = /@(image(?:_\d+|\(\d+\)|\d+))(?![\p{L}\p{N}_])/giu

/**
 * Drop the `@` from every image mention the request body does not carry.
 * `carried` names the ones it does, by the mention's word (`image1`).
 */
export function neutralizeImageMentions(prompt: string, carried: (word: string) => boolean = () => false): string {
  return prompt.replace(IMAGE_MENTION, (whole, word: string) => (carried(word) ? whole : word))
}
