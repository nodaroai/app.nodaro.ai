/**
 * The list operators consume the WHOLE list wired into them and are never run
 * once per item. Both engines' fan-out planners read `FAN_IN_TARGETS` first
 * (`isFanInNodeType` → no fan-out), so this table is the one rule.
 *
 * 2026-10-06: a Filter List fed by a Split Text (an "each" wire by default) was
 * fanned out 11 times by the orchestrator; every iteration collected the same
 * whole list and emitted its first match, so the stages after it ran 11 times
 * on one story.
 */
import { describe, it, expect } from "vitest"
import { FAN_IN_TARGETS, FAN_OUT_EACH_TYPES, isFanInEdge, isFanInNodeType } from "../producer-types.js"

const LIST_OPERATORS = ["filter-list", "deduplicate", "merge-lists", "sort-list", "selector"] as const

describe("list operators are fan-in targets", () => {
  for (const type of LIST_OPERATORS) {
    it(`${type} folds every wire — it is never fanned out`, () => {
      expect(isFanInNodeType(type)).toBe(true)
      expect(FAN_IN_TARGETS[type]).toBe("*")
      for (const handle of ["in", "variables", null, undefined]) {
        expect(isFanInEdge(type, handle)).toBe(true)
      }
    })
  }

  it("a list operator still fans its OWN output out per item downstream (an each source)", () => {
    // Being a fan-in TARGET says nothing about the wire that leaves the node:
    // Filter List → Generate Image still runs the image once per kept item.
    for (const type of ["filter-list", "deduplicate", "merge-lists", "sort-list", "selector"]) {
      expect(FAN_OUT_EACH_TYPES.has(type)).toBe(true)
    }
  })

  it("the text producers that feed them are not fan-in targets", () => {
    for (const type of ["split-text", "list", "llm-chat", "combine-text", "extract-field"]) {
      expect(isFanInNodeType(type)).toBe(false)
    }
  })
})
