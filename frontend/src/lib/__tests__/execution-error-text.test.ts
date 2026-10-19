// @test-units-by-name checks only the use-case node types' labels it reads
import { afterEach, describe, it, expect } from "vitest"
import { RUN_CONTINUATION_CODES, USE_CASE_NOTHING_KEPT, USE_CASE_NOTHING_KEPT_MESSAGE } from "@nodaro/shared/nodes"
import { UGC_PICK_FIRST_MESSAGE } from "@nodaro/shared/ugc"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { USE_CASE_NODE_TYPES, USE_CASE_REVIEW_LIST_DRIVEN, clipPackNoneRenderedMessage, USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE, usecaseCancelledMessage, usecaseDescriptor } from "@nodaro/render-rules"
import { localizeNodeLabel } from "@/lib/i18n/labels"
import { executionErrorText, nodeStateErrorText } from "../execution-error-text"

describe("executionErrorText", () => {
  afterEach(() => useLocaleStore.getState().setLocale("en"))

  it("shows the preview refusals' stable codes as their copy: with no kind recorded, the render's words as always", () => {
    expect(executionErrorText("preview_review_required")).toBe(
      "This workflow stops for a review: its render is set to Preview, and only a run started in the Nodaro editor or on an app's own page can stop for one. Open it there to run it, or set the render to Final (or send a Final quality override for it).",
    )
    expect(executionErrorText("preview_render_nested")).toBe(
      "This sub-workflow stops for a review (its render is set to Preview), and a nested workflow cannot. Set that render to Final.",
    )
  })

  it("a refusal held by a review-on Tighten Episode, or by both kinds, says so: its code carries it", () => {
    expect(executionErrorText("preview_review_required_review_on")).toBe(translate("en", "previewGate.headlessRefusalReview"))
    expect(executionErrorText("preview_review_required_mixed")).toBe(translate("en", "previewGate.headlessRefusal"))
    expect(executionErrorText("preview_render_nested_review_on")).toBe(translate("en", "previewGate.nestedRefusalReview"))
    expect(executionErrorText("preview_render_nested_mixed")).toBe(translate("en", "previewGate.nestedRefusal"))
    expect(executionErrorText("preview_review_required_review_on")).toMatch(/Review before render/)
    expect(executionErrorText("preview_review_required_review_on")).not.toMatch(/Final/)
  })

  it("an older row (the render's code): the render's words, as always", () => {
    expect(executionErrorText("preview_review_required")).toBe(translate("en", "previewGate.headlessRefusalRender"))
    expect(executionErrorText("preview_render_nested")).toBe(translate("en", "previewGate.nestedRefusalRender"))
  })

  it("shows every continued-run refusal's stable code as its copy", () => {
    for (const code of RUN_CONTINUATION_CODES) {
      const text = executionErrorText(code)
      expect(text, code).not.toBe(code)
      expect(text, code).toMatch(/run/)
    }
    expect(executionErrorText("continuation_version_mismatch")).toMatch(/another version of this workflow/)
  })

  it("a clip set's Render final with every clip dropped reads as its copy, the server's words in English", () => {
    expect(translate("en", "runContinuation.nothingKept")).toBe(USE_CASE_NOTHING_KEPT_MESSAGE)
    expect(executionErrorText(USE_CASE_NOTHING_KEPT)).toBe(USE_CASE_NOTHING_KEPT_MESSAGE)
    useLocaleStore.getState().setLocale("he")
    expect(executionErrorText(USE_CASE_NOTHING_KEPT)).toBe(translate("he", "runContinuation.nothingKept"))
    expect(executionErrorText(USE_CASE_NOTHING_KEPT)).not.toBe(USE_CASE_NOTHING_KEPT_MESSAGE)
  })

  it("a clip set none of whose clips rendered: the count and the render's reason, in the reader's language (a known reason localized too)", () => {
    const many = clipPackNoneRenderedMessage(3, "Speaker View could not read the recording")
    expect(executionErrorText(many)).toBe(many)
    expect(translate("en", "nodeRun.clipPackNoneRendered", { count: 3, reason: "x" })).toBe(clipPackNoneRenderedMessage(3, "x"))
    expect(translate("en", "nodeRun.clipPackOneNotRendered", { reason: "x" })).toBe(clipPackNoneRenderedMessage(1, "x"))
    useLocaleStore.getState().setLocale("he")
    expect(executionErrorText(many)).toBe(translate("he", "nodeRun.clipPackNoneRendered", { count: 3, reason: "Speaker View could not read the recording" }))
    // A reason that is itself a known code reads in the reader's language.
    expect(executionErrorText(clipPackNoneRenderedMessage(1, "continuation_not_found"))).toBe(
      translate("he", "nodeRun.clipPackOneNotRendered", { reason: translate("he", "runContinuation.notFound") }),
    )
  })

  it("shows the server's refusal of a run with a UGC Creator still to pick as the editor's own words", () => {
    expect(executionErrorText(UGC_PICK_FIRST_MESSAGE)).toBe(UGC_PICK_FIRST_MESSAGE)
    useLocaleStore.getState().setLocale("he")
    expect(executionErrorText(UGC_PICK_FIRST_MESSAGE)).toBe(translate("he", "run.ugcPickFirst"))
  })

  it("a review-on Tighten Episode refused for running once per list item reads in the reader's language — its code, its sentence, and as the failed node of a run", () => {
    expect(translate("en", "nodeRun.tightenReviewListDriven")).toBe(USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE)
    useLocaleStore.getState().setLocale("he")
    const he = translate("he", "nodeRun.tightenReviewListDriven")
    expect(he).not.toBe(USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE)
    expect(executionErrorText(USE_CASE_REVIEW_LIST_DRIVEN)).toBe(he)
    expect(executionErrorText(USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE)).toBe(he)
    // The engine's words for a run its node stopped (orchestrator-worker.ts): that node's part, localized.
    expect(executionErrorText(`Node execution failed: t1: ${USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE}; img: boom`)).toBe(`Node execution failed: t1: ${he}; img: boom`)
  })

  it("a use-case node whose engine run was cancelled reads in the reader's language, naming ITS type (each type's own sentence)", () => {
    for (const type of USE_CASE_NODE_TYPES) {
      const label = usecaseDescriptor(type).label
      // The editor's English is the engine's, word for word.
      expect(translate("en", "nodeRun.usecaseCancelled", { label })).toBe(usecaseCancelledMessage(label))
      useLocaleStore.getState().setLocale("he")
      const he = translate("he", "nodeRun.usecaseCancelled", { label: localizeNodeLabel(label, "he") })
      expect(executionErrorText(usecaseCancelledMessage(label))).toBe(he)
      expect(nodeStateErrorText({ error: usecaseCancelledMessage(label) }, type)).toBe(he)
      useLocaleStore.getState().setLocale("en")
    }
    // Any other node state's error passes through as sent.
    expect(nodeStateErrorText({ error: "Trailer was cancelled by a friend" }, "episode-trailer")).toBe("Trailer was cancelled by a friend")
  })

  it("passes any other message through, and nothing as null", () => {
    expect(executionErrorText("Node execution failed: x")).toBe("Node execution failed: x")
    expect(executionErrorText(null)).toBeNull()
    expect(executionErrorText("")).toBeNull()
  })
})
