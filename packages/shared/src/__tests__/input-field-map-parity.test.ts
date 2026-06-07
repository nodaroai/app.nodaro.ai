import { describe, it, expect } from "vitest"
import { INPUT_FIELD_MAP } from "../presentation-utils.js"
import { PARAMETER_NODE_TYPES, getParameterValue } from "../parameter-node-value.js"

/**
 * INVARIANT: every parameter-node type's INPUT_FIELD_MAP override field (`key`)
 * must be a field that getParameterValue() actually reads (its FIRST per-
 * dimension field for multi-dimension pickers). If the two drift, an app /
 * MCP / SDK input curated for that picker is SILENTLY DROPPED — the override
 * lands on a field nothing consumes. This test turns that drift into a red CI
 * build instead of a silent prod bug. (It caught: 29 missing picker entries +
 * 3 wrong keys — style-guide→text, duration→seconds, aspect-ratio→ratio.)
 */
describe("INPUT_FIELD_MAP ↔ getParameterValue parity", () => {
  const SENTINEL = "__parity_sentinel__"
  for (const type of PARAMETER_NODE_TYPES) {
    it(`"${type}" override field actually drives getParameterValue`, () => {
      const entry = INPUT_FIELD_MAP[type]
      expect(
        entry,
        `INPUT_FIELD_MAP is missing an entry for parameter node "${type}" — its curated app/MCP/SDK input would be dropped (fieldKey falls back to "value").`,
      ).toBeTruthy()
      const resolved = getParameterValue({ [entry!.key]: SENTINEL }, type)
      expect(
        resolved,
        `INPUT_FIELD_MAP["${type}"].key = "${entry!.key}" but getParameterValue("${type}") does not read that field — the override would be ignored.`,
      ).toBe(SENTINEL)
    })
  }
})
