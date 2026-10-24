/**
 * What a Kling 4 trend run sends Cast Swap, counted as the engine counts it,
 * for the trend checks the backend runs (publish, run, estimate) and the trend
 * builder shows (the prompt room, the picture counter), so the two never
 * differ. Not an Apache grant: these numbers measure the engine's private
 * prompt builder.
 */

type SlotKind = "person" | "pet" | "product" | "location"

/**
 * The text Cast Swap writes around a Kling 4 run's own prompts, as Kling
 * counts it (its image tokens resolved: `{image:1:person}` → "the person from
 * @image_1"), by part, every role with 3 images. Measured from the engine's
 * prompt builder; a wording change there moves these.
 *
 * - `head`: the edit line and the head lines, a clip with sound;
 * - `role`: one role's sentence by kind, its name not counted (added once, as
 *   it is);
 * - `reference`: one fixed reference with 3 images, its line not counted;
 *   `referenceImageMention`: each `{image}` in its line;
 * - `prePrompt` / `postPrompt`: what joins a pre prompt, and the header before
 *   the post prompt;
 * - `mentions`: how often a role's sentence names its first image (each
 *   later image once): an image number past 9 is one character more each time.
 */
export const KLING_ENGINE_TEXT = {
  head: 425,
  role: { person: 208, pet: 190, product: 269, location: 154 },
  reference: 50,
  referenceImageMention: 1,
  prePrompt: 2,
  postPrompt: 49,
  mentions: { person: 5, pet: 4, product: 3, location: 1 },
} as const

/** The extra characters an image number takes past one digit. */
const extraDigits = (n: number) => (n >= 100 ? 2 : n >= 10 ? 1 : 0)

/**
 * The most text Cast Swap writes around a Kling 4 trend's own prompts: its
 * roles (each slot's kind and role name) and fixed references, at the worst
 * case the engine checks — every slot's 3 pictures UNPREPARED, numbered in
 * order (the engine builds that prompt first), then the references' own. The
 * pre prompt, the trend prompt and the user's details share what is left of
 * Kling 4's prompt cap. A `{slot:…}` in the details, which the engine expands
 * to a longer name, is not counted (the engine's own `prompt_too_long` then).
 */
export function klingEngineText(trend: {
  readonly slots: readonly { readonly kind: SlotKind; readonly roleName: string }[]
  readonly references: readonly { readonly line: string; readonly images: readonly unknown[] }[]
}): number {
  const t = KLING_ENGINE_TEXT
  let text = t.head + t.prePrompt + t.postPrompt
  let n = 0
  for (const s of trend.slots) {
    const first = n + 1
    text += t.role[s.kind] + s.roleName.length + extraDigits(first) * t.mentions[s.kind] + extraDigits(first + 1) + extraDigits(first + 2)
    n += 3
  }
  for (const r of trend.references) {
    const mentions = r.line.split("{image}").length - 1
    const first = n + 1
    text += t.reference + r.line.length + t.referenceImageMention * mentions + extraDigits(first) * Math.max(1, mentions)
    for (let k = 1; k < r.images.length; k++) text += extraDigits(first + k)
    n += r.images.length
  }
  return text
}

/**
 * The images a Cast Swap run sends, as its route counts them: with
 * `prepareReferences` on (the default, and every trend run), each person, pet
 * and product role with pictures sends its ONE prepared picture; a location
 * (never prepared), or any role with preparation off, sends its own pictures;
 * every fixed reference sends its own. (A preparation that fails at run time
 * falls back to the role's own pictures; a Kling run that then passes the cap
 * is refused and refunded by the engine, never here.)
 */
export function castSwapImagesSent(
  roles: readonly { readonly kind: SlotKind; readonly images: number }[],
  referenceImages: number,
  prepareReferences = true,
): number {
  const sent = roles.reduce((n, r) => n + (r.images === 0 ? 0 : prepareReferences && r.kind !== "location" ? 1 : r.images), 0)
  return sent + referenceImages
}
