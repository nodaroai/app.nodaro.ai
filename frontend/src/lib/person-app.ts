// frontend/src/lib/person-app.ts

const PERSON_APP_BASE_URL =
  (import.meta.env.VITE_PERSON_URL as string | undefined)?.replace(/\/+$/, "") ||
  "https://person.nodaro.ai"

/** Person app home — used by the flagship "Open Person" action. */
export function personAppBaseUrl(): string {
  return PERSON_APP_BASE_URL
}

/**
 * The photos fanned across the Person card on the home screen: four of the
 * Person picker's own Type photos, self-hosted under
 * frontend/public/picker-art/character/person/. Their names carry a content
 * hash; flagship-apps.test.tsx fails if they drift from the picker's map.
 */
export const PERSON_APP_COLLAGE: ReadonlyArray<string> = [
  "/picker-art/character/person/supermodel.f62fa13c.webp",
  "/picker-art/character/person/silver-fox.991735a5.webp",
  "/picker-art/character/person/graceful-woman.f9be86fc.webp",
  "/picker-art/character/person/elf-woman.b583edd6.webp",
]
