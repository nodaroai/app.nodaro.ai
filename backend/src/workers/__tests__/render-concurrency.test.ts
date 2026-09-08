import { describe, expect, it } from "vitest"
import { remotionConcurrencyFor } from "../render-concurrency.js"

describe("render concurrency", () => {
  it.each([null, undefined])("bounds WebGL scene tabs when no override is configured (%s)", configured => {
    expect(remotionConcurrencyFor("3d-scene", configured)).toBe(2)
  })
  it.each(["after-effects", "scene-graph", "3d-title", "shot-sequence", "burn-captions"])("preserves the automatic default for %s", composition => {
    expect(remotionConcurrencyFor(composition, null)).toBeUndefined()
  })
  it.each([1, 4, 32])("honors an operator's explicit concurrency %s", configured => {
    expect(remotionConcurrencyFor("3d-scene", configured)).toBe(configured)
    expect(remotionConcurrencyFor("after-effects", configured)).toBe(configured)
  })
})
