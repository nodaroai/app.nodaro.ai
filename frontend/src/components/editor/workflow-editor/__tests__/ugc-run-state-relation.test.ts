import { UGC_NODE_RUN_STATE_KEYS, UGC_NODE_TYPES } from "@nodaro/shared"
import { describe, expect, it } from "vitest"
import { RUN_RESULT_TYPE_KEYS } from "../clear-run-results"

describe("the canvas clear keeps less than the publish strip, never more", () => {
  it.each([...UGC_NODE_TYPES])("%s: every key the canvas clears is stripped at publish", (type) => {
    for (const key of RUN_RESULT_TYPE_KEYS[type] ?? []) expect(UGC_NODE_RUN_STATE_KEYS[type], `${type}.${key}`).toContain(key)
  })
})
