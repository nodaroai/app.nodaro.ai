import { buildFormatRegistry, type FormatRegistry } from "./registry"
import type { LookSelectionMap } from "../shot"

/**
 * A plan's own FILM look, spelled for a human before anything lands — the
 * preview's `Film: …` line (spec §6). BROWSER-FREE, like the rest of the
 * registry closure this reads from: no React, no `@/hooks`, no
 * the studio app's `nodaro-client`.
 */

/** The FILM strip's own chip names, in its order (V2FilmStrip's FILM_CHIPS). */
const FILM_CHIP_LABEL: Readonly<Record<string, string>> = {
  cameraFormatId: "Camera",
  colorLookId: "Color",
  styleId: "Art style",
  eraId: "Period",
}

/** One line per film chip the map sets — "Camera: ARRI Alexa" — for the preview.
 *  An id the catalog doesn't know prints as itself rather than vanishing: the
 *  plan is untrusted, and a stale/foreign id is still worth showing verbatim. */
export function describeFilmLook(
  film: LookSelectionMap | undefined,
  registry: FormatRegistry = buildFormatRegistry(),
): ReadonlyArray<string> {
  if (!film) return []
  return Object.keys(FILM_CHIP_LABEL).flatMap((key) => {
    if (!registry.filmKeys.has(key)) return []
    const value = film[key]
    if (value === undefined) return []
    const picker = registry.pickers.find((p) => p.key === key)
    const ids = Array.isArray(value) ? value : [value]
    const labels = ids.map((id) => picker?.options.find((o) => o.id === id)?.label ?? id)
    return [`${FILM_CHIP_LABEL[key]}: ${labels.join(", ")}`]
  })
}
