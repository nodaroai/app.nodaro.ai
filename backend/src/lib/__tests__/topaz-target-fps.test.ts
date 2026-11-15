import { describe, expect, it } from "vitest"
import { topazTargetFpsOf } from "@nodaro/render-rules"

/**
 * A Topaz video upscale's `targetFps` as every run reads it — the workflow
 * run's payload, the editor's Run — and both quotes price it (decided
 * 2026-11-14): one reader, so a rate stored as text (a workflow written through
 * the API or MCP) is quoted at the rate the run renders, never at the 30 fps
 * an unset rate is quoted at.
 */
describe("topazTargetFpsOf", () => {
  it.each([
    [60, 60],
    [24, 24],
    ["60", 60],
    [" 50 ", 50],
    [29.97, 30],
    ["29.97", 30],
    [120, 60],
    ["7", 15],
  ])("reads %j as %s fps (a number or numeric text, clamped to 15–60)", (value, fps) => {
    expect(topazTargetFpsOf(value)).toBe(fps)
  })

  it.each([undefined, null, "", "  ", "source", "abc", Number.NaN, Number.POSITIVE_INFINITY, {}, true])(
    "reads %j as the source's own rate (undefined)",
    (value) => {
      expect(topazTargetFpsOf(value)).toBeUndefined()
    },
  )
})
