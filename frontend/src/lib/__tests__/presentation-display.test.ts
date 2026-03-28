import { describe, it, expect } from "vitest"
import {
  ELEMENT_SIZES,
  isMediaColumn,
  colTypeToMimePrefix,
  resolveDisplay,
  responsiveColumns,
} from "@/lib/presentation-display"
import type { PresentationDisplay, LoopColumn } from "@/types/nodes"

describe("isMediaColumn", () => {
  it('returns true for "image-url"', () => {
    expect(isMediaColumn("image-url")).toBe(true)
  })

  it('returns true for "video-url"', () => {
    expect(isMediaColumn("video-url")).toBe(true)
  })

  it('returns true for "audio-url"', () => {
    expect(isMediaColumn("audio-url")).toBe(true)
  })

  it('returns false for "text"', () => {
    expect(isMediaColumn("text")).toBe(false)
  })

  it('returns false for "number"', () => {
    expect(isMediaColumn("number")).toBe(false)
  })

  it("returns false for empty string", () => {
    expect(isMediaColumn("")).toBe(false)
  })
})

describe("colTypeToMimePrefix", () => {
  it('maps "image-url" to "image/"', () => {
    expect(colTypeToMimePrefix("image-url")).toBe("image/")
  })

  it('maps "video-url" to "video/"', () => {
    expect(colTypeToMimePrefix("video-url")).toBe("video/")
  })

  it('maps "audio-url" to "audio/"', () => {
    expect(colTypeToMimePrefix("audio-url")).toBe("audio/")
  })

  it('maps "text" to "application/"', () => {
    expect(colTypeToMimePrefix("text")).toBe("application/")
  })

  it('maps "unknown" to "application/"', () => {
    expect(colTypeToMimePrefix("unknown")).toBe("application/")
  })
})

describe("ELEMENT_SIZES", () => {
  it("has 5 keys", () => {
    expect(Object.keys(ELEMENT_SIZES)).toHaveLength(5)
  })

  it("each entry has sm, md, lg", () => {
    for (const key of Object.keys(ELEMENT_SIZES) as (keyof typeof ELEMENT_SIZES)[]) {
      expect(ELEMENT_SIZES[key]).toHaveProperty("sm")
      expect(ELEMENT_SIZES[key]).toHaveProperty("md")
      expect(ELEMENT_SIZES[key]).toHaveProperty("lg")
    }
  })

  it("cardsImage.md is 128", () => {
    expect(ELEMENT_SIZES.cardsImage.md).toBe(128)
  })
})

describe("resolveDisplay", () => {
  it('defaults image to columns 2, elementSize "md", viewMode ""', () => {
    const result = resolveDisplay(undefined, undefined, "image")
    expect(result).toEqual({ columns: 2, elementSize: "md", viewMode: "", maxWidth: undefined, align: undefined })
  })

  it('defaults video to columns 1, elementSize "md", viewMode ""', () => {
    const result = resolveDisplay(undefined, undefined, "video")
    expect(result).toEqual({ columns: 1, elementSize: "md", viewMode: "", maxWidth: undefined, align: undefined })
  })

  it('defaults text to columns 1, elementSize "md", viewMode ""', () => {
    const result = resolveDisplay(undefined, undefined, "text")
    expect(result).toEqual({ columns: 1, elementSize: "md", viewMode: "", maxWidth: undefined, align: undefined })
  })

  it('defaults unknown outputType to columns 1, elementSize "md", viewMode ""', () => {
    const result = resolveDisplay(undefined, undefined, "unknown")
    expect(result).toEqual({ columns: 1, elementSize: "md", viewMode: "", maxWidth: undefined, align: undefined })
  })

  it("uses nodeDisplay columns when provided", () => {
    const nodeDisplay: PresentationDisplay = { columns: 3 }
    const result = resolveDisplay(nodeDisplay, undefined, "image")
    expect(result.columns).toBe(3)
    expect(result.elementSize).toBe("md")
    expect(result.viewMode).toBe("")
  })

  it("cardDisplay overrides nodeDisplay columns", () => {
    const nodeDisplay: PresentationDisplay = { columns: 3 }
    const cardDisplay: Partial<PresentationDisplay> = { columns: 4 }
    const result = resolveDisplay(nodeDisplay, cardDisplay, "image")
    expect(result.columns).toBe(4)
  })

  it("cardDisplay elementSize overrides default", () => {
    const cardDisplay: Partial<PresentationDisplay> = { elementSize: "lg" }
    const result = resolveDisplay(undefined, cardDisplay, "image")
    expect(result.elementSize).toBe("lg")
  })

  it('loop without loopColumns defaults viewMode to "table"', () => {
    const result = resolveDisplay(undefined, undefined, "loop")
    expect(result.viewMode).toBe("table")
  })

  it('loop with media loopColumns defaults viewMode to "cards"', () => {
    const loopColumns: LoopColumn[] = [{ id: "1", name: "img", type: "image-url", handleId: "h1" }]
    const result = resolveDisplay(undefined, undefined, "loop", loopColumns)
    expect(result.viewMode).toBe("cards")
  })

  it('loop with non-media loopColumns defaults viewMode to "table"', () => {
    const loopColumns: LoopColumn[] = [{ id: "1", name: "text", type: "text", handleId: "h1" }]
    const result = resolveDisplay(undefined, undefined, "loop", loopColumns)
    expect(result.viewMode).toBe("table")
  })

  it("passes through maxWidth and align from merged display", () => {
    const nodeDisplay: PresentationDisplay = { maxWidth: 80, align: "center" }
    const result = resolveDisplay(nodeDisplay, undefined, "image")
    expect(result.maxWidth).toBe(80)
    expect(result.align).toBe("center")
  })

  it("maxWidth and align are undefined when not set", () => {
    const result = resolveDisplay(undefined, undefined, "image")
    expect(result.maxWidth).toBeUndefined()
    expect(result.align).toBeUndefined()
  })
})

describe("responsiveColumns", () => {
  it("clamps 4 columns to 2 on mobile", () => {
    expect(responsiveColumns(4, true)).toBe(2)
  })

  it("keeps 1 column as 1 on mobile", () => {
    expect(responsiveColumns(1, true)).toBe(1)
  })

  it("keeps 2 columns as 2 on mobile", () => {
    expect(responsiveColumns(2, true)).toBe(2)
  })

  it("returns 4 columns as-is on desktop", () => {
    expect(responsiveColumns(4, false)).toBe(4)
  })

  it("returns 1 column as-is on desktop", () => {
    expect(responsiveColumns(1, false)).toBe(1)
  })
})
