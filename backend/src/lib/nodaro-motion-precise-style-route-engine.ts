/**
 * The Precise art-style route's answer to an engine that cannot read the
 * per-style map (`styleRoutes`): the photographic path in its place when every
 * Filmed style is kept Precise in it. Used only by the plugin toolkit's
 * `tk.settings.nodaroMotionPreciseStyleRoute()`.
 *
 * Its own module, apart from `nodaro-motion-precise-style-route.ts`, because it
 * reads the style catalog (`@nodaro/prompts`): the route module is reached by
 * the ffmpeg characterization tests, and keeping the catalog out of it keeps
 * that job's inputs (tools/ci/job-inputs.json) free of the prompts package.
 * This module is pure (no database).
 */
import { STYLES, getStyleMedium, stylesForMedia } from "@nodaro/prompts/pickers"
import { engineRoutesPerStyle, type NodaroMotionPreciseStyleRoute } from "./nodaro-motion-precise-style-route.js"

/**
 * The Filmed styles, in catalog order: the video styles whose medium is "photo",
 * exactly what the admin's per-style table lists under Filmed (the same
 * expression in StyleRoutesTable.tsx `filmedStyleIds`; a test on each side pins
 * both to one list). A new array.
 */
export function filmedStyleIds(): string[] {
  return stylesForMedia(STYLES, "video")
    .filter((s) => getStyleMedium(s.id) === "photo")
    .map((s) => s.id)
}

/**
 * The answer (`preciseStyleRouteForPlugin`'s) as this engine can read it. An
 * engine that declares `castSwap.preciseStyleRoutePerStyle` gets it unchanged.
 * Any other gets no `styleRoutes`, and `photographicStyles: "precise"` in their
 * place when every Filmed style's entry is exactly "precise": such an engine
 * cannot make a clip black and white, so a Filmed style on "precise-gray" keeps
 * it Flex there, as a Filmed style left out does. A stored
 * `photographicStyles: "precise"` is kept either way. Null when nothing is left.
 * `route` itself when nothing changes, else a new object. This build claims it
 * as `preciseStyleRouteFilmedFallback` (its platform claim, `PLATFORM_SUPPORTS`
 * in ee/lib/engine-environments.ts), so the admin page names an environment's
 * Filmed styles Precise only where its platform does this.
 */
export function styleRoutesForEngine(
  route: NodaroMotionPreciseStyleRoute | null,
  cs: { readonly preciseStyleRoutePerStyle?: boolean } | undefined,
): NodaroMotionPreciseStyleRoute | null {
  if (!route || route.styleRoutes === undefined || engineRoutesPerStyle(cs)) return route
  const { styleRoutes, ...rest } = route
  const filmed = filmedStyleIds()
  const filmedPrecise = filmed.length > 0 && filmed.every((id) => styleRoutes[id] === "precise")
  const answer: NodaroMotionPreciseStyleRoute = filmedPrecise ? { ...rest, photographicStyles: "precise" } : rest
  return Object.keys(answer).length > 0 ? answer : null
}
