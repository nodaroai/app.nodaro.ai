// "Include this run's results" in the Publish as template dialog: shown only for a workflow holding a
// UGC video, enabled only when the server's dry run says the run can ship, sent as an explicit
// choice, and a server that would not keep it says so after the publish.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const api = vi.hoisted(() => ({
  checkTemplateKeepRun: vi.fn(),
  publishTemplate: vi.fn(),
  getMyTemplates: vi.fn(),
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("@/lib/api", () => api)
vi.mock("sonner", () => ({ toast: toasts }))

import { PublishTemplateDialog } from "../publish-template-dialog"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1]) => translate("en", key)
const WF = "00000000-0000-4000-8000-000000000020"
const UGC_NODES = [{ id: "creator", type: "ugc-creator", position: { x: 0, y: 0 }, data: {} }]
const PLAIN_NODES = [{ id: "img", type: "generate-image", position: { x: 0, y: 0 }, data: {} }]

function renderDialog(nodes: unknown[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PublishTemplateDialog workflowId={WF} nodes={nodes as never} edges={[]} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

async function publishWithName() {
  fireEvent.change(screen.getByPlaceholderText(t("pubTemplate.namePlaceholder")), { target: { value: "My UGC" } })
  fireEvent.click(screen.getByRole("button", { name: t("pubTemplate.submitPublish") }))
  await waitFor(() => expect(api.publishTemplate).toHaveBeenCalled())
  return api.publishTemplate.mock.calls[0]![0] as Record<string, unknown>
}

beforeEach(() => {
  api.getMyTemplates.mockResolvedValue([])
  api.publishTemplate.mockResolvedValue({ id: "t1", keptResults: { included: true } })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Include this run's results", () => {
  it("a workflow with no UGC video never asks, shows nothing and sends nothing", async () => {
    renderDialog(PLAIN_NODES)
    expect(screen.queryByTestId("pub-template-include-results")).toBeNull()
    const sent = await publishWithName()
    expect(api.checkTemplateKeepRun).not.toHaveBeenCalled()
    expect(sent).not.toHaveProperty("includeRunResults")
  })

  it("a proven run: off by default, and turning it on sends true", async () => {
    api.checkTemplateKeepRun.mockResolvedValue({ shown: true, eligible: true, current: false })
    renderDialog(UGC_NODES)
    const row = await screen.findByTestId("pub-template-include-results")
    const toggle = row.querySelector('[role="switch"]') as HTMLElement
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    expect(row.textContent).toContain(t("pubTemplate.includeResultsDesc"))
    fireEvent.click(toggle)
    expect((await publishWithName()).includeRunResults).toBe(true)
  })

  it("left alone, it sends false (off by default)", async () => {
    api.checkTemplateKeepRun.mockResolvedValue({ shown: true, eligible: true, current: false })
    renderDialog(UGC_NODES)
    await screen.findByTestId("pub-template-include-results")
    expect((await publishWithName()).includeRunResults).toBe(false)
  })

  it("starts from the author's last choice", async () => {
    api.checkTemplateKeepRun.mockResolvedValue({ shown: true, eligible: true, current: true })
    renderDialog(UGC_NODES)
    const row = await screen.findByTestId("pub-template-include-results")
    await waitFor(() => expect(row.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("true"))
    expect((await publishWithName()).includeRunResults).toBe(true)
  })

  it.each([
    ["photo_run", "pubTemplate.includeResultsPhotoRun"],
    ["no_results", "pubTemplate.includeResultsNone"],
    ["unverified", "pubTemplate.includeResultsUnverified"],
  ] as const)("a run that cannot ship (%s): disabled, says why, sends false", async (reason, key) => {
    api.checkTemplateKeepRun.mockResolvedValue({ shown: true, eligible: false, current: true, reason })
    renderDialog(UGC_NODES)
    const row = await screen.findByTestId("pub-template-include-results")
    await waitFor(() => expect(row.textContent).toContain(t(key)))
    const toggle = row.querySelector('[role="switch"]') as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    expect((await publishWithName()).includeRunResults).toBe(false)
  })

  it("a publish the server kept nothing for says so", async () => {
    api.checkTemplateKeepRun.mockResolvedValue({ shown: true, eligible: true, current: true })
    api.publishTemplate.mockResolvedValue({ id: "t1", keptResults: { included: false, reason: "unverified" } })
    renderDialog(UGC_NODES)
    const row = await screen.findByTestId("pub-template-include-results")
    await waitFor(() => expect(row.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("true"))
    await publishWithName()
    await waitFor(() => expect(toasts.info).toHaveBeenCalledWith(t("pubTemplate.includeResultsDropped")))
  })
})
