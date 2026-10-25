/**
 * `virtual:site-a11y` on every build without the shared site header
 * (community, business, public CI, a cloud build with the flag off) and in
 * tests: there is no other product to share the choices with, so no store.
 * The accessibility menu keeps them in this browser, as before
 * (`lib/accessibility-preferences.ts`).
 */
export const sharedAccessibility: null = null
