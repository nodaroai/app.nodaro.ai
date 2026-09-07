/** The entity libraries a bound reference can come from. */
export type RefEntityKind = "character" | "location" | "object" | "creature"

/**
 * `ConnectedReference.source` → the library kind it came from.
 *
 * A raw or manually attached image has no entity row behind it, so it lands in
 * the "image" bucket — the same bucket the picker's Images tab fills. The map
 * travels with the codec because the cast merge reads it to decide what KIND a
 * chip enrolls as, and that decision has to be identical wherever the merge runs.
 */
export const REF_SOURCE_KIND: Record<string, RefEntityKind | "image"> = {
  "wired-character": "character",
  "wired-face": "character",
  "wired-location": "location",
  "wired-object": "object",
  "wired-creature": "creature",
  "wired-image": "image",
  manual: "image",
}
