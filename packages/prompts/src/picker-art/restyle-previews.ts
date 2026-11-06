// Restyle previews: for each art style, a short clip of real footage wiping
// into that style, for a picker that restyles a video. Keyed by the `style`
// catalog's option id. An entry exists only for an approved clip: a style
// without one has no preview here.
//
// Each approved style keeps the URLs of its source shot and its generated clip
// (no wipe) in a comment beside its entry, so the clip can be composed again if
// the switch animation changes.
//
// Separate from LOOK_PREVIEW_SETS.style, whose stills every other art style
// picker keeps showing. Like every render, a clip lives under picker-renders/
// on the CDN, a key no user owns; a test holds this.
import { lookPreviewStillUrl } from "./images.js"

/** One style's preview clip. */
export interface RestylePreview {
  readonly url: string
  /** The moment of the clip its still is cut from, for a clip whose usual moment frames it badly. Absent: the usual moment (`lookPreviewStillUrl`). */
  readonly stillAtSeconds?: number
}

/** Art style id → its restyle preview clip. */
export const RESTYLE_PREVIEWS: Readonly<Record<string, RestylePreview>> = {
  // Source shot: https://cdn.nodaro.ai/picker-renders/4054a0e1-af60-47f9-86bd-a78ab93f3800.mp4
  // Generated, no wipe: https://cdn.nodaro.ai/picker-renders/9dc6b337-58b4-4a63-889f-70561a8f1f00.mp4
  anime: { url: "https://cdn.nodaro.ai/picker-renders/7fbad6e4-023f-4282-ac3d-d186f2cbb37b.mp4", stillAtSeconds: 7 },
  // Source shot: https://cdn.nodaro.ai/picker-renders/4ffff922-e807-42cc-a2a0-c66c3a8d492c.mp4
  // Generated, no wipe: https://cdn.nodaro.ai/picker-renders/fca5d96d-ee9c-430e-ba82-2795c0adb8d6.mp4
  claymation: { url: "https://cdn.nodaro.ai/picker-renders/2916a2f7-114c-4c7e-9be0-5bf229d76133.mp4" },
  // Source shot: https://cdn.nodaro.ai/picker-renders/41faaa51-5e77-4097-aa9b-bef6738328b7.mp4
  // Generated, no wipe: https://cdn.nodaro.ai/picker-renders/5a28da72-f3ee-49a8-b732-f73e79741b62.mp4
  "comic-book": { url: "https://cdn.nodaro.ai/picker-renders/7a2cd17c-b02f-4ae4-9723-ef48d0eda52a.mp4" },
  // Source shot: https://cdn.nodaro.ai/picker-renders/4a70c22d-04f0-4b5a-90d4-e9dd7ddb01c4.mp4
  // Generated, no wipe: https://cdn.nodaro.ai/picker-renders/5ab33529-ef2a-42bc-a625-d6b1abfeef1c.mp4
  "felt-puppet": { url: "https://cdn.nodaro.ai/picker-renders/3aa3c81b-ba19-4776-becc-e0c47c700699.mp4" },
  // Source shot: https://cdn.nodaro.ai/picker-renders/b1e77bdc-7c58-4cd8-a2d6-fd49379fee9e.mp4
  // Generated, no wipe: https://cdn.nodaro.ai/picker-renders/a9aeca2d-bcd6-477b-80d7-5e6454ee2c25.mp4
  "oil-painting": { url: "https://cdn.nodaro.ai/picker-renders/73c98260-9444-45e7-bccb-040b5d33fb53.mp4" },
  // Source shot: https://cdn.nodaro.ai/picker-renders/d9e12a4a-677e-4e36-8f44-8503f14dd6b8.mp4
  // Generated, no wipe: https://cdn.nodaro.ai/picker-renders/d4dad451-802a-4795-9cc3-71ff3ed70c69.mp4
  "pixar-3d": { url: "https://cdn.nodaro.ai/picker-renders/c5ea2111-3283-4f80-ab05-8ab4450946ce.mp4" },
  // Source shot: https://cdn.nodaro.ai/picker-renders/789f4330-660b-42bd-8d11-6e638e8c7c88.mp4
  // Generated, no wipe: https://cdn.nodaro.ai/picker-renders/10471107-b26a-42e9-a3a5-068a42436d3c.mp4
  watercolor: { url: "https://cdn.nodaro.ai/picker-renders/61a26588-d09a-4959-b677-ee8b32e3281a.mp4" },
}

/** A preview clip's still, a frame the CDN cuts from it at the clip's own moment. */
export function restylePreviewStillUrl(preview: RestylePreview, width?: number): string | undefined {
  return lookPreviewStillUrl(preview.url, width, preview.stillAtSeconds)
}
