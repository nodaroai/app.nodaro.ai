import { describe, it, expect } from "vitest"
import { classifySocialConnectMessage } from "../social-connect-message"

const ORIGIN = "https://app.example.test"
const popup = { name: "the pop-up" }
const context = { popup, expectedOrigin: ORIGIN, platform: "facebook" }
/** The pop-up's own message, on the expected origin. */
const fromPopup = (data: unknown) => classifySocialConnectMessage({ data, origin: ORIGIN, source: popup }, context)

describe("classifySocialConnectMessage", () => {
  // The wire shapes the backend's callback pages post, spelled out so a rename
  // on either side shows here.
  it("reads the pop-up's success for this network", () => {
    expect(fromPopup({ type: "social-auth-success", platform: "facebook" })).toEqual({ kind: "connected" })
  })

  it("reads the pop-up's failure, with its text when it has one", () => {
    expect(fromPopup({ type: "social-auth-error", message: "No Facebook pages found." })).toEqual({
      kind: "failed",
      message: "No Facebook pages found.",
    })
    expect(fromPopup({ type: "social-auth-error" })).toEqual({ kind: "failed", message: null })
    expect(fromPopup({ type: "social-auth-error", message: "  " })).toEqual({ kind: "failed", message: null })
    expect(fromPopup({ type: "social-auth-error", message: { text: "x" } })).toEqual({ kind: "failed", message: null })
  })

  it("ignores another network's success, an unknown type and data that is not an object", () => {
    expect(fromPopup({ type: "social-auth-success", platform: "instagram" })).toEqual({ kind: "ignore" })
    expect(fromPopup({ type: "social-auth-success" })).toEqual({ kind: "ignore" })
    expect(fromPopup({ type: "social-auth-done", platform: "facebook" })).toEqual({ kind: "ignore" })
    expect(fromPopup(["social-auth-success", "facebook"])).toEqual({ kind: "ignore" })
    expect(fromPopup("social-auth-success")).toEqual({ kind: "ignore" })
    expect(fromPopup(null)).toEqual({ kind: "ignore" })
  })

  it("ignores a well-formed result from another origin or another window", () => {
    const success = { type: "social-auth-success", platform: "facebook" }
    expect(classifySocialConnectMessage({ data: success, origin: "https://attacker.example", source: popup }, context)).toEqual({
      kind: "ignore",
    })
    expect(classifySocialConnectMessage({ data: success, origin: ORIGIN, source: { name: "another window" } }, context)).toEqual({
      kind: "ignore",
    })
  })

  it("ignores everything while no pop-up is open (it was blocked)", () => {
    const success = { type: "social-auth-success", platform: "facebook" }
    expect(classifySocialConnectMessage({ data: success, origin: ORIGIN, source: null }, { ...context, popup: null })).toEqual({
      kind: "ignore",
    })
  })
})
