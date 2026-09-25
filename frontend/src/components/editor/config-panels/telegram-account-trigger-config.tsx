import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
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

export function TelegramAccountTriggerConfig({ data, onUpdate }: ConfigProps<TelegramAccountTriggerData>) {
  const t = useT()
  const d = data as TelegramAccountTriggerData
  const { accounts, loading: loadingAccounts } = useTelegramAccounts()
  const [search, setSearch] = useState("")
  const [keywordText, setKeywordText] = useState((d.keywords ?? []).join(", "))

  const chats = useQuery({
    queryKey: queryKeys.telegramAccounts.chats(d.accountId ?? ""),
    queryFn: () => listTelegramAccountChats(d.accountId as string),
    enabled: !!d.accountId,
    staleTime: 60_000,
    retry: false,
  })

  const chatIds = d.chatIds ?? []
  const typeFilters = d.messageTypeFilters ?? []
  const listening = d.isActive === true && canListen(d)

  const visibleChats = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const all = chats.data?.chats ?? []
    return needle ? all.filter((c) => c.title.toLowerCase().includes(needle) || (c.username ?? "").toLowerCase().includes(needle)) : all
  }, [chats.data, search])

  const toggleChat = (chatId: string, title: string, checked: boolean) => {
    const next = checked ? [...chatIds, chatId] : chatIds.filter((id) => id !== chatId)
    const titles = { ...(d.chatTitles ?? {}) }
    if (checked) titles[chatId] = title
    else delete titles[chatId]
    // No chat left: stop listening rather than fall back to every chat.
    onUpdate({ chatIds: next, chatTitles: titles, ...(next.length === 0 ? { isActive: false } : {}) })
  }

  const toggleType = (value: string, checked: boolean) => {
    onUpdate({ messageTypeFilters: checked ? [...typeFilters, value] : typeFilters.filter((v) => v !== value) })
  }

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
        {listening ? t("cfgext.trigActiveListening") : t("apps.inactive")}
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
            onValueChange={(v) => onUpdate({ accountId: v, chatIds: [], chatTitles: {}, isActive: false })}
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

      {d.accountId && (
        <div>
          <Label className={SECTION_LABEL}>{t("tgtrig.chats")}</Label>
          <p className="text-[10px] text-muted-foreground mt-1">{t("tgtrig.chatsHint")}</p>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("tgtrig.searchChats")} className="mt-1.5 h-8 text-xs" />
          <div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border p-1.5">
            {chats.isLoading ? (
              <p className="flex items-center gap-2 p-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("tgtrig.loadingChats")}
              </p>
            ) : chats.isError ? (
              <p className="p-1 text-xs text-destructive">{t("tgtrig.chatsFailed")}</p>
            ) : visibleChats.length === 0 ? (
              <p className="p-1 text-xs text-muted-foreground">{t("tgtrig.noChats")}</p>
            ) : (
              visibleChats.map((chat) => (
                <label key={chat.chatId} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted/50">
                  <Checkbox checked={chatIds.includes(chat.chatId)} onCheckedChange={(c) => toggleChat(chat.chatId, chat.title, c === true)} />
                  <span className={`flex-1 truncate text-xs ${chat.dormant ? "text-muted-foreground" : ""}`} dir="auto">
                    {chat.title}
                  </span>
                  {chat.dormant && <span className="text-[10px] text-muted-foreground">{t("tgtrig.dormant")}</span>}
                </label>
              ))
            )}
          </div>
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
        </div>
      </div>

      <div>
        <Label className={SECTION_LABEL}>{t("tgtrig.keywords")}</Label>
        <Input
          value={keywordText}
          onChange={(e) => setKeywordText(e.target.value)}
          onBlur={() => onUpdate({ keywords: parseKeywords(keywordText) })}
          className="mt-1.5"
          dir="auto"
        />
        <p className="text-[10px] text-muted-foreground mt-1">{t("tgtrig.keywordsHint")}</p>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <Checkbox checked={d.includeOutgoing === true} onCheckedChange={(c) => onUpdate({ includeOutgoing: c === true })} />
        {t("tgtrig.includeOutgoing")}
      </label>

      <div className="flex flex-col gap-1.5">
        <Button
          variant={d.isActive ? "outline" : "default"}
          disabled={!d.isActive && !canListen(d)}
          onClick={() => onUpdate({ isActive: !d.isActive })}
        >
          {d.isActive ? t("tgtrig.stop") : t("tgtrig.start")}
        </Button>
        <p className="text-[10px] text-muted-foreground">
          {!canListen(d) ? t("tgtrig.needAccountAndChat") : t("tgtrig.saveToApply")}
        </p>
      </div>
    </div>
  )
}
