import { describe, expect, it } from "vitest"
import {
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_NOT_FOUND,
  CONTINUATION_SUBSET_REQUIRED,
  CONTINUATION_VERSION_MISMATCH,
  CONTINUATION_WORKFLOW_MISMATCH,
  RUN_CONTINUATION_CODES,
} from "../index.js"

describe("run continuation refusal codes", () => {
  it("are the stable strings clients branch on", () => {
    expect(CONTINUATION_NOT_FOUND).toBe("continuation_not_found")
    expect(CONTINUATION_WORKFLOW_MISMATCH).toBe("continuation_workflow_mismatch")
    expect(CONTINUATION_VERSION_MISMATCH).toBe("continuation_version_mismatch")
    expect(CONTINUATION_NOT_COMPLETED).toBe("continuation_not_completed")
    expect(CONTINUATION_SUBSET_REQUIRED).toBe("continuation_subset_required")
  })

  it("lists every code once", () => {
    expect(new Set(RUN_CONTINUATION_CODES).size).toBe(5)
    expect([...RUN_CONTINUATION_CODES].sort()).toEqual(
      [
        CONTINUATION_NOT_COMPLETED,
        CONTINUATION_NOT_FOUND,
        CONTINUATION_SUBSET_REQUIRED,
        CONTINUATION_VERSION_MISMATCH,
        CONTINUATION_WORKFLOW_MISMATCH,
      ].sort(),
    )
  })
})
