import { describe, expect, it } from "vitest"
import {
  aggregateByType,
  presentTypes,
  groupHandleId,
  parseGroupHandle,
  isAggregateableType,
  AGGREGATEABLE_TYPES,
  type Member,
} from "../group-aggregation.js"

describe("aggregateByType", () => {
  it("returns all-empty buckets for empty input", () => {
    expect(aggregateByType([])).toEqual({ text: [], image: [], video: [], audio: [] })
  })

  it("buckets by type preserving input order", () => {
    const members: Member[] = [
      { nodeId: "a", type: "text", value: "hello" },
      { nodeId: "b", type: "image", value: "https://r2/img1.png" },
      { nodeId: "c", type: "text", value: "world" },
    ]
    expect(aggregateByType(members)).toEqual({
      text: ["hello", "world"],
      image: ["https://r2/img1.png"],
      video: [],
      audio: [],
    })
  })

  it("preserves order across all four types", () => {
    const members: Member[] = [
      { nodeId: "v", type: "video", value: "v1" },
      { nodeId: "a", type: "audio", value: "a1" },
      { nodeId: "t", type: "text", value: "t1" },
      { nodeId: "i", type: "image", value: "i1" },
    ]
    const result = aggregateByType(members)
    expect(result).toEqual({ text: ["t1"], image: ["i1"], video: ["v1"], audio: ["a1"] })
  })
})

describe("presentTypes", () => {
  it("returns only types with at least one item", () => {
    expect(
      presentTypes({ text: ["a"], image: [], video: ["b", "c"], audio: [] }),
    ).toEqual(["text", "video"])
  })

  it("returns empty array when all buckets empty", () => {
    expect(presentTypes({ text: [], image: [], video: [], audio: [] })).toEqual([])
  })

  it("returns all four when all populated", () => {
    expect(
      presentTypes({ text: ["t"], image: ["i"], video: ["v"], audio: ["a"] }),
    ).toEqual(["text", "image", "video", "audio"])
  })
})

describe("groupHandleId / parseGroupHandle", () => {
  it("round-trips all four types", () => {
    for (const t of AGGREGATEABLE_TYPES) {
      expect(parseGroupHandle(groupHandleId(t))).toBe(t)
    }
  })
  it("parseGroupHandle returns undefined for non-handle strings", () => {
    expect(parseGroupHandle("in")).toBeUndefined()
    expect(parseGroupHandle("out-bogus")).toBeUndefined()
    expect(parseGroupHandle(null)).toBeUndefined()
    expect(parseGroupHandle(undefined)).toBeUndefined()
  })
})

describe("isAggregateableType", () => {
  it("returns true for the four aggregateable types", () => {
    for (const t of AGGREGATEABLE_TYPES) expect(isAggregateableType(t)).toBe(true)
  })
  it("returns false for 'data' or undefined", () => {
    expect(isAggregateableType("data")).toBe(false)
    expect(isAggregateableType(undefined)).toBe(false)
  })
})
