/**
 * A use-case node's output length is its spec's `outputLength`
 * (packages/render-rules/src/use-case-specs.ts): a fixed length, after the
 * length of the input it names when that input is wired. video-output-length.ts
 * turns it into the node's rule, so the length rules name no use-case type.
 *
 * The rule is proven on a stand-in length; the descriptors are then held to
 * the rules table: a use-case type has a rule exactly when its spec declares
 * an output length.
 */
import { describe, expect, it } from "vitest"
import { USE_CASE_NODE_TYPES, usecaseDescriptor, type UseCaseOutputLength } from "@nodaro/render-rules"
import { VIDEO_OUTPUT_LENGTH_RULES, usecaseLength, type WireInput, type WireLength } from "../video-output-length.js"

const STAND_IN: UseCaseOutputLength = { fixedSec: 40, after: "introCard" }
const MEDIA: WireInput = { sourceId: "rec", handle: "media", kind: "video", length: { fixedSec: 0, perEpisodeSec: 1 } }
const card = (length: WireLength): WireInput => ({ sourceId: "card", handle: "introCard", kind: "video", length })

describe("usecaseLength: a fixed length, after the named input's", () => {
  it("is the fixed length with nothing wired on the named input", () => {
    expect(usecaseLength(STAND_IN, [MEDIA])).toEqual({ fixedSec: 40, perEpisodeSec: 0 })
    expect(usecaseLength(STAND_IN, [])).toEqual({ fixedSec: 40, perEpisodeSec: 0 })
  })

  it("adds a card of known fixed length", () => {
    expect(usecaseLength(STAND_IN, [MEDIA, card({ fixedSec: 10, perEpisodeSec: 0 })])).toEqual({ fixedSec: 50, perEpisodeSec: 0 })
  })

  it("keeps a card's per-episode length", () => {
    expect(usecaseLength(STAND_IN, [MEDIA, card({ fixedSec: 0, perEpisodeSec: 60 })])).toEqual({ fixedSec: 40, perEpisodeSec: 60 })
  })

  it("is unknown after a card whose length is unknown (unknown in, unknown out)", () => {
    expect(usecaseLength(STAND_IN, [MEDIA, card("unknown")])).toBe("unknown")
  })

  it("with no input named, reads no wire (not even one with no handle)", () => {
    const noHandle: WireInput = { sourceId: "x", handle: undefined, kind: "video", length: { fixedSec: 99, perEpisodeSec: 0 } }
    expect(usecaseLength({ fixedSec: 40 }, [MEDIA, noHandle, card("unknown")])).toEqual({ fixedSec: 40, perEpisodeSec: 0 })
  })
})

describe("the use-case length rules follow the specs", () => {
  it("some use-case type declares an output length (the checks below are never vacuous)", () => {
    expect(USE_CASE_NODE_TYPES.filter((t) => usecaseDescriptor(t).outputLength !== undefined).length).toBeGreaterThan(0)
  })

  it("a use-case type has a length rule exactly when its spec declares an output length", () => {
    for (const type of USE_CASE_NODE_TYPES) {
      expect(Object.hasOwn(VIDEO_OUTPUT_LENGTH_RULES, type), type).toBe(usecaseDescriptor(type).outputLength !== undefined)
    }
  })

  it("each such rule is the spec's length, read off its wires", () => {
    for (const type of USE_CASE_NODE_TYPES) {
      const len = usecaseDescriptor(type).outputLength
      if (!len) continue
      const inputs = [MEDIA, card({ fixedSec: 7, perEpisodeSec: 0 })]
      expect(VIDEO_OUTPUT_LENGTH_RULES[type]!.run!({ id: "n", type, data: {} }, inputs), type).toEqual(usecaseLength(len, inputs))
    }
  })
})
