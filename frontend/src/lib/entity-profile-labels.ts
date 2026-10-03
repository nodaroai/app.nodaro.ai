import type { MessageKey, TFunction } from "@/lib/i18n"

/**
 * Display text for the style and gender ids an entity profile stores
 * ("realistic", "3d-pixar", "female"). The ids stay English in the data and in
 * prompts; only the caption is translated. An id with no entry passes through.
 */
const STYLE_KEYS: Readonly<Record<string, MessageKey>> = {
  realistic: "studio.styleRealistic",
  anime: "studio.styleAnime",
  "3d-pixar": "studio.style3dPixar",
  illustration: "studio.styleIllustration",
}

const GENDER_KEYS: Readonly<Record<string, MessageKey>> = {
  male: "studio.genderMale",
  female: "studio.genderFemale",
  other: "studio.otherLower",
}

function caption(table: Readonly<Record<string, MessageKey>>, id: string, t: TFunction): string {
  return Object.hasOwn(table, id) ? t(table[id]) : id
}

/** An entity's art style; a profile without one is realistic. */
export function entityStyleLabel(style: string | undefined, t: TFunction): string {
  return caption(STYLE_KEYS, style ?? "realistic", t)
}

/** A character's gender; a profile without one reads as other. */
export function entityGenderLabel(gender: string | undefined, t: TFunction): string {
  return caption(GENDER_KEYS, gender ?? "other", t)
}
