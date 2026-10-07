import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useLocaleStore } from "@/lib/locale-store"
import { translate, type MessageKey } from "@/lib/i18n"
import type { LocaleId } from "@nodaro/shared"

/**
 * The admin expunge dialog says exactly what is erased and what is kept
 * (decided 2026-10-06): the runs' inputs, the linked executions' node states
 * and applied inputs, the linked jobs' inputs and outputs — and, kept, the
 * runners' own library uploads. In every one of the five full locales.
 */

vi.mock("@/lib/api", () => ({ expungeApp: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ExpungeModal } from "../expunge-modal"
import { expungeApp } from "@/lib/api"
import { toast } from "sonner"

const app = { id: "app-1", name: "Poster Maker", slug: "poster-maker" } as never

function renderIn(locale: LocaleId) {
  useLocaleStore.setState({ locale })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ExpungeModal app={app} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

const LIST_KEYS: MessageKey[] = [
  "adminExpunge.deletedApp",
  "adminExpunge.deletedBookmarks",
  "adminExpunge.deletedRuns",
  "adminExpunge.deletedExecutions",
  "adminExpunge.deletedJobs",
  "adminExpunge.deletedReports",
  "adminExpunge.deletedFiles",
  "adminExpunge.preservedEarnings",
  "adminExpunge.preservedRecords",
  "adminExpunge.preservedUploads",
  "adminExpunge.preservedAudit",
  // The two notes after the lists.
  "adminExpunge.preservedUntagged",
  "adminExpunge.inProgressNote",
]

beforeEach(() => useLocaleStore.setState({ locale: "en" }))

describe("ExpungeModal", () => {
  it("names, in English, every kind of content the expunge erases and keeps", () => {
    renderIn("en")
    const text = document.body.textContent ?? ""
    expect(text).toContain("Each run's inputs, edited results and run name")
    expect(text).toContain("node states")
    expect(text).toContain("the inputs it applied")
    expect(text).toContain("generation jobs")
    expect(text).toContain("outputs held for review")
    expect(text).toContain("raw provider errors")
    expect(text).toContain("input fingerprints")
    expect(text).toContain("Runners' own library uploads")
    expect(text).toContain("re-runs, Render finals and component runs")
    // Decided 2026-10-07: jobs' error messages, and each component run's own
    // run record, are erased; earlier executions from before runs were tagged
    // are not found, and the dialog says so.
    expect(text).toContain("error messages")
    expect(text).toContain("component run's own run record")
    // Decided 2026-10-07: the component run's record loses its inputs, edited
    // results and name (`appRunContentRedaction()` clears all three).
    expect(text).toContain("its inputs, edited results and name")
    expect(text).toContain("before runs were tagged")
    expect(text).toContain("their content stays")
    // Decided 2026-10-06: runs in flight are skipped, not a refusal.
    expect(text).toContain("still in progress")
    expect(text).toContain("are skipped")
    expect(text).toContain("expunge it again")
  })

  // Decided 2026-10-07: each execution's own error message is erased too —
  // the run-level failure line repeats a child job's message.
  it.each([
    ["en", "the inputs it applied and its error message"],
    ["he", "הודעת השגיאה שלהן"],
    ["ja", "実行のエラーメッセージ"],
    ["ko", "실행 오류 메시지"],
    ["pt-BR", "a mensagem de erro do processamento"],
  ] as Array<[LocaleId, string]>)("in %s, says each execution's error message is erased", (locale, phrase) => {
    renderIn(locale)
    expect(translate(locale, "adminExpunge.deletedExecutions")).toContain(phrase)
    expect(document.body.textContent).toContain(phrase)
  })

  // Decided 2026-10-07: the diagnostic reports filed for the runs' jobs and
  // executions lose their title and details; the report rows stay.
  it.each([
    ["en", "Diagnostic reports filed for these runs' executions and jobs: their titles and details"],
    ["he", "דוחות האבחון"],
    ["ja", "診断レポート"],
    ["ko", "진단 보고서"],
    ["pt-BR", "Os relatórios de diagnóstico"],
  ] as Array<[LocaleId, string]>)("in %s, lists the diagnostic reports' titles and details as erased, the rows kept", (locale, phrase) => {
    renderIn(locale)
    const own = translate(locale, "adminExpunge.deletedReports")
    expect(own).toContain(phrase)
    const heading = screen.getByText(translate(locale, "adminExpunge.deletedHeading"))
    expect(heading.parentElement!.querySelector("ul")!.textContent).toContain(own)
  })

  it.each(["en", "he", "ja", "ko", "pt-BR"] as LocaleId[])(
    "in %s, lists the untagged executions as a note, not as content kept for a legal or audit obligation",
    (locale) => {
      renderIn(locale)
      const heading = screen.getByText(translate(locale, "adminExpunge.preservedHeading"))
      const preservedList = heading.parentElement!.querySelector("ul")!
      const untagged = translate(locale, "adminExpunge.preservedUntagged")
      // Nothing ties those executions to the run (decided 2026-10-07); no
      // legal or audit obligation keeps them.
      expect(preservedList.textContent).not.toContain(untagged)
      expect(document.body.textContent).toContain(untagged)
    },
  )

  it("says how many runs were skipped, and that the MiniApp stays for another pass", async () => {
    vi.mocked(expungeApp).mockResolvedValue({
      success: true,
      expungedAt: "2026-10-07T00:00:00Z",
      r2KeysCollected: 4,
      r2KeysDeleted: 4,
      r2Errors: 0,
      executionsRedacted: 3,
      jobsRedacted: 9,
      innerRunsRedacted: 0,
      reportsRedacted: 0,
      runsErased: 5,
      runsSkipped: 2,
      runsBeforeRunTag: 0,
      appDeleted: false,
    })
    renderIn("en")
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "GDPR request from a user" } })
    fireEvent.change(document.getElementById("expunge-slug")!, { target: { value: "poster-maker" } })
    fireEvent.click(screen.getByRole("button", { name: "Permanently expunge" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const message = vi.mocked(toast.success).mock.calls[0]![0] as string
    expect(message).toBe(translate("en", "adminExpunge.partial", { erased: 5, skipped: 2, deleted: 4, errors: 0 }))
    expect(message).toContain("2")
    expect(message).toContain("again")
  })

  it("tells the admin how many erased runs started before runs were tagged", async () => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(expungeApp).mockResolvedValue({
      success: true,
      expungedAt: "2026-10-07T00:00:00Z",
      r2KeysCollected: 4,
      r2KeysDeleted: 4,
      r2Errors: 0,
      executionsRedacted: 3,
      jobsRedacted: 9,
      innerRunsRedacted: 1,
      reportsRedacted: 2,
      runsErased: 5,
      runsSkipped: 0,
      runsBeforeRunTag: 2,
      appDeleted: true,
    })
    renderIn("en")
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "GDPR request from a user" } })
    fireEvent.change(document.getElementById("expunge-slug")!, { target: { value: "poster-maker" } })
    fireEvent.click(screen.getByRole("button", { name: "Permanently expunge" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const message = vi.mocked(toast.success).mock.calls[0]![0] as string
    expect(message).toBe(
      `${translate("en", "adminExpunge.success", { deleted: 4, errors: 0 })}\n\n${translate("en", "adminExpunge.untaggedNote", { count: 2 })}`,
    )
  })

  it.each(["he", "ja", "ko", "pt-BR"] as LocaleId[])("is fully translated in %s", (locale) => {
    renderIn(locale)
    const text = document.body.textContent ?? ""
    for (const key of LIST_KEYS) {
      const own = translate(locale, key)
      expect(own, `${locale} has no text of its own for ${key}`).not.toBe(translate("en", key))
      expect(text).toContain(own)
    }
    expect(screen.getByRole("heading").textContent).toBe(translate(locale, "adminExpunge.title", { name: "Poster Maker" }))
    // The toasts, too.
    for (const key of ["adminExpunge.partial", "adminExpunge.untaggedNote"] as MessageKey[]) {
      expect(translate(locale, key), `${locale} has no text of its own for ${key}`).not.toBe(translate("en", key))
    }
    expect(translate(locale, "adminExpunge.untaggedNote", { count: 2 })).toContain("2")
    // A lower bound: the note says "at least" in every locale.
    expect(translate("en", "adminExpunge.untaggedNote", { count: 2 })).toMatch(/^At least 2 /)
  })
})
