import { describe, it, expect } from "vitest"
import {
  capSelectedAssetByVariant,
  MAX_SELECTED_ASSET_KEYS,
  MAX_SELECTED_ASSET_VALUE_LEN,
} from "../selected-asset-by-variant.js"

describe("capSelectedAssetByVariant", () => {
  it("returns undefined for undefined (partial-update: leave the row untouched)", () => {
    expect(capSelectedAssetByVariant(undefined)).toBeUndefined()
  })

  it("keeps an explicit empty map (the studio clears selections by sending {})", () => {
    expect(capSelectedAssetByVariant({})).toEqual({})
  })

  it("passes keys through VERBATIM — never lowercases/trims the opaque studio id", () => {
    const map = {
      "bodyAngles:Front 3/4": "https://example.com/a.png",
      " expressions:Smile ": "https://example.com/b.png",
    }
    expect(capSelectedAssetByVariant(map)).toEqual(map)
  })

  it("caps to MAX_SELECTED_ASSET_KEYS, dropping overflow silently", () => {
    const map: Record<string, string> = {}
    for (let i = 0; i < MAX_SELECTED_ASSET_KEYS + 50; i++) {
      map[`angles:v${i}`] = `https://example.com/${i}.png`
    }
    const out = capSelectedAssetByVariant(map)
    expect(Object.keys(out as Record<string, string>)).toHaveLength(MAX_SELECTED_ASSET_KEYS)
  })

  it("drops entries whose value exceeds MAX_SELECTED_ASSET_VALUE_LEN", () => {
    const out = capSelectedAssetByVariant({
      "angles:ok": "https://example.com/ok.png",
      "angles:huge": "x".repeat(MAX_SELECTED_ASSET_VALUE_LEN + 1),
    })
    expect(out).toEqual({ "angles:ok": "https://example.com/ok.png" })
  })

  it("keeps a value exactly at the length limit", () => {
    const exact = "x".repeat(MAX_SELECTED_ASSET_VALUE_LEN)
    expect(capSelectedAssetByVariant({ "angles:edge": exact })).toEqual({ "angles:edge": exact })
  })
})
