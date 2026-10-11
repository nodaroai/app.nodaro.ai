// packages/prompts/src/realism-wording.ts
/**
 * Realism and viewpoint wording for everyday-photo prompts: skin and finish
 * sentences, the identity-keeping realism instruction for an edit, and the eye-level
 * viewpoint and empty-hands sentences, worded for any person.
 */

/** Who a sentence is about: gendered ("she" / "her") or neutral ("the person" / "their"). */
export interface PersonWords {
  readonly subject: string
  readonly possessive: string
}

export const NEUTRAL_PERSON: PersonWords = { subject: "the person", possessive: "their" }

const cap = (s: string): string => (s.length === 0 ? s : `${s[0]!.toUpperCase()}${s.slice(1)}`)

export const REALISM_SKIN =
  "Skin shows its real structure: visible pores that vary in size across the nose and cheeks, fine vellus hair catching the light, faint uneven pigmentation, a little redness around the nostrils, natural oil on the forehead."

export const REALISM_FINISH =
  "The plain look of an everyday small-sensor snapshot: colour left as it was recorded, deep focus from the nearest shoulder to the background, a fine grain in the darker areas, bright areas that fade rather than clip."

export const REALISM_PASS_INSTRUCTION =
  "Make this photo look like an unretouched everyday snapshot: skin that shows its pores, its " +
  "fine hairs and the small changes in tone real skin has, colour left as it was recorded, everything " +
  "sharp from the shoulders to the background, a little grain in the shadows. Take out anything that makes it " +
  "look rendered — smoothed, waxy or airbrushed skin, a glow, over-sharpened edges — and add no text or icons. " +
  "Otherwise it stays the same person in the same frame: the face and its proportions, hair, clothing, pose and " +
  "background as they are."

/** The frame by its viewpoint only — never by a device. */
export function realismViewpoint(p: PersonWords): string {
  return `${cap(p.subject)} is looking straight at the viewer from eye level, mid-sentence: ${p.possessive} face and shoulders close up, the framing loose and a little crooked, both arms relaxed and down out of the frame. The whole image is the photograph itself, edge to edge, with no text or icons anywhere.`
}

export function realismEmptyHands(p: PersonWords): string {
  return `${cap(p.possessive)} hands are empty; ${p.subject} is holding nothing.`
}
