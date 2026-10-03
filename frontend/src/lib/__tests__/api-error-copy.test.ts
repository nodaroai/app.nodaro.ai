import { describe, it, expect, afterEach } from "vitest"
import { apiErrorMessage, apiErrorReasonKey, refusalMessage } from "../api-error-copy"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"

afterEach(() => useLocaleStore.setState({ locale: "en" }))

describe("apiErrorReasonKey", () => {
  it("maps a fixed-meaning code and leaves a case-by-case one alone", () => {
    expect(apiErrorReasonKey("not_found")).toBe("apiErr.reason.notFound")
    expect(apiErrorReasonKey("delete_failed")).toBe("apiErr.reason.server")
    expect(apiErrorReasonKey("validation_error")).toBeUndefined()
    expect(apiErrorReasonKey("bad_request")).toBeUndefined()
    expect(apiErrorReasonKey(undefined)).toBeUndefined()
  })

  it("does not read inherited object keys as codes", () => {
    expect(apiErrorReasonKey("constructor")).toBeUndefined()
    expect(apiErrorReasonKey("toString")).toBeUndefined()
  })
})

describe("apiErrorMessage", () => {
  it("keeps English exactly as before: the server's words, else the headline", () => {
    expect(apiErrorMessage({ code: "not_found", serverMessage: "App not found", fallbackKey: "apiErr.loadApp" })).toBe("App not found")
    expect(apiErrorMessage({ fallbackKey: "apiErr.loadApp" })).toBe(translate("en", "apiErr.loadApp"))
  })

  it("in Japanese, joins the headline and the translated reason", () => {
    useLocaleStore.setState({ locale: "ja" })
    const context = translate("ja", "apiErr.loadApp")
    expect(apiErrorMessage({ code: "unauthorized", serverMessage: "Authentication required", fallbackKey: "apiErr.loadApp" })).toBe(
      translate("ja", "apiErr.withReason", { context, reason: translate("ja", "apiErr.reason.signIn") }),
    )
  })

  it("hides raw internal text behind the server reason", () => {
    useLocaleStore.setState({ locale: "he" })
    const message = apiErrorMessage({ code: "delete_failed", serverMessage: 'duplicate key value violates unique constraint "x"', fallbackKey: "apiErr.deleteFolder" })
    expect(message).not.toContain("duplicate key")
    expect(message).toContain(translate("he", "apiErr.reason.server"))
  })
})

describe("refusalMessage", () => {
  it("is the server's words in English and the dictionary's elsewhere", () => {
    expect(refusalMessage("A character named Maya exists", "apiErr.nameTaken")).toBe("A character named Maya exists")
    expect(refusalMessage(undefined, "apiErr.nameTaken")).toBe(translate("en", "apiErr.nameTaken"))
    useLocaleStore.setState({ locale: "he" })
    expect(refusalMessage("A character named Maya exists", "apiErr.nameTaken")).toBe(translate("he", "apiErr.nameTaken"))
  })
})

describe("a stub locale", () => {
  it("keeps the server's words, like English, while it has no text of its own", () => {
    useLocaleStore.setState({ locale: "de" })
    expect(apiErrorMessage({ code: "not_found", serverMessage: "App not found", fallbackKey: "apiErr.loadApp" })).toBe("App not found")
    expect(refusalMessage("A character named Maya exists", "apiErr.nameTaken")).toBe("A character named Maya exists")
  })
})
