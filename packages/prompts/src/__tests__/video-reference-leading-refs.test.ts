/**
 * D5 unified-numbering invariant for `resolveVideoReferenceCore`'s `leadingRefUrls`
 * (unified-asset-references spec, 2026-06-29). Leading plain image-refs occupy
 * `@image_1 … @image_offset`; every asset URL the core attaches (canonical /
 * extras) is numbered AFTER them, prepended to `additionalUrls` so the worker
 * payload position == the `@image_N` ordinal == the `{image:N}` token the editor
 * offers. Frames are tail-appended elsewhere and out of scope here.
 *
 * The opt-in contract: WITHOUT `leadingRefUrls` the core behaves exactly as
 * before (covered by the existing suite); these cases exercise the WITH path.
 */
import { describe, it, expect } from "vitest"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"

const A = "https://cdn/a.png"
const B = "https://cdn/b.png"
const E1 = "https://cdn/e1.png"
const E2 = "https://cdn/e2.png"

describe("resolveVideoReferenceCore — leadingRefUrls (D5)", () => {
  it("leading refs only: tokens number 1..offset, URLs returned in order", () => {
    const r = resolveVideoReferenceCore({
      prompt: "start {image:1:hero} mid {image:2:car} end",
      wiredCharRefs: [],
      leadingRefUrls: [A, B],
    })
    expect(r.additionalUrls).toEqual([A, B])
    expect(r.prompt).toContain("the hero from @image_1")
    expect(r.prompt).toContain("the car from @image_2")
  })

  it("leading + extra asset: extra is numbered AFTER the leading refs (offset)", () => {
    const r = resolveVideoReferenceCore({
      prompt: "a scene of {image:2:object}",
      wiredCharRefs: [],
      // one plain ref leads → offset 1 → the extra is @image_2
      leadingRefUrls: [A],
      extraRefs: [{ url: E1, description: "object" }],
    })
    // worker payload: leading first, then the asset URL
    expect(r.additionalUrls).toEqual([A, E1])
    // the extra's directive bullet is numbered @image_2 (offset+1), NOT @image_1
    expect(r.prompt).toContain("@image_2")
    expect(r.prompt).not.toMatch(/@image_1\b/) // @image_1 is the (un-bulleted) leading ref
    // the {image:2} body token resolves against the unified count (2)
    expect(r.prompt).toContain("the object from @image_2")
  })

  it("out-of-range token (N > leading+assets) drops to the bare label", () => {
    const r = resolveVideoReferenceCore({
      prompt: "x {image:5:ghost} y",
      wiredCharRefs: [],
      leadingRefUrls: [A],
      extraRefs: [{ url: E1, description: "obj" }],
    })
    // count is 2 → {image:5} is out of range → bare label, never raw token
    expect(r.prompt).toContain("x ghost y")
    expect(r.prompt).not.toContain("{image:5")
    expect(r.prompt).not.toContain("@image_5")
  })

  it("leading + 2 extras + referenceOrder: leading stays @image_1, assets renumber from offset+1", () => {
    // assets e1,e2 are @image_2,@image_3; reorder swaps them → e2 first.
    const r = resolveVideoReferenceCore({
      prompt: "scene {image:2:first} and {image:3:second}",
      wiredCharRefs: [],
      leadingRefUrls: [A],
      extraRefs: [
        { url: E1, description: "first" },
        { url: E2, description: "second" },
      ],
      referenceOrder: [`wired:${E2}`, `wired:${E1}`], // manual-extra tile-id = `wired:<id>`
    })
    // leading ref stays first; the two assets are swapped by the reorder
    expect(r.additionalUrls[0]).toBe(A)
    expect(r.additionalUrls.slice(1)).toEqual([E2, E1])
    // leading ordinal 1 is never remapped; the asset ordinals stay within 2..3
    expect(r.prompt).not.toMatch(/@image_(0|4|5)\b/)
  })

  it("no leadingRefUrls → unchanged legacy numbering (asset from @image_1)", () => {
    const r = resolveVideoReferenceCore({
      prompt: "a {image:1:object}",
      wiredCharRefs: [],
      extraRefs: [{ url: E1, description: "object" }],
    })
    expect(r.additionalUrls).toEqual([E1])
    expect(r.prompt).toContain("the object from @image_1")
  })
})
