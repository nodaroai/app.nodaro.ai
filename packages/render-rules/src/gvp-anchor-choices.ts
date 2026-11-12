/**
 * The anchor choices Generate Video Pro's config panel offers for a model. A
 * model admitted without reference images (the catalog's `gvpWithoutReferences`)
 * has no "reference" choice: a reference-driven shot needs the identity
 * references it cannot take, and a stored "reference" runs as Auto. Read from
 * the wire rule itself (`resolveGvpAnchorWire`, `@nodaro/shared`), which sends
 * "reference" as Auto on exactly those models, so the menu and the run agree.
 */
import { GVP_ANCHOR_CHOICES, resolveGvpAnchorWire, type GvpAnchorChoice } from "@nodaro/shared/models"

export function gvpAnchorChoicesFor(provider: string | undefined): readonly GvpAnchorChoice[] {
  return resolveGvpAnchorWire("reference", provider) === undefined
    ? GVP_ANCHOR_CHOICES.filter((c) => c !== "reference")
    : GVP_ANCHOR_CHOICES
}
