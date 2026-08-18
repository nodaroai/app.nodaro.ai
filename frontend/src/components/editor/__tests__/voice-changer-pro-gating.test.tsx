import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/edition", () => ({ hasCredits: () => false, isCloud: () => false }))

import { getNodeOptions } from "../add-node-popup"

describe("voice-changer-pro discovery (4b: exclusive nodes surface on self-host)", () => {
  it("is LISTED when the edition has no credits — it runs through the nodaro.ai connection", () => {
    const types = getNodeOptions().map((o) => o.type)
    expect(types).toContain("voice-changer-pro")
  })
})
