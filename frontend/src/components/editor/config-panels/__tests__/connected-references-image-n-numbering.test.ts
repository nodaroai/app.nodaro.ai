/**
 * Follow-up #1 (unified-asset-references): the editor's `{image:N}` chip index
 * must count only AUTO-ATTACHING references — plain images + canonical
 * character/location + object/creature/face — in image-refs-first order, so the
 * token the editor inserts matches the run's unified `@image_N` position. A
 * character/location VARIANT entry rides the list for the `@`-mention drill but
 * does NOT attach a reference image at run time (only the canonical does, unless
 * that variant is `@`-mentioned), so it must not inflate the counter.
 */
import { describe, it, expect } from "vitest"
import { connectedReferencesToRefImages } from "../connected-references"
import type { ConnectedReference } from "@nodaro/shared"

const byUrl = (items: ReturnType<typeof connectedReferencesToRefImages>, url: string) =>
  items.find((i) => i.url === url)!

describe("connectedReferencesToRefImages — {image:N} index (mixed-case fix)", () => {
  it("skips character variant entries so an object's index matches the run's @image_N", () => {
    const refs: ConnectedReference[] = [
      { id: "img", defaultName: "Photo", source: "wired-image", url: "u-img" },
      { id: "kira", defaultName: "Kira", source: "wired-character", url: "u-kira", characterSlug: "kira", variantDisplayName: "canonical" },
      { id: "kira_smile", defaultName: "Kira / smile", source: "wired-character", url: "u-smile", characterSlug: "kira", variantSlug: "smile" },
      { id: "kira_pose", defaultName: "Kira / pose", source: "wired-character", url: "u-pose", characterSlug: "kira", variantSlug: "pose" },
      { id: "gadget", defaultName: "Gadget", source: "wired-object", url: "u-gadget" },
    ]
    const items = connectedReferencesToRefImages(refs)
    // image-refs-first: plain image @1, character canonical @2 (attaches), the two
    // variants skip, object @3 — NOT @5.
    expect(byUrl(items, "u-img").index).toBe(1)
    expect(byUrl(items, "u-kira").index).toBe(2)
    expect(byUrl(items, "u-gadget").index).toBe(3)
  })

  it("skips location variant (bucket) entries too", () => {
    const refs: ConnectedReference[] = [
      { id: "img", defaultName: "Photo", source: "wired-image", url: "u-img" },
      { id: "loc", defaultName: "Library", source: "wired-location", url: "u-loc", locationSlug: "library" },
      { id: "loc_rain", defaultName: "Library / rain", source: "wired-location", url: "u-rain", locationSlug: "library", locationVariantBucket: "weather", locationVariantSlug: "rain" },
      { id: "rex", defaultName: "Rex", source: "wired-creature", url: "u-rex" },
    ]
    const items = connectedReferencesToRefImages(refs)
    expect(byUrl(items, "u-img").index).toBe(1)
    expect(byUrl(items, "u-loc").index).toBe(2)
    expect(byUrl(items, "u-rex").index).toBe(3) // location variant skipped
  })

  it("plain refs lead even when wired after an entity (image-refs-first)", () => {
    const refs: ConnectedReference[] = [
      { id: "obj", defaultName: "Obj", source: "wired-object", url: "u-obj" },
      { id: "img", defaultName: "Photo", source: "wired-image", url: "u-img" },
    ]
    const items = connectedReferencesToRefImages(refs)
    expect(byUrl(items, "u-img").index).toBe(1)
    expect(byUrl(items, "u-obj").index).toBe(2)
  })
})
