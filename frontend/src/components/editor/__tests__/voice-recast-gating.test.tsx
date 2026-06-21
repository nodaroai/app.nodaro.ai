import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/edition", () => ({ hasCredits: () => false, isCloud: () => false }))

import { getNodeOptions } from "../add-node-popup"

describe("voice-recast discovery gating", () => {
  it("is hidden when the edition has no credits (community/business)", () => {
    const types = getNodeOptions().map((o) => o.type)
    expect(types).not.toContain("voice-recast")
  })
})
