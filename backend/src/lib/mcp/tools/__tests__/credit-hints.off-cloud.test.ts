import { describe, it, expect, vi } from "vitest"

// EDITION GATE (PR #1230): off-cloud there is no billing table to read — the
// community and business editions lack its supabase tables, and the first read
// crashes. Every hint answers the pointer `list_models` gives for `pricing`
// instead, and the lip-sync suffix answers nothing, so a description registers
// without touching `STATIC_CREDIT_COSTS`. The test env is the cloud edition;
// this file is the only place the off-cloud branch runs.
vi.mock("../../../../lib/config.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../../lib/config.js")>()
  return { ...mod, hasCredits: () => false }
})

import { creditHint, perSecondHint, lipSyncPriceSuffix } from "../_credit-hint.js"

describe("_credit-hint — off-cloud", () => {
  it("answers the list_models pointer instead of a number", () => {
    expect(creditHint("latentsync")).toBe("credits: see list_models")
    expect(perSecondHint("kling-avatar")).toBe("credits: see list_models")
  })

  it("adds no price suffix to a lip-sync model", () => {
    expect(lipSyncPriceSuffix("latentsync")).toBe("")
    expect(lipSyncPriceSuffix("kling-avatar")).toBe("")
  })
})
