/**
 * Guard: every Person dimension that renders chip silhouettes must have an
 * icon for EVERY catalog entry of that dimension.
 *
 * `renderEntryIcon(dimension, entry)` (person-dimension-grid.tsx) routes a
 * subset of dimensions to the small-silhouette icon components
 * (EyeShapeIcon / NoseIcon / LipsIcon / FacialHairIcon / BodyProportionsIcon /
 * BuildIcon / FaceShapeIcon / JawlineIcon). Each of those components looks the
 * entry id up in a `Record<string, JSX.Element>` and returns `null` when the
 * id is missing — so a new catalog id silently renders a BLANK chip (no SVG)
 * until someone adds its silhouette.
 *
 * This test fails CI if any entry in an icon-bearing dimension lacks a
 * silhouette. Dimensions that are intentionally icon-less (cheekbones,
 * facial-fullness, eye-set-brow — `renderEntryIcon` returns null for ALL their
 * entries) are auto-excluded by the "routes to an icon" detection, so they
 * neither require icons nor make this test fail.
 *
 * "Icon-bearing" is detected from renderEntryIcon's ROUTING — it returns a
 * non-null wrapper element for routed dimensions and `null` for icon-less ones.
 * This is deliberate (not a render-based "has <svg>" check): a dimension routed
 * to a component whose lookup record is ENTIRELY empty (every id resolves to
 * null internally → no <svg>) is still required to have silhouettes and fails
 * here, instead of silently dropping out of the coverage requirement. Per-entry
 * coverage is then verified by rendering and asserting a real <svg> exists.
 */

import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { PEOPLE, type Person, type PersonDimension } from "@nodaro/prompts"
import { renderEntryIcon } from "../person-dimension-grid"

/** Does this dimension/entry render an actual silhouette (an <svg>)? */
function hasIcon(dimension: PersonDimension, entry: Person): boolean {
  const element = renderEntryIcon(dimension, entry)
  if (element === null) return false
  const { container, unmount } = render(element)
  const present = container.querySelector("svg") !== null
  unmount()
  return present
}

// Every distinct dimension that appears in the catalog.
const ALL_DIMENSIONS = Array.from(
  new Set(PEOPLE.map((p) => p.dimension)),
) as PersonDimension[]

const entriesOf = (dim: PersonDimension): Person[] =>
  PEOPLE.filter((p) => p.dimension === dim)

// A dimension is "icon-bearing" iff renderEntryIcon ROUTES it to an icon
// component (returns a non-null element) — regardless of whether that record is
// currently populated. An entirely-empty routed record is therefore caught (it
// must have silhouettes but renders none), not silently excluded. Icon-less
// dims (renderEntryIcon returns null for every entry) drop out.
const ICON_BEARING_DIMENSIONS = ALL_DIMENSIONS.filter((dim) => {
  const first = entriesOf(dim)[0]
  return first !== undefined && renderEntryIcon(dim, first) !== null
})

describe("Person dimension icon coverage", () => {
  it("detects at least one icon-bearing dimension (sanity)", () => {
    expect(ICON_BEARING_DIMENSIONS.length).toBeGreaterThan(0)
  })

  it.each(ICON_BEARING_DIMENSIONS)(
    "dimension %s has a silhouette for every catalog entry",
    (dimension) => {
      const entries = entriesOf(dimension)
      const missing = entries
        .filter((entry) => !hasIcon(dimension, entry))
        .map((entry) => entry.id)
      expect(
        missing,
        `Dimension "${dimension}" is missing silhouette icons for: ${missing.join(", ")}. ` +
          `Add them to the matching lookup record in small-silhouette-icons.tsx.`,
      ).toEqual([])
    },
  )
})
