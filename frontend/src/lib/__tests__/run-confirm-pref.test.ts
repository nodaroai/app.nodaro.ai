import { describe, it, expect, beforeEach } from "vitest"
import { shouldConfirmDiscard, suppressDiscardConfirm } from "../run-confirm-pref"
beforeEach(() => localStorage.clear())
describe("run-confirm-pref", () => {
  it("confirms by default, then suppresses after opt-out", () => {
    expect(shouldConfirmDiscard()).toBe(true)
    suppressDiscardConfirm()
    expect(shouldConfirmDiscard()).toBe(false)
  })
})
