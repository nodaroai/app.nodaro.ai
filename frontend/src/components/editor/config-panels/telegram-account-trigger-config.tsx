import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import type { MessageKey } from "@/lib/i18n/en"
import { listTelegramAccountChats } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { useTelegramAccounts } from "@/hooks/use-telegram-accounts"
import type { TelegramAccountTriggerData } from "@/types/nodes"
import type { ConfigProps } from "./types"

/**
 * Telegram account trigger: which connected account, which of its chats, and
 * optional filters. It can listen only with an account and at least one chat
 * picked — a personal account's every chat is never the default — and the
 * server enforces the same when it projects the trigger on save.
 *
 * A change made here is the owner's choice of everything the trigger listens
 * to (`account-trigger-intent.ts`), so everything it listens to is on screen:
 * every selected chat at the top — one that is not among the account's recent
 * chats says so, never under a title the node itself carries — any sender
 * filter, any type filter no checkbox offers, and the keywords the node holds,
 * each read as the server reads it. Starting waits until the account's chats
 * are loaded, so a chat the owner never picked cannot pass as one they did.
 */

const MESSAGE_TYPES: ReadonlyArray<{ value: string; key: MessageKey }> = [
  { value: "text", key: "tgtrig.type.text" },
  { value: "photo", key: "tgtrig.type.photo" },
  { value: "video", key: "tgtrig.type.video" },
  { value: "voice", key: "tgtrig.type.voice" },
  { value: "audio", key: "tgtrig.type.audio" },
  { value: "document", key: "tgtrig.type.document" },
]

const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]"

/** Listening needs an account and at least one chat. */
export function canListen(data: Pick<TelegramAccountTriggerData, "accountId" | "chatIds">): boolean {
  return !!data.accountId && (data.chatIds?.length ?? 0) > 0
}

/** "a, b ,,c" → ["a", "b", "c"] */
export function parseKeywords(text: string): string[] {
  return [...new Set(text.split(",").map((k) => k.trim()).filter((k) => k !== ""))]
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/** Text as written, with characters that would not show (zero-width, controls) spelled out as \uXXXX. */
export function visibleText(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => `\\u${(c.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`)
}

/** A list as the server reads it (`telegramAccountListeningSignature`): strings, trimmed, non-empty, once. */
function listOf(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x !== ""))]
    : []
}

export function TelegramAccountTriggerConfig({ data, onUpdate }: ConfigProps<TelegramAccountTriggerData>) {
  const t = useT()
  const d = data as TelegramAccountTriggerData
  const { accounts, loading: loadingAccounts } = useTelegramAccounts()
  const [search, setSearch] = useState("")
  const keywords = listOf(d.keywords)
  const storedKeywords = keywords.join(", ")
  const [keywordText, setKeywordText] = useState(storedKeywords)
  // The box shows what the node holds: a change from anywhere else replaces
  // an old draft, so leaving the box never writes stale keywords back.
  useEffect(() => setKeywordText(storedKeywords), [storedKeywords])

  const accountKnown = !!d.accountId && accounts.some((account) => account.id === d.accountId)
  const chats = useQuery({
    queryKey: queryKeys.telegramAccounts.chats(d.accountId ?? ""),
    queryFn: () => listTelegramAccountChats(d.accountId as string),
    enabled: accountKnown,
    staleTime: 60_000,
    retry: false,
  })

  // Read as the server reads them, so what is listed is exactly what listens.
  const chatIds = listOf(d.chatIds)
  const senderIds = listOf(d.senderIds)
  const typeFilters = listOf(d.messageTypeFilters)
  // A type no checkbox offers still narrows the trigger: it is listed too.
  const otherTypes = typeFilters.filter((value) => !MESSAGE_TYPES.some((type) => type.value === value))
  const hasChoice = canListen({ accountId: d.accountId, chatIds })
  const listening = d.isActive === true && hasChoice
  // Everything the trigger would listen to can be told apart only with the
  // owner's account and its chats loaded.
  const verifiable = accountKnown && chats.isSuccess
  // Starting names every chat shown here, so it waits until each can be told apart.
  const canStart = hasChoice && verifiable
  // The one door every change goes through: a change made while the panel
  // cannot show everything the trigger would listen to (the chats still
  // loading or failed, an account that is not the owner's) stops the trigger
  // instead of approving what was not on screen. Stopping always applies.
  const update = (patch: Parameters<typeof onUpdate>[0]) => onUpdate(verifiable ? patch : { ...patch, isActive: false })

  const savedMessagesTitle = t("tgtrig.savedMessages")
  // Saved Messages first, and shown under its name in the interface language.
  const titleOf = (chat: { title: string; isSelf?: boolean }) => (chat.isSelf ? savedMessagesTitle : chat.title)
  const knownChats = useMemo(() => new Map((chats.data?.chats ?? []).map((chat) => [chat.chatId, chat])), [chats.data])
  const visibleChats = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const all = [...(chats.data?.chats ?? [])].sort((a, b) => Number(b.isSelf === true) - Number(a.isSelf === true))
    const shown = (c: (typeof all)[number]) => (c.isSelf ? savedMessagesTitle : c.title)
    return needle ? all.filter((c) => shown(c).toLowerCase().includes(needle) || (c.username ?? "").toLowerCase().includes(needle)) : all
  }, [chats.data, search, savedMessagesTitle])

  const toggleChat = (chatId: string, title: string, checked: boolean) => {
    const next = checked ? [...chatIds, chatId] : chatIds.filter((id) => id !== chatId)
    const titles = { ...(d.chatTitles ?? {}) }
    if (checked) titles[chatId] = title
    else delete titles[chatId]
    // No chat left: stop listening rather than fall back to every chat.
    update({ chatIds: next, chatTitles: titles, ...(next.length === 0 ? { isActive: false } : {}) })
  }

  const toggleType = (value: string, checked: boolean) => {
    update({ messageTypeFilters: checked ? [...typeFilters, value] : typeFilters.filter((v) => v !== value) })
  }

  const commitKeywords = () => {
    // Only an edit is a change: leaving the box as shown writes nothing, even
    // where re-reading the text would split a keyword that holds a comma.
    if (keywordText === storedKeywords) return
    const next = parseKeywords(keywordText)
    if (!sameList(next, keywords)) update({ keywords: next })
  }

  // While the chats load, the list above says so and Start simply waits.
  const startHint = !hasChoice
    ? t("tgtrig.needAccountAndChat")
    : !loadingAccounts && !accountKnown
      ? t("tgtrig.accountUnknown")
      : chats.isError
        ? t("tgtrig.chatsCannotStart")
        : t("tgtrig.saveToApply")

  return (
    <div className="flex flex-col gap-4">
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${
          listening
            ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
            : "bg-gray-50 dark:bg-[#2D2D2D] border-gray-200 dark:border-[#2D2D2D] text-gray-500 dark:text-[#64748B]"
        }`}
      >
        <div className={`h-2 w-2 rounded-full ${listening ? "bg-green-500" : "bg-gray-400"}`} />
        {listening ? t("cfgext.trigActiveListening") : t("sched.inactive")}
      </div>

      <div>
        <Label className={SECTION_LABEL}>{t("tgtrig.account")}</Label>
        {!loadingAccounts && accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-1.5 p-2 bg-muted/30 rounded-md border border-dashed border-border">
            {t("tgtrig.noAccount")}{" "}
            <a href="/integrations" className="underline">{t("tgtrig.connectIn")}</a>
          </p>
        ) : (
          <Select
            value={d.accountId || ""}
            onValueChange={(v) => update({ accountId: v, chatIds: [], chatTitles: {}, isActive: false })}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder={t("tgtrig.selectAccount")} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.label ?? account.firstName ?? account.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {(d.accountId || chatIds.length > 0) && (
        <div>
          <Label className={SECTION_LABEL}>{t("tgtrig.chats")}</Label>
          <p className="text-[10px] text-muted-foreground mt-1">{t("tgtrig.chatsHint")}</p>
          {chatIds.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1" aria-label={t("tgtrig.selectedChats")}>
              {chatIds.map((id) => {
                const chat = knownChats.get(id)
                const unknown = !chat && chats.isSuccess
                const name = chat ? titleOf(chat) : unknown ? t("tgtrig.unknownChat", { id }) : id
                return (
                  <li
                    key={id}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${
                      unknown ? "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400" : ""
                    }`}
                  >
                    <span className="flex-1 truncate" dir="auto">
                      {name}
                    </span>
                    <button
                      type="button"
                      aria-label={t("tgtrig.removeChat", { name })}
                      onClick={() => toggleChat(id, "", false)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {accountKnown && (
            <>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("tgtrig.searchChats")} className="mt-1.5 h-8 text-xs" />
              <div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border p-1.5">
                {chats.isError ? (
                  <p className="p-1 text-xs text-destructive">{t("tgtrig.chatsFailed")}</p>
                ) : !chats.isSuccess ? (
                  <p className="flex items-center gap-2 p-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("tgtrig.loadingChats")}
                  </p>
                ) : visibleChats.length === 0 ? (
                  <p className="p-1 text-xs text-muted-foreground">{t("tgtrig.noChats")}</p>
                ) : (
                  visibleChats.map((chat) => (
                    <label key={chat.chatId} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted/50">
                      <Checkbox checked={chatIds.includes(chat.chatId)} onCheckedChange={(c) => toggleChat(chat.chatId, chat.title, c === true)} />
                      <span className={`flex-1 truncate text-xs ${chat.dormant ? "text-muted-foreground" : ""}`} dir="auto">
                        {titleOf(chat)}
                      </span>
                      {chat.dormant && <span className="text-[10px] text-muted-foreground">{t("tgtrig.dormant")}</span>}
                    </label>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {senderIds.length > 0 && (
        <div>
          <Label className={SECTION_LABEL}>{t("tgtrig.senders")}</Label>
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <span className="flex-1 break-all" dir="ltr">
              {senderIds.join(", ")}
            </span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => update({ senderIds: [] })}>
              {t("tgtrig.clearSenders")}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{t("tgtrig.sendersHint")}</p>
        </div>
      )}

      <div>
        <Label className={SECTION_LABEL}>{t("tgtrig.messageTypes")}</Label>
        <p className="text-[10px] text-muted-foreground mt-1">{t("tgtrig.messageTypesHint")}</p>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {MESSAGE_TYPES.map((type) => (
            <label key={type.value} className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={typeFilters.includes(type.value)} onCheckedChange={(c) => toggleType(type.value, c === true)} />
              {t(type.key)}
            </label>
          ))}
          {otherTypes.map((value) => (
            <label key={value} className="flex cursor-pointer items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
              <Checkbox checked onCheckedChange={(c) => toggleType(value, c === true)} />
              <span dir="ltr">{value}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label className={SECTION_LABEL}>{t("tgtrig.keywords")}</Label>
        <Input
          value={keywordText}
          onChange={(e) => setKeywordText(e.target.value)}
          onBlur={commitKeywords}
          className="mt-1.5"
          dir="auto"
        />
        {/* Each keyword the trigger listens for, one by one, characters that would not show made visible. */}
        {keywords.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={t("tgtrig.keywords")}>
            {keywords.map((keyword) => (
              <li key={keyword} className="rounded border px-1.5 py-0.5 text-[10px]" dir="auto">
                {visibleText(keyword)}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-muted-foreground mt-1">{t("tgtrig.keywordsHint")}</p>
      </div>

      <div>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          {/* Leaving inbox mode clears the own-messages box it hid, so nothing off screen takes effect. */}
          <Checkbox
            checked={d.inboxMode === true}
            onCheckedChange={(c) => update(c === true ? { inboxMode: true } : { inboxMode: false, includeOutgoing: false })}
          />
          {t("tgtrig.inboxMode")}
        </label>
        <p className="text-[10px] text-muted-foreground mt-1">{t("tgtrig.inboxModeHint")}</p>
      </div>

      {/* Inbox mode listens to the owner's own shares, so it always includes them. */}
      {d.inboxMode !== true && (
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox checked={d.includeOutgoing === true} onCheckedChange={(c) => update({ includeOutgoing: c === true })} />
          {t("tgtrig.includeOutgoing")}
        </label>
      )}

      <div className="flex flex-col gap-1.5">
        <Button
          variant={d.isActive ? "outline" : "default"}
          disabled={!d.isActive && !canStart}
          onClick={() => update({ isActive: !d.isActive })}
        >
          {d.isActive ? t("tgtrig.stop") : t("tgtrig.start")}
        </Button>
        <p className="text-[10px] text-muted-foreground">{startHint}</p>
      </div>
    </div>
  )
}
