/**
 * Canonical list of font display names supported by the Remotion renderer.
 *
 * Single source of truth shared by:
 *  - the backend Zod schemas (`z.enum(SUPPORTED_FONT_NAMES)`), which CANNOT
 *    import `@nodaro/remotion` (its font-registry pulls the render runtime +
 *    `@remotion/google-fonts` side-effects into a validation path), and
 *  - `packages/remotion/src/lib/font-registry.ts`, which loads each face and
 *    is kept in lock-step with this tuple by a compile-time `satisfies` guard.
 *
 * Order/spelling MUST match the keys of the `fonts` object in font-registry.ts.
 */
export const SUPPORTED_FONT_NAMES = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Montserrat",
  "Poppins",
  "Raleway",
  "Nunito",
  "Lato",
  "Playfair Display",
  "Merriweather",
  "Lora",
  "EB Garamond",
  "Bebas Neue",
  "Oswald",
  "Anton",
  "Dancing Script",
  "Pacifico",
  "Caveat",
  "Roboto Mono",
  "Fira Code",
  "Rubik",
  "Heebo",
  "Cairo",
  "Tajawal",
] as const

export type SupportedFontName = (typeof SUPPORTED_FONT_NAMES)[number]
