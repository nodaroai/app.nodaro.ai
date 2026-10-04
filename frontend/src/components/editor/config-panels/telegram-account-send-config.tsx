import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { telegramSendAsOf, telegramSendDestinationOf } from "@nodaro/shared"
import { useTelegramAccounts } from "@/hooks/use-telegram-accounts"
import { useT } from "@/lib/i18n"
import type { TelegramAccountSendData } from "@/types/nodes"
import { TelegramBotPicker } from "./telegram-bot-picker"
import type { ConfigProps } from "./types"

/**
 * Telegram Reply: who writes — the owner's connected account, or their own
 * bot — and, as the account, where the message lands. There is deliberately
 * no chat to type: every choice here ends with the owner, so the panel only
 * says which of the owner's chats, with what that means in Telegram.
 */

const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]"
const HINT = "text-[10px] text-muted-foreground mt-1 leading-snug"

export function TelegramAccountSendConfig({ data, onUpdate }: ConfigProps<TelegramAccountSendData>) {
  const t = useT()
  const d = data as TelegramAccountSendData
  const { accounts, loading: loadingAccounts } = useTelegramAccounts()
  const sendAs = telegramSendAsOf(d.sendAs)
  const destination = telegramSendDestinationOf(d.destination)

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md border border-border bg-muted/30 p-2 text-xs">{t("tgsend.onlyYou")}</p>

      <div>
        <Label className={SECTION_LABEL}>{t("tgsend.sendAs")}</Label>
        <RadioGroup value={sendAs} onValueChange={(v) => onUpdate({ sendAs: v })} className="mt-1.5 flex flex-col gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="account" id="tgsend-as-account" />
              <label htmlFor="tgsend-as-account" className="cursor-pointer text-xs">{t("tgsend.asAccount")}</label>
            </div>
            <p className={HINT}>{t("tgsend.asAccountHint")}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="bot" id="tgsend-as-bot" />
              <label htmlFor="tgsend-as-bot" className="cursor-pointer text-xs">{t("tgsend.asBot")}</label>
            </div>
            <p className={HINT}>{t("tgsend.asBotHint")}</p>
          </div>
        </RadioGroup>
      </div>

      <div>
        <Label className={SECTION_LABEL}>{t("tgtrig.account")}</Label>
        {!loadingAccounts && accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-1.5 p-2 bg-muted/30 rounded-md border border-dashed border-border">
            {t("tgtrig.noAccount")}{" "}
            <a href="/integrations" className="underline">{t("tgtrig.connectIn")}</a>
          </p>
        ) : (
          <Select value={d.accountId || ""} onValueChange={(v) => onUpdate({ accountId: v })}>
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
        {sendAs === "bot" && <p className={HINT}>{t("tgsend.accountForBotHint")}</p>}
      </div>

      {sendAs === "account" ? (
        <div>
          <Label className={SECTION_LABEL}>{t("tgsend.destination")}</Label>
          <RadioGroup value={destination} onValueChange={(v) => onUpdate({ destination: v })} className="mt-1.5 flex flex-col gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="reply" id="tgsend-to-reply" />
                <label htmlFor="tgsend-to-reply" className="cursor-pointer text-xs">{t("tgsend.toReplyOption")}</label>
              </div>
              <p className={HINT}>{t("tgsend.toReplyHint")}</p>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="saved" id="tgsend-to-saved" />
                <label htmlFor="tgsend-to-saved" className="cursor-pointer text-xs">{t("tgsend.toSavedOption")}</label>
              </div>
              <p className={HINT}>{t("tgsend.toSavedHint")}</p>
            </div>
          </RadioGroup>
        </div>
      ) : (
        <TelegramBotPicker connectionId={d.connectionId} onPick={(v) => onUpdate({ connectionId: v })} />
      )}

      <div>
        <Label className={SECTION_LABEL}>{t("tgsend.text")}</Label>
        <Textarea
          value={typeof d.text === "string" ? d.text : ""}
          onChange={(e) => onUpdate({ text: e.target.value })}
          className="mt-1.5 min-h-[72px] text-xs"
          dir="auto"
        />
        <p className={HINT}>{t("tgsend.textHint")}</p>
      </div>
    </div>
  )
}
