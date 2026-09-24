import { useState } from "react"
import { Loader2, Pause, Play, Plus, Send, Unplug } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useT } from "@/lib/i18n"
import {
  disconnectTelegramAccount,
  pauseTelegramAccount,
  resumeTelegramAccount,
  type TelegramAccountSummary,
} from "@/lib/api"
import { useTelegramAccounts } from "@/hooks/use-telegram-accounts"
import { STATUS_MESSAGE } from "./login-messages"
import { TelegramConnectDialog } from "./telegram-connect-dialog"

/**
 * Integrations → Telegram account: the owner's connected accounts, with pause
 * / resume / disconnect, and the connect wizard.
 *
 * It renders NOTHING until the server has said the feature exists for this
 * caller — a self-hosted install, an older Cloud deploy, and (until general
 * availability) everyone outside the preview audience get a 404 there, and
 * must not see a card flash in and out.
 */

const STATUS_DOT: Readonly<Record<string, string>> = {
  active: "var(--integ-ok)",
  paused: "var(--integ-muted)",
  revoked: "var(--integ-warn)",
  disabled: "var(--integ-warn)",
}

export function TelegramAccountsCard() {
  const t = useT()
  const { available, accounts, loading, error, refresh } = useTelegramAccounts()
  const [connectOpen, setConnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState<TelegramAccountSummary | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (available !== true) return null

  const act = async (account: TelegramAccountSummary, work: () => Promise<unknown>, success: string) => {
    setBusyId(account.id)
    try {
      await work()
      toast.success(success)
    } catch {
      toast.error(t("tgacct.actionFailed"))
    } finally {
      setBusyId(null)
      await refresh()
    }
  }

  const confirmDisconnect = async () => {
    const target = disconnecting
    setDisconnecting(null)
    if (!target) return
    setBusyId(target.id)
    try {
      const result = await disconnectTelegramAccount(target.id)
      // The row is gone either way; if Telegram could not be told, say how to end the session there.
      if (result.loggedOut) toast.success(t("tgacct.disconnected"))
      else toast.warning(t("tgacct.disconnectedLocalOnly"))
    } catch {
      toast.error(t("tgacct.actionFailed"))
    } finally {
      setBusyId(null)
      await refresh()
    }
  }

  return (
    <section
      aria-labelledby="telegram-accounts-heading"
      className="flex flex-col overflow-hidden rounded-[16px] border"
      style={{ borderColor: "var(--integ-line)", background: "var(--integ-surface)" }}
    >
      <div className="flex items-start justify-between gap-4 p-5 pb-4">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-sky-500/10 text-sky-600">
            <Send className="h-[18px] w-[18px]" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="telegram-accounts-heading" className="text-[15px] font-bold tracking-[-0.01em]" style={{ color: "var(--integ-fg)" }}>
                {t("tgacct.title")}
              </h3>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                {t("tgacct.preview")}
              </span>
              {accounts.length > 0 && (
                <span className="font-mono text-[11px]" style={{ color: "var(--integ-muted)" }}>
                  {t("tgacct.count", { n: accounts.length })}
                </span>
              )}
            </div>
            <p className="max-w-[480px] text-[12.5px] leading-[1.5] text-pretty" style={{ color: "var(--integ-muted)" }}>
              {t("tgacct.subtitle")}
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1" onClick={() => setConnectOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {t("tgacct.connect")}
        </Button>
      </div>

      <div className="mx-5 border-t border-dashed" style={{ borderColor: "var(--integ-line-soft)" }} />

      <div className="flex flex-col gap-2 p-5 pt-3.5">
        {loading ? (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--integ-muted)" }}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("tgacct.loading")}
          </div>
        ) : error ? (
          <p className="text-xs" style={{ color: "var(--integ-muted)" }}>{t("tgacct.loadFailed")}</p>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col gap-0.5 rounded-[11px] border border-dashed p-4" style={{ borderColor: "var(--integ-line-dashed)" }}>
            <span className="text-[13px] font-semibold" style={{ color: "var(--integ-fg)" }}>{t("tgacct.emptyTitle")}</span>
            <span className="text-[11.5px]" style={{ color: "var(--integ-muted)" }}>{t("tgacct.emptyHint")}</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.map((account) => {
              const statusKey = STATUS_MESSAGE[account.status]
              const busy = busyId === account.id
              return (
                <li
                  key={account.id}
                  className="flex items-center gap-2.5 rounded-[11px] border px-3 py-2.5"
                  style={{ borderColor: "var(--integ-line-soft)", background: "var(--integ-sunken)" }}
                >
                  <span
                    className="h-1.5 w-1.5 flex-none rounded-full"
                    style={{ background: STATUS_DOT[account.status] ?? "var(--integ-muted)" }}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-semibold" dir="auto" style={{ color: "var(--integ-fg)" }}>
                      {account.label ?? account.firstName ?? account.id}
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--integ-muted)" }}>
                      {statusKey ? t(statusKey) : account.status}
                    </span>
                  </div>
                  <div className="ms-auto flex flex-none items-center gap-1">
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--integ-muted)" }} />}
                    {account.status === "active" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        disabled={busy}
                        onClick={() => void act(account, () => pauseTelegramAccount(account.id), t("tgacct.paused"))}
                      >
                        <Pause className="h-3.5 w-3.5" />
                        {t("tgacct.pause")}
                      </Button>
                    )}
                    {account.status === "paused" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        disabled={busy}
                        onClick={() => void act(account, () => resumeTelegramAccount(account.id), t("tgacct.resumed"))}
                      >
                        <Play className="h-3.5 w-3.5" />
                        {t("tgacct.resume")}
                      </Button>
                    )}
                    {account.status === "revoked" && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => setConnectOpen(true)}>
                        {t("tgacct.reconnect")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => setDisconnecting(account)}
                    >
                      <Unplug className="h-3.5 w-3.5" />
                      {t("tgacct.disconnect")}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <TelegramConnectDialog open={connectOpen} onOpenChange={setConnectOpen} onConnected={() => void refresh()} />
      <DeleteConfirmationDialog
        isOpen={disconnecting !== null}
        onClose={() => setDisconnecting(null)}
        onConfirm={() => void confirmDisconnect()}
        title={t("tgacct.disconnectTitle", { label: disconnecting?.label ?? "" })}
        description={t("tgacct.disconnectBody")}
        confirmLabel={t("tgacct.disconnect")}
      />
    </section>
  )
}
