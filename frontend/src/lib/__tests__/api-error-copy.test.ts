import { describe, it, expect, afterEach } from "vitest"
import { apiErrorMessage, apiErrorReasonKey, refusalMessage } from "../api-error-copy"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"

afterEach(() => useLocaleStore.setState({ locale: "en" }))

describe("apiErrorReasonKey", () => {
  it("maps a fixed-meaning code and leaves a case-by-case one alone", () => {
    expect(apiErrorReasonKey("not_found")).toBe("apiErr.reason.notFound")
    expect(apiErrorReasonKey("delete_failed")).toBe("apiErr.reason.server")
    // The credit guard's 403 for a model an admin switched off — its own
    // sentence, never the buy-credits dialog a 402 would open.
    expect(apiErrorReasonKey("model_disabled")).toBe("apiErr.reason.modelDisabled")
    // The credit guard's door for a model the deployment does not offer (a
    // switched-off model included) — its own sentence in every language.
    expect(apiErrorReasonKey("model_not_available")).toBe("apiErr.reason.modelNotAvailable")
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

  it("maps the admin expunge's two internal failures", () => {
    expect(apiErrorReasonKey("targets_failed")).toBe("apiErr.reason.server")
    expect(apiErrorReasonKey("linked_redact_failed")).toBe("apiErr.reason.server")
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

  it("an app whose UGC Creator needs a photo the run was not given: the server's words in English, a translated reason elsewhere", () => {
    const serverMessage = "This app needs a photo of you. Add one, then run it again."
    expect(apiErrorMessage({ code: "ugc_photo_required", serverMessage, fallbackKey: "apiErr.runApp" })).toBe(serverMessage)
    expect(translate("en", "apiErr.reason.ugcPhotoRequired")).toBe(serverMessage)
    for (const locale of ["he", "ja", "ko", "pt-BR"] as const) {
      useLocaleStore.setState({ locale })
      const reason = translate(locale, "apiErr.reason.ugcPhotoRequired")
      expect(reason, locale).not.toBe(serverMessage)
      expect(apiErrorMessage({ code: "ugc_photo_required", serverMessage, fallbackKey: "apiErr.runApp" })).toBe(
        translate(locale, "apiErr.withReason", { context: translate(locale, "apiErr.runApp"), reason }),
      )
      // A share link's viewer is refused with the same code: the same translated reason.
      expect(apiErrorMessage({ code: "ugc_photo_required", serverMessage, fallbackKey: "apiErr.runSharedWorkflow" })).toBe(
        translate(locale, "apiErr.withReason", { context: translate(locale, "apiErr.runSharedWorkflow"), reason }),
      )
    }
  })

  it("an app run refused for a cloned voice (decided 2026-11-13): the server's words in English, a translated reason elsewhere", () => {
    // The server's English for the codes of a fixed sentence (backend lib/clone-app-run.ts).
    const SERVER: Record<string, string> = {
      clone_recordings_required: "This app speaks in your own voice: add your two recordings (a reference and the consent recording) and tick the consent box, then run it again.",
      clone_consent_required: "Tick the consent box for your recordings yourself, then run it again: a cloned voice runs only on the consent of the person running the app.",
      clone_not_fillable: "This app clones a voice inside a sub-workflow or a component, where your recordings can't reach it, so it can't be run.",
    }
    const KEYS = {
      clone_recordings_required: "apiErr.reason.cloneRecordingsRequired",
      clone_consent_required: "apiErr.reason.cloneConsentRequired",
      clone_not_fillable: "apiErr.reason.cloneNotFillable",
      // The model the run dispatches does not clone (an exposed Model card): the server's message names the model.
      clone_model_unsupported: "apiErr.reason.cloneModelUnsupported",
      // The recordings themselves: the server's message names the recording and the limit, the reason does not.
      replica_unreachable: "apiErr.reason.replicaUnreachable",
      replica_too_large: "apiErr.reason.replicaTooLarge",
      replica_not_wav: "apiErr.reason.replicaNotWav",
      replica_length: "apiErr.reason.replicaLength",
      replica_link_refused: "apiErr.reason.replicaLinkRefused",
    } as const
    for (const [code, key] of Object.entries(KEYS)) expect(apiErrorReasonKey(code), code).toBe(key)
    for (const [code, message] of Object.entries(SERVER)) {
      expect(translate("en", KEYS[code as keyof typeof KEYS]), code).toBe(message)
      expect(apiErrorMessage({ code, serverMessage: message, fallbackKey: "apiErr.runApp" })).toBe(message)
    }
    for (const locale of ["he", "ja", "ko", "pt-BR"] as const) {
      useLocaleStore.setState({ locale })
      for (const [code, key] of Object.entries(KEYS)) {
        const reason = translate(locale, key)
        expect(reason, `${locale} ${code}`).not.toBe(translate("en", key))
        const serverMessage = SERVER[code] ?? "Consent recording must be a WAV file (24 kHz, mono, 16-bit is best)"
        expect(apiErrorMessage({ code, serverMessage, fallbackKey: "apiErr.runApp" })).toBe(
          translate(locale, "apiErr.withReason", { context: translate(locale, "apiErr.runApp"), reason }),
        )
        // A share link's viewer is refused with the same codes.
        expect(apiErrorMessage({ code, serverMessage, fallbackKey: "apiErr.runSharedWorkflow" })).toBe(
          translate(locale, "apiErr.withReason", { context: translate(locale, "apiErr.runSharedWorkflow"), reason }),
        )
      }
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

// A balance refusal of a run that can hold more than the balance (a metered LLM
// call's hold, Task 13): "Needs up to N credits", N raw credits, `required` beside it.
describe("apiErrorMessage — Needs up to N credits", () => {
  const refusal = { code: "insufficient_credits", serverMessage: "Needs up to 368 credits", fallbackKey: "apiErr.generateText", required: 368 } as const

  it("English keeps the server's words on a deployment showing credits", () => {
    expect(apiErrorMessage(refusal)).toBe("Needs up to 368 credits")
  })

  it("another language says it in its own words, with the figure and the display unit", () => {
    useLocaleStore.setState({ locale: "he" })
    const message = apiErrorMessage(refusal)
    expect(message).toContain("368")
    expect(message).toContain(translate("he", "apiErr.reason.needsUpTo", { n: 368, u: translate("he", "credits.unitShort") }))
    expect(message).not.toContain(translate("he", "apiErr.reason.insufficientCredits"))
  })

  it("any other insufficient-credits message keeps its usual reason", () => {
    useLocaleStore.setState({ locale: "he" })
    const message = apiErrorMessage({ ...refusal, serverMessage: "Insufficient credits" })
    expect(message).toContain(translate("he", "apiErr.reason.insufficientCredits"))
  })
})
