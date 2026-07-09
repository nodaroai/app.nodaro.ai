import { describe, it, expect } from "vitest"
import { buildRefPillNodes, nextMentionIndex } from "../build-ref-pill-nodes"
import type { SuggestionCommandPayload } from "../suggestion-list"

const base = { url: "u", label: "L", index: 2, defaultLabel: "" }
const item = (over: Partial<SuggestionCommandPayload>): SuggestionCommandPayload =>
  ({ ...base, source: "wired", ...over }) as SuggestionCommandPayload

describe("buildRefPillNodes", () => {
  it("image source → imageRef node with item.index + defaultLabel, trailing space by default", () => {
    expect(buildRefPillNodes(item({ source: "wired", defaultLabel: "object" }), 5)).toEqual([
      { type: "imageRef", attrs: { imageIndex: 2, label: "object" } },
      { type: "text", text: " " },
    ])
  })

  it("video / audio → videoRef / audioRef with item.index (NOT mentionIndex)", () => {
    expect(buildRefPillNodes(item({ source: "video" }), 5)[0]).toEqual({
      type: "videoRef", attrs: { refIndex: 2, label: "" },
    })
    expect(buildRefPillNodes(item({ source: "audio" }), 5)[0]).toEqual({
      type: "audioRef", attrs: { refIndex: 2, label: "" },
    })
  })

  it("character → characterRef using mentionIndex, variant → variantSlug, usageMode null", () => {
    expect(buildRefPillNodes(item({ source: "character", characterSlug: "kira", variantSlug: "smile" }), 7)[0])
      .toEqual({ type: "characterRef", attrs: { characterSlug: "kira", imageIndex: 7, variantSlug: "smile", usageMode: null } })
  })

  it("character role routes through roleToCharacterRefSlots (face → usageMode)", () => {
    expect(buildRefPillNodes(item({ source: "character", characterSlug: "kira", role: "face" }), 3)[0].attrs)
      .toMatchObject({ usageMode: "face", variantSlug: null })
  })

  it("location → locationRef using mentionIndex + bucket/variant", () => {
    expect(buildRefPillNodes(item({ source: "location", locationSlug: "lib", locationVariantBucket: "weather", locationVariantSlug: "rain" }), 4)[0])
      .toMatchObject({ type: "locationRef", attrs: { locationSlug: "lib", imageIndex: 4, bucket: "weather", variant: "rain" } })
  })

  it("location role routes through roleToLocationRefSlots and clears bucket/variant", () => {
    const attrs = buildRefPillNodes(item({ source: "location", locationSlug: "lib", role: "background" }), 4)[0].attrs
    expect(attrs).toMatchObject({ role: "background", bucket: null, variant: null })
  })

  it("location/character WITHOUT a slug falls through to imageRef", () => {
    expect(buildRefPillNodes(item({ source: "location" }), 4)[0].type).toBe("imageRef")
    expect(buildRefPillNodes(item({ source: "character" }), 4)[0].type).toBe("imageRef")
  })

  it("trailingSpace:false omits the trailing text node (for in-place swap)", () => {
    const nodes = buildRefPillNodes(item({ source: "wired" }), 5, { trailingSpace: false })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe("imageRef")
  })
})

describe("nextMentionIndex", () => {
  it("returns 1 for text with no mentions", () => {
    expect(nextMentionIndex("a plain prompt")).toBe(1)
    expect(nextMentionIndex("")).toBe(1)
  })
  it("returns max existing @slug:N + 1 across characters and locations", () => {
    expect(nextMentionIndex("@kira:1 near @oldlibrary:2:weather/rain")).toBe(3)
    expect(nextMentionIndex("@kira:1:face and @abi:5")).toBe(6)
  })
  it("ignores {image:N} tokens (only @<slug>:N counts)", () => {
    expect(nextMentionIndex("{image:9} and @kira:2")).toBe(3)
  })
})
