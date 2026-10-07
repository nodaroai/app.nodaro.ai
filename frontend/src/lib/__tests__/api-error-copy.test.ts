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

  it("maps the competitor refusals, but not the one that names the accounts", () => {
    expect(apiErrorReasonKey("scan_running")).toBe("apiErr.reason.scanRunning")
    expect(apiErrorReasonKey("already_tracked")).toBe("apiErr.reason.alreadyTracked")
    expect(apiErrorReasonKey("too_many_competitors")).toBe("apiErr.reason.tooManyBrands")
    expect(apiErrorReasonKey("nothing_to_scan")).toBe("apiErr.reason.nothingToScan")
    expect(apiErrorReasonKey("not_reachable")).toBe("apiErr.reason.siteNotReachable")
    expect(apiErrorReasonKey("invalid_account")).toBeUndefined()
    expect(apiErrorReasonKey("card_not_found")).toBe("apiErr.reason.cardGone")
    expect(apiErrorReasonKey("not_measurable")).toBe("apiErr.reason.notMeasurable")
    expect(apiErrorReasonKey("too_many_actions")).toBe("apiErr.reason.tooManyMarks")
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

  // Round 4 (decided 2026-10-06): POST /v1/edit-plan refuses an unknown or
  // undeclared mode as `mode_not_available`, in the server's English words.
  it("an Edit Plan mode refusal: the server's words in English, a translated reason elsewhere", () => {
    const serverMessage = "Trailer mode is not available on this server yet. Choose another mode, or try again after the next update. You were not charged."
    expect(apiErrorMessage({ code: "mode_not_available", serverMessage, fallbackKey: "apiErr.startEditPlan" })).toBe(serverMessage)
    for (const locale of ["he", "ja", "ko", "pt-BR"] as const) {
      useLocaleStore.setState({ locale })
      const reason = translate(locale, "apiErr.reason.editPlanModeUnavailable")
      expect(reason, locale).not.toBe(translate("en", "apiErr.reason.editPlanModeUnavailable"))
      expect(apiErrorMessage({ code: "mode_not_available", serverMessage, fallbackKey: "apiErr.startEditPlan" })).toBe(
        translate(locale, "apiErr.withReason", { context: translate(locale, "apiErr.startEditPlan"), reason }),
      )
    }
  })

  // Decided 2026-10-06: a run's permanent delete waits until the run settles,
  // and the archive page shows why (409 `run_in_progress`).
  it("a run still in progress: the server's words in English, a translated reason elsewhere", () => {
    const serverMessage = "This run is still running. Stop it or wait for it to finish, then delete it."
    expect(apiErrorMessage({ code: "run_in_progress", serverMessage, fallbackKey: "apiErr.permanentlyDeleteRun" })).toBe(serverMessage)
    expect(translate("en", "apiErr.reason.runInProgress")).toBe(serverMessage)
    for (const locale of ["he", "ja", "ko", "pt-BR"] as const) {
      useLocaleStore.setState({ locale })
      const reason = translate(locale, "apiErr.reason.runInProgress")
      expect(reason, locale).not.toBe(serverMessage)
      expect(apiErrorMessage({ code: "run_in_progress", serverMessage, fallbackKey: "apiErr.permanentlyDeleteRun" })).toBe(
        translate(locale, "apiErr.withReason", { context: translate(locale, "apiErr.permanentlyDeleteRun"), reason }),
      )
    }
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
