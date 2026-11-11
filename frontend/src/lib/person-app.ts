// frontend/src/lib/person-app.ts
import { characterArtUrl } from "@nodaro/picker-ui"

const PERSON_APP_BASE_URL =
  (import.meta.env.VITE_PERSON_URL as string | undefined)?.replace(/\/+$/, "") ||
  "https://person.nodaro.ai"

/** Person app home — used by the flagship "Open Person" action. */
export function personAppBaseUrl(): string {
  return PERSON_APP_BASE_URL
}

/** The Person picker's Type options whose photos fan across the Person card on the home screen. */
export const PERSON_APP_COLLAGE_IDS: ReadonlyArray<string> = ["supermodel", "silver-fox", "graceful-woman", "elf-woman"]

/**
 * The Person card's photos: the picker's own photos of those options, through
 * the same lookup the picker uses, so the card follows the deployment's
 * picture setting (empty when it shows no platform pictures). Asked at render,
 * never at import: the setting is applied at start, after the imports
 * (look-previews-bootstrap.ts).
 */
export function personAppCollage(): ReadonlyArray<string> {
  return PERSON_APP_COLLAGE_IDS.map((id) => characterArtUrl("person", id)).filter((url): url is string => url !== undefined)
}
