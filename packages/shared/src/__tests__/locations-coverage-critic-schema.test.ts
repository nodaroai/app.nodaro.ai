import { describe, it, expect } from "vitest"
import {
  LocationsCoverageCriticIssueSchema,
  LocationsCoverageCriticVerdictSchema,
} from "../pipeline-types.js"

/**
 * Regression — Sonnet routinely emits `"location_key": null` for issues
 * like `redundant_location` that flag a structural problem without
 * pointing at a specific key. The schema used to be `.optional()` which
 * accepts `undefined` but NOT `null`, so those emits failed Zod
 * validation, exhausted the critic retry budget, and killed Stage 1
 * with `locations_coverage validation failed after 2 attempts:
 * issues.N.location_key: Expected string, received null`. Documented
 * in pipeline aa495c75 (2026-05-26).
 *
 * Fix: `.nullish()` (= `.optional().nullable()`) accepts undefined OR
 * null OR string. Mirrors the existing `scene_index` treatment.
 */
describe("LocationsCoverageCriticIssueSchema — null location_key tolerance", () => {
  it("accepts location_key: null on a structural issue", () => {
    const parsed = LocationsCoverageCriticIssueSchema.safeParse({
      severity: "warning",
      issue_type: "redundant_location",
      description: "Two locations describe the same desert exterior.",
      suggested_fix: "Merge into one location.",
      scene_index: null,
      location_key: null,
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts location_key: undefined (omitted)", () => {
    const parsed = LocationsCoverageCriticIssueSchema.safeParse({
      severity: "warning",
      issue_type: "redundant_location",
      description: "x",
      suggested_fix: "y",
      scene_index: null,
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts location_key: 'some-key' (the original happy path)", () => {
    const parsed = LocationsCoverageCriticIssueSchema.safeParse({
      severity: "blocking",
      issue_type: "orphan_location",
      description: "Scene 3 references desert_road but it's not in the roster.",
      suggested_fix: "Add desert_road to plan.locations.",
      scene_index: 3,
      location_key: "desert_road",
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts a full verdict with a mix of null + string + omitted location_key", () => {
    const parsed = LocationsCoverageCriticVerdictSchema.safeParse({
      verdict: "fail",
      issues: [
        {
          severity: "blocking",
          issue_type: "orphan_location",
          description: "x",
          suggested_fix: "y",
          scene_index: 1,
          location_key: "loc1",
        },
        {
          severity: "warning",
          issue_type: "redundant_location",
          description: "x",
          suggested_fix: "y",
          scene_index: null,
          location_key: null, // ← used to crash here
        },
        {
          severity: "warning",
          issue_type: "name_too_similar",
          description: "x",
          suggested_fix: "y",
          scene_index: null,
          // omitted location_key
        },
      ],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.issues).toHaveLength(3)
      expect(parsed.data.issues[1]?.location_key).toBeNull()
    }
  })
})
