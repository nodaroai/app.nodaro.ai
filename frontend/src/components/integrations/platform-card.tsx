"use client"

import { useState, useCallback } from "react"
import { Loader2, Plus } from "lucide-react"
import {
  getSocialAuthUrl,
  disconnectSocial,
  connectTelegram,
  connectSocialCustom,
  setDefaultSocialConnection,
  isNotFoundError,
  type SocialProviderInfo,
} from "@/lib/api"
import { toast } from "sonner"
import { useT } from "@/lib/i18n"
import type { SocialConnection } from "@/types/nodes"
import { BrandTile } from "./brand-tile"
import { AccountRow } from "./account-row"
import { describeProvider } from "./platform-meta"
import { TelegramConnectDialog, FieldsConnectDialog } from "./connect-dialogs"

/**
 * One connectable network. Everything about it comes from the registry entry,
 * so a network added to the backend renders here with no change.
 *
 * `PlatformCard` only ever draws a network this deployment CAN connect;
 * unconfigured ones render as `ComingSoonCard`, which is a different shape
 * with a different message. Splitting them is the handoff's main idea for
 * this grid: the things you can do now should not have to compete with the
 * things you cannot.
 */
interface PlatformCardProps {
  readonly provider: SocialProviderInfo
  readonly connections: readonly SocialConnection[]
  readonly onConnectionChange: () => void
}

export function PlatformCard({ provider, connections, onConnectionChange }: PlatformCardProps) {
  const t = useT()
  const [connecting, setConnecting] = useState(false)
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null)
  const [telegramOpen, setTelegramOpen] = useState(false)
  const [botToken, setBotToken] = useState("")
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const openFieldsDialog = useCallback(() => {
    const defaults: Record<string, string> = {}
    for (const f of provider.customFields ?? []) {
      if (f.defaultValue) defaults[f.key] = f.defaultValue
    }
    setFieldValues(defaults)
    setDialogError(null)
    setFieldsOpen(true)
  }, [provider.customFields])

  const handleConnect = useCallback(async () => {
    if (provider.connectKind === "bot_token") {
      setTelegramOpen(true)
      return
    }
    if (provider.connectKind === "custom_fields") {
      openFieldsDialog()
      return
    }

    setConnecting(true)
    try {
      const { url } = await getSocialAuthUrl(provider.id)
      const popup = window.open(url, `social-auth-${provider.id}`, "width=600,height=700,scrollbars=yes")

      let interval: ReturnType<typeof setInterval>
      const cleanup = () => {
        clearInterval(interval)
        window.removeEventListener("message", handler)
      }
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "social-auth-success" && e.data.platform === provider.id) {
          cleanup()
          toast.success(t("integ.connectedTo", { name: provider.label }))
          onConnectionChange()
          setConnecting(false)
        } else if (e.data?.type === "social-auth-error") {
          cleanup()
          toast.error(e.data.message || t("integ.connectionFailed"))
          setConnecting(false)
        }
      }
      window.addEventListener("message", handler)

      interval = setInterval(() => {
        if (popup?.closed) {
          cleanup()
          setConnecting(false)
          onConnectionChange()
        }
      }, 1000)
    } catch {
      toast.error(t("integ.toastConnectFailed"))
      setConnecting(false)
    }
  }, [provider, onConnectionChange, openFieldsDialog, t])

  const handleDisconnect = useCallback(
    async (connectionId: string) => {
      setBusyConnectionId(connectionId)
      try {
        await disconnectSocial(connectionId)
        toast.success(t("integ.disconnectedFrom", { name: provider.label }))
        onConnectionChange()
      } catch (err) {
        // A 404 means the row is already gone (another tab, or a list rendered
        // before a refetch): that is the state the click asked for, so refresh
        // and report success rather than "Failed to disconnect" (#722).
        if (isNotFoundError(err)) {
          toast.success(t("integ.disconnectedFrom", { name: provider.label }))
          onConnectionChange()
          return
        }
        toast.error(t("integ.toastDisconnectFailed"))
      } finally {
        setBusyConnectionId(null)
      }
    },
    [provider.label, onConnectionChange, t],
  )

  const handleMakeDefault = useCallback(
    async (connectionId: string) => {
      setBusyConnectionId(connectionId)
      try {
        await setDefaultSocialConnection(connectionId)
        // Re-read rather than patch locally: setting one default CLEARS the
        // previous, so the row that changed is not only the one clicked.
        onConnectionChange()
      } catch {
        toast.error(t("integ.toastDefaultFailed"))
      } finally {
        setBusyConnectionId(null)
      }
    },
    [onConnectionChange, t],
  )

  const handleTelegramConnect = useCallback(async () => {
    setDialogError(null)
    setDialogBusy(true)
    try {
      await connectTelegram(botToken)
      toast.success(t("integ.toastConnectedTelegram"))
      setTelegramOpen(false)
      setBotToken("")
      onConnectionChange()
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("integ.failedConnectBot"))
    } finally {
      setDialogBusy(false)
    }
  }, [botToken, onConnectionChange, t])

  const handleFieldsConnect = useCallback(async () => {
    setDialogError(null)
    setDialogBusy(true)
    try {
      const trimmed: Record<string, string> = {}
      for (const [k, v] of Object.entries(fieldValues)) trimmed[k] = v.trim()
      const result = await connectSocialCustom(provider.id, trimmed)
      toast.success(
        result.username
          ? t("integ.connectedToAs", { name: provider.label, username: result.username })
          : t("integ.connectedTo", { name: provider.label }),
      )
      setFieldsOpen(false)
      onConnectionChange()
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("integ.connectionFailed"))
    } finally {
      setDialogBusy(false)
    }
  }, [provider.id, provider.label, fieldValues, onConnectionChange, t])

  const isConnected = connections.length > 0

  return (
    <div
      className="flex min-h-[176px] flex-col gap-3.5 rounded-[14px] border p-[18px]"
      style={{ borderColor: "var(--integ-line)", background: "var(--integ-surface)" }}
    >
      <div className="flex items-start gap-3">
        <BrandTile platformId={provider.id} label={provider.label} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[14.5px] font-bold tracking-[-0.01em]" style={{ color: "var(--integ-fg)" }}>
            {provider.label}
          </span>
          <span className="text-xs leading-[1.45] text-pretty" style={{ color: "var(--integ-muted)" }}>
            {describeProvider(provider, t)}
          </span>
        </div>
        <span
          className="ms-auto flex-none rounded-full px-2 py-[3px] text-[10.5px] font-bold"
          style={
            isConnected
              ? { background: "color-mix(in oklab, var(--integ-ok) 16%, transparent)", color: "var(--integ-ok)" }
              : { background: "var(--integ-raised)", color: "var(--integ-muted)" }
          }
        >
          {isConnected ? t("integ.connected") : t("integ.available")}
        </span>
      </div>

      {isConnected && (
        <div className="flex flex-col gap-1.5">
          {connections.map((conn) => (
            <AccountRow
              key={conn.id}
              connection={conn}
              networkLabel={provider.label}
              // Only meaningful with something to choose BETWEEN. One account
              // is already where everything goes, and a "Default" chip beside
              // it would be a control that does nothing.
              showsDefault={connections.length > 1}
              busy={busyConnectionId === conn.id}
              onMakeDefault={() => handleMakeDefault(conn.id)}
              onReconnect={handleConnect}
              onDisconnect={() => handleDisconnect(conn.id)}
            />
          ))}
        </div>
      )}

      {/* One action, at the bottom, in the same place on every card.
          The two artboards deliberately differ here and both are followed.
          On the light page Connect is near-black: that IS the handoff's
          headline change, twenty cards no longer all shouting in pink. The
          dark artboard paints the same button brand pink, because on a dark
          page a near-black button disappears and a near-white one is just
          the same shout in another colour — with no white competing for
          attention, the brand colour reads as "the action" rather than as
          noise. So dark mode here is unchanged from today; the light page is
          where the reduction lands. */}
      <div className="mt-auto pt-0.5">
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className={`flex h-[34px] w-full items-center justify-center gap-1.5 rounded-[10px] text-[12.5px] font-semibold transition-colors disabled:opacity-60 ${
            isConnected
              ? "border border-dashed hover:border-solid"
              : "bg-foreground font-bold text-background hover:opacity-90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
          }`}
          style={
            isConnected
              ? { borderColor: "var(--integ-line-dashed)", color: "var(--integ-muted)" }
              : undefined
          }
        >
          {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isConnected ? (
            <>
              <Plus className="h-3.5 w-3.5" />
              {t("integ.addAnother")}
            </>
          ) : (
            t("integ.connect")
          )}
        </button>
      </div>

      <TelegramConnectDialog
        open={telegramOpen}
        onOpenChange={(open) => {
          setTelegramOpen(open)
          if (!open) {
            setBotToken("")
            setDialogError(null)
          }
        }}
        token={botToken}
        onTokenChange={setBotToken}
        busy={dialogBusy}
        error={dialogError}
        onConnect={handleTelegramConnect}
      />

      <FieldsConnectDialog
        open={fieldsOpen}
        onOpenChange={(open) => {
          setFieldsOpen(open)
          if (!open) setDialogError(null)
        }}
        provider={provider}
        values={fieldValues}
        onValuesChange={setFieldValues}
        busy={dialogBusy}
        error={dialogError}
        onConnect={handleFieldsConnect}
      />
    </div>
  )
}
