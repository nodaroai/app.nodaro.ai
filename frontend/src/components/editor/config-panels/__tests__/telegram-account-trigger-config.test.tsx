/**
 * The Telegram account trigger's panel: it can listen only with an account and
 * at least one chat picked, and un-picking the last chat stops it rather than
 * falling back to every chat. A change here is the owner's choice of
 * everything the trigger listens to, so all of it is on screen: every selected
 * chat (one outside the recent chats marked as such), sender filters, and the
 * keywords the node holds — and Start waits until the chats are loaded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
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

type PanelProps = Parameters<typeof TelegramAccountTriggerConfig>[0]

function propsFor(data: Record<string, unknown>, onUpdate: ReturnType<typeof vi.fn>): PanelProps {
  return { data: { label: "T", ...data }, onUpdate, sources: [], fieldMappings: {}, onMapField: vi.fn(), nodes: [] } as unknown as PanelProps
}

function renderPanel(data: Record<string, unknown>) {
  const onUpdate = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={qc}>
      <TelegramAccountTriggerConfig {...propsFor(data, onUpdate)} />
    </QueryClientProvider>,
  )
  const rerender = (next: Record<string, unknown>) =>
    view.rerender(
      <QueryClientProvider client={qc}>
        <TelegramAccountTriggerConfig {...propsFor(next, onUpdate)} />
      </QueryClientProvider>,
    )
  return { onUpdate, rerender }
}

/** The picker's row for a chat (the list of the account's chats). */
const pickerBox = (name: string | RegExp) => screen.findByRole("checkbox", { name })
/** The summary of every chat the trigger listens to. */
const selected = () => screen.getByRole("list", { name: /selected chats/i })

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
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: [] })
    fireEvent.click(await screen.findByText("News"))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ chatIds: ["-1001"], chatTitles: { "-1001": "News" } }))
  })

  it("un-picking the last chat of a listening trigger stops it", async () => {
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: ["-1001"], chatTitles: { "-1001": "News" }, isActive: true })
    fireEvent.click(await pickerBox("News"))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ chatIds: [], chatTitles: {}, isActive: false }))
  })

  it("a listening trigger can always be stopped", async () => {
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: ["-1001"], isActive: true })
    expect(await pickerBox("News")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /stop listening/i })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: /stop listening/i }))
    expect(onUpdate).toHaveBeenCalledWith({ isActive: false })
  })
})

describe("everything the trigger listens to is on screen", () => {
  it("every selected chat is listed at the top; one outside the recent chats says so, never under the node's own title", async () => {
    const { onUpdate } = renderPanel({
      accountId: "acc-1",
      chatIds: ["-1001", "-1009"],
      // A title that travelled with the graph is not shown as the chat's name.
      chatTitles: { "-1001": "News", "-1009": "Saved Messages" },
    })
    expect(await pickerBox("News")).toBeInTheDocument()
    const list = selected()
    expect(within(list).getByText("News")).toBeInTheDocument()
    expect(within(list).getByText("Chat -1009 (not in your recent chats)")).toBeInTheDocument()
    expect(within(list).queryByText("Saved Messages")).not.toBeInTheDocument()
    fireEvent.click(within(list).getByRole("button", { name: "Remove Chat -1009 (not in your recent chats)" }))
    expect(onUpdate).toHaveBeenCalledWith({ chatIds: ["-1001"], chatTitles: { "-1001": "News" } })
  })

  it("a selected chat the search hides is still listed", async () => {
    renderPanel({ accountId: "acc-1", chatIds: ["-1002"] })
    expect(await pickerBox(/makers/i)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/search chats/i), { target: { value: "news" } })
    expect(screen.queryByRole("checkbox", { name: /makers/i })).not.toBeInTheDocument()
    expect(within(selected()).getByText("Makers")).toBeInTheDocument()
  })

  it("Start waits for the chats to load", async () => {
    chats.mockReturnValue(new Promise(() => {}))
    renderPanel({ accountId: "acc-1", chatIds: ["-1001"] })
    expect(await screen.findByText(/loading chats/i)).toBeInTheDocument()
    expect(within(selected()).getByText("-1001")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /start listening/i })).toBeDisabled()
  })

  it("Start stays off when the chats could not be loaded, and says why", async () => {
    chats.mockRejectedValue(new Error("offline"))
    renderPanel({ accountId: "acc-1", chatIds: ["-1001"] })
    expect(await screen.findByText(/listening can't start/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /start listening/i })).toBeDisabled()
  })

  it("an account that is not one of the owner's cannot start, and its chats are not fetched", async () => {
    renderPanel({ accountId: "acc-x", chatIds: ["-1001"] })
    expect(screen.getByText(/isn't one of your connected telegram accounts/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /start listening/i })).toBeDisabled()
    expect(chats).not.toHaveBeenCalled()
  })

  it("Start is offered once the chats are loaded", async () => {
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: ["-1001"] })
    expect(await pickerBox("News")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /start listening/i }))
    expect(onUpdate).toHaveBeenCalledWith({ isActive: true })
  })

  it("a type filter no checkbox offers is listed, checked, and can be removed", async () => {
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: ["-1001"], messageTypeFilters: ["video", "sticker"] })
    expect(await pickerBox("News")).toBeInTheDocument()
    const other = screen.getByRole("checkbox", { name: "sticker" })
    expect(other).toBeChecked()
    fireEvent.click(other)
    expect(onUpdate).toHaveBeenCalledWith({ messageTypeFilters: ["video"] })
  })

  it("lists are read as the server reads them: a blank or non-text entry is neither shown nor counted", async () => {
    renderPanel({ accountId: "acc-1", chatIds: [" -1001 ", "", 42, "-1001"], keywords: [" launch ", 7] })
    expect(await pickerBox("News")).toBeInTheDocument()
    expect(within(selected()).getAllByRole("listitem")).toHaveLength(1)
    expect(screen.getByDisplayValue("launch")).toBeInTheDocument()
  })

  it("sender filters are shown and can be cleared", async () => {
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: ["-1001"], senderIds: ["555", "556"] })
    expect(await pickerBox("News")).toBeInTheDocument()
    expect(screen.getByText("555, 556")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }))
    expect(onUpdate).toHaveBeenCalledWith({ senderIds: [] })
  })

  it("a change while the chats are loading stops the trigger instead of approving what is not on screen", async () => {
    chats.mockReturnValue(new Promise(() => {}))
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: ["-1001"], isActive: true })
    expect(await screen.findByText(/loading chats/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: /photo/i }))
    expect(onUpdate).toHaveBeenCalledWith({ messageTypeFilters: ["photo"], isActive: false })
  })

  it("a change on an account that is not the owner's stops the trigger too", () => {
    const { onUpdate } = renderPanel({ accountId: "acc-1 ", chatIds: ["-1001"], isActive: true })
    expect(screen.getByText(/isn't one of your connected telegram accounts/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: /photo/i }))
    expect(onUpdate).toHaveBeenCalledWith({ messageTypeFilters: ["photo"], isActive: false })
  })

  it("each keyword is listed on its own, a hidden character spelled out; leaving the box as shown writes nothing", async () => {
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: ["-1001"], keywords: ["urgent, invoice", "a\u200b"] })
    expect(await pickerBox("News")).toBeInTheDocument()
    const listed = within(screen.getByRole("list", { name: /keywords/i })).getAllByRole("listitem").map((item) => item.textContent)
    expect(listed).toEqual(["urgent, invoice", "a\\u200b"])
    fireEvent.blur(screen.getByDisplayValue("urgent, invoice, a\u200b"))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("leaving inbox mode clears the own-messages box it hid", async () => {
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: ["-1001"], inboxMode: true, includeOutgoing: true })
    expect(await pickerBox("News")).toBeInTheDocument()
    fireEvent.click(screen.getByText(/^inbox mode$/i))
    expect(onUpdate).toHaveBeenCalledWith({ inboxMode: false, includeOutgoing: false })
  })

  it("the keywords box follows the node, and leaving it unchanged writes nothing", async () => {
    const { onUpdate, rerender } = renderPanel({ accountId: "acc-1", chatIds: ["-1001"], keywords: ["launch"] })
    expect(await pickerBox("News")).toBeInTheDocument()
    const box = screen.getByDisplayValue("launch")
    rerender({ accountId: "acc-1", chatIds: ["-1001"], keywords: ["pricing", "deal"] })
    expect(box).toHaveValue("pricing, deal")
    fireEvent.blur(box)
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: "pricing, deal, promo" } })
    fireEvent.blur(box)
    expect(onUpdate).toHaveBeenCalledWith({ keywords: ["pricing", "deal", "promo"] })
  })
})

describe("inbox mode and Saved Messages", () => {
  it("lists Saved Messages first, under its name in the interface language, and stores the account's own id", async () => {
    chats.mockResolvedValue({
      chats: [
        { chatId: "-1001", type: "channel", title: "News", dormant: false },
        { chatId: "777", type: "private", title: "Saved Messages", dormant: false, isSelf: true },
      ],
    })
    useLocaleStore.setState({ locale: "he", dir: "rtl" })
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: [] })
    const saved = await screen.findByText("הודעות שמורות")
    const labels = screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent ?? "")
    expect(labels.findIndex((text) => text.includes("הודעות שמורות"))).toBeLessThan(labels.findIndex((text) => text.includes("News")))
    fireEvent.click(saved)
    // The stored title is the connector's own, so a collaborator in another language reads their own.
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ chatIds: ["777"], chatTitles: { "777": "Saved Messages" } }))
  })

  it("turning inbox mode on stores it; the own-messages box is then implied and hidden", async () => {
    const { onUpdate } = renderPanel({ accountId: "acc-1", chatIds: ["-1001"] })
    expect(await pickerBox("News")).toBeInTheDocument()
    expect(screen.getByText(/also my own messages/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/^inbox mode$/i))
    expect(onUpdate).toHaveBeenCalledWith({ inboxMode: true })
  })

  it("with inbox mode on, the own-messages box is not offered", async () => {
    renderPanel({ accountId: "acc-1", chatIds: ["-1001"], inboxMode: true })
    expect(await pickerBox("News")).toBeInTheDocument()
    expect(screen.queryByText(/also my own messages/i)).not.toBeInTheDocument()
  })
})
