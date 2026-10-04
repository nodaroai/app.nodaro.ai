import { useState } from "react"
import { CircleHelp, ExternalLink, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TelegramConnectDialog } from "@/components/integrations/connect-dialogs"
import { connectTelegram, getSocialConnections } from "@/lib/api"
import { BOTFATHER_URL } from "@/lib/telegram-links"
import { useT } from "@/lib/i18n"
import { useSocialConnections } from "./social-configs"

const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]"
const HINT = "text-[10px] text-muted-foreground mt-1 leading-snug"

/** How a bot is made: a short walk through @BotFather, with the link to open it. */
function BotHelp() {
  const t = useT()
  const steps = [t("tgsend.botHelpStep1"), t("tgsend.botHelpStep2"), t("tgsend.botHelpStep3"), t("tgsend.botHelpStep4"), t("tgsend.botHelpStep5")]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={t("tgsend.botHelp")} title={t("tgsend.botHelp")}>
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 text-xs">
        <p className="text-sm font-medium">{t("tgsend.botHelpTitle")}</p>
        <ol className="list-decimal space-y-1.5 ps-4">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <Button asChild size="sm" variant="outline" className="w-full">
          <a href={BOTFATHER_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5 me-1.5" />
            {t("tgsend.openBotFather")}
          </a>
        </Button>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The bot the reply is sent from: one of the owner's connected bots, or a
 * new one connected right here — the same token form as the Integrations
 * page, and the new bot is picked at once.
 */
export function TelegramBotPicker({ connectionId, onPick }: { readonly connectionId: string | undefined; readonly onPick: (connectionId: string) => void }) {
  const t = useT()
  const { connections: bots, loading, reload } = useSocialConnections("telegram")
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setError(null)
    setBusy(true)
    try {
      const { botUsername } = await connectTelegram(token.trim())
      const { connections } = await getSocialConnections()
      const added = connections.find((c) => c.platform === "telegram" && c.platform_username === botUsername)
      if (added) onPick(added.id)
      reload()
      toast.success(t("tgsend.botConnected", { username: botUsername }))
      setOpen(false)
      setToken("")
    } catch (err) {
      setError(err instanceof Error ? err.message : t("integ.failedConnectBot"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Label className={SECTION_LABEL}>{t("tgsend.bot")}</Label>
        <BotHelp />
      </div>
      {!loading && bots.length === 0 ? (
        <p className="text-xs text-muted-foreground mt-1.5 p-2 bg-muted/30 rounded-md border border-dashed border-border">{t("tgsend.noBot")}</p>
      ) : (
        <Select value={connectionId || ""} onValueChange={onPick}>
          <SelectTrigger className="mt-1.5">
            <SelectValue placeholder={t("tgsend.defaultBot")} />
          </SelectTrigger>
          <SelectContent>
            {bots.map((bot) => (
              <SelectItem key={bot.id} value={bot.id}>
                {bot.platform_username ? `@${bot.platform_username}` : bot.display_name ?? bot.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5 me-1.5" />
        {t("tgsend.addBot")}
      </Button>
      <p className={HINT}>{t("tgsend.botStartHint")}</p>

      <TelegramConnectDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setToken("")
            setError(null)
          }
        }}
        token={token}
        onTokenChange={setToken}
        busy={busy}
        error={error}
        onConnect={() => void connect()}
      />
    </div>
  )
}
