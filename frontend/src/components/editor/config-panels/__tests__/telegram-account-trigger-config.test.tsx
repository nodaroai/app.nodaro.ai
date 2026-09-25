/**
 * The Telegram account trigger's panel: it can listen only with an account and
 * at least one chat picked, and un-picking the last chat stops it rather than
 * falling back to every chat.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const chats = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api", () => ({ listTelegramAccountChats: (id: string) => chats(id) }))
vi.mock("@/hooks/use-telegram-accounts", () => ({
  useTelegramAccounts: () => ({
    available: true,
    loading: false,
    error: false,
    refresh: vi.fn(),
    accounts: [{ id: "acc-1", label: "@radar", status: "active", statusReason: null, updatedAt: "" }],
  }),
}))

import { TelegramAccountTriggerConfig, canListen, parseKeywords } from "../telegram-account-trigger-config"
import { useLocaleStore } from "@/lib/locale-store"

function renderPanel(data: Record<string, unknown>) {
  const onUpdate = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const props = { data: { label: "T", ...data }, onUpdate, sources: [], fieldMappings: {}, onMapField: vi.fn(), nodes: [] } as unknown as Parameters<
    typeof TelegramAccountTriggerConfig
  >[0]
  render(
    <QueryClientProvider client={qc}>
      <TelegramAccountTriggerConfig {...props} />
    </QueryClientProvider>,
  )
  return onUpdate
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en", dir: "ltr" })
  chats.mockReset()
  chats.mockResolvedValue({
    chats: [
      { chatId: "-1001", type: "channel", title: "News", dormant: false },
      { chatId: "-1002", type: "supergroup", title: "Makers", dormant: true },
    ],
  })
})

describe("helpers", () => {
  it("listening needs an account and at least one chat", () => {
    expect(canListen({ accountId: "acc-1", chatIds: ["-1001"] })).toBe(true)
    expect(canListen({ accountId: "acc-1", chatIds: [] })).toBe(false)
    expect(canListen({ chatIds: ["-1001"] })).toBe(false)
  })

  it("keywords are comma-separated, trimmed and de-duplicated", () => {
    expect(parseKeywords(" launch, pricing ,, launch ")).toEqual(["launch", "pricing"])
  })
})

describe("the panel", () => {
  it("cannot start listening until a chat is picked, and says why", async () => {
    renderPanel({ accountId: "acc-1", chatIds: [] })
    expect(await screen.findByText("News")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /start listening/i })).toBeDisabled()
    expect(screen.getByText(/pick an account and at least one chat/i)).toBeInTheDocument()
    expect(chats).toHaveBeenCalledWith("acc-1")
  })

  it("picking a chat stores its id and title", async () => {
    const onUpdate = renderPanel({ accountId: "acc-1", chatIds: [] })
    fireEvent.click(await screen.findByText("News"))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ chatIds: ["-1001"], chatTitles: { "-1001": "News" } }))
  })

  it("un-picking the last chat of a listening trigger stops it", async () => {
    const onUpdate = renderPanel({ accountId: "acc-1", chatIds: ["-1001"], chatTitles: { "-1001": "News" }, isActive: true })
    fireEvent.click(await screen.findByText("News"))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ chatIds: [], chatTitles: {}, isActive: false }))
  })

  it("switching account clears the chats and stops listening", async () => {
    const onUpdate = renderPanel({ accountId: "acc-1", chatIds: ["-1001"], isActive: true })
    expect(await screen.findByText("News")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /stop listening/i })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: /stop listening/i }))
    expect(onUpdate).toHaveBeenCalledWith({ isActive: false })
  })
})
