/**
 * A shared prompt as a person reads it (lib/share-links/display-prompt.ts):
 * each reference token becomes the name on its pill, from the references'
 * names only, else the slug made readable; editor tokens become their label;
 * a prompt with no token is unchanged.
 */
import { describe, it, expect } from "vitest"
import { displayPromptOf, humanizeSlug } from "../display-prompt.js"

const UUID = "3f2b8a4c-1d2e-4f5a-8b6c-7d8e9f0a1b2c"

const input = {
  connectedReferences: [
    { id: "c1", defaultName: "Maya", source: "wired-character", characterSlug: "maya", url: "https://cdn.example/uploads/maya.png" },
    { id: "r2", defaultName: "Old Library", source: "wired-location", locationSlug: "oldlibrary", url: "https://cdn.example/uploads/lib.png" },
    { id: "r3", defaultName: "Image 1", source: "manual", url: "https://cdn.example/uploads/img1.png" },
  ],
}

describe("displayPromptOf", () => {
  it("names each @ token by its reference's pill name", () => {
    expect(displayPromptOf("@maya:1 walks into @oldlibrary:2", input)).toBe("@Maya walks into @Old Library")
    expect(displayPromptOf("@image-1:3 Viral entrepreneurial transformation", input)).toBe("@Image 1 Viral entrepreneurial transformation")
  })

  it("drops a token's role, variant, mode and lock along with it", () => {
    expect(displayPromptOf("@image-1:3:background, @maya:1:smile:face~lock and @oldlibrary:2:weather/rain:style.", input)).toBe(
      "@Image 1, @Maya and @Old Library.",
    )
    expect(displayPromptOf("@maya:1~nolock", input)).toBe("@Maya")
  })

  it("with no reference of that name, makes the slug readable", () => {
    expect(displayPromptOf("@image-2:2 and @kira:1", input)).toBe("@Image 2 and @Kira")
    expect(displayPromptOf("@old-red-car:1", {})).toBe("@Old Red Car")
    expect(humanizeSlug("image-1")).toBe("Image 1")
    expect(humanizeSlug("maya")).toBe("Maya")
  })

  it("of two references with one name, takes the Nth when it is one of them, else the first", () => {
    const twins = { connectedReferences: [{ defaultName: "Hero" }, { defaultName: "hero" }, { defaultName: "Other" }] }
    expect(displayPromptOf("@hero:2", twins)).toBe("@hero")
    expect(displayPromptOf("@hero:3", twins)).toBe("@Hero")
  })

  it("names a described reference too", () => {
    expect(displayPromptOf("@vintage-car:1 on a road", { describedReferences: [{ name: "Vintage car", description: "a 1960s sedan" }] })).toBe(
      "@Vintage car on a road",
    )
  })

  it("turns editor tokens into their label, and a bare one into its kind and number", () => {
    expect(displayPromptOf("cut {video:1:clip} over {audio:2:music} with {image:3:relic}", {})).toBe("cut @clip over @music with @relic")
    expect(displayPromptOf("{video:2} then {AUDIO:1}", {})).toBe("@Video 2 then @Audio 1")
  })

  it("names a {ref:id} token by its reference, never showing the id", () => {
    expect(displayPromptOf("a portrait of {ref:c1:face}", input)).toBe("a portrait of @Maya")
    expect(displayPromptOf(`a portrait of {ref:${UUID}}`, input)).toBe("a portrait of @reference")
  })

  it("never puts a reference's address or id in, only its name", () => {
    const sly = { connectedReferences: [{ id: UUID, defaultName: "https://cdn.example/secret.png", url: "https://cdn.example/secret.png" }] }
    const shown = displayPromptOf("@https-cdn-example-com-secret-png:1 and {ref:" + UUID + "}", sly)!
    expect(shown).not.toContain("cdn.example")
    expect(shown).not.toContain(UUID)
  })

  it("leaves a prompt with no token unchanged, an email, and a token of another shape", () => {
    const plain = "a red car on a beach at sunset, 35mm, f/1.8 — 50% off @ the shop"
    expect(displayPromptOf(plain, input)).toBe(plain)
    expect(displayPromptOf("write to me@studio.io:2 today", input)).toBe("write to me@studio.io:2 today")
    expect(displayPromptOf("@Maya and @maya", input)).toBe("@Maya and @maya")
  })

  it("answers null for no prompt", () => {
    expect(displayPromptOf(null, input)).toBeNull()
  })
})
