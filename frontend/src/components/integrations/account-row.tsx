import { useState } from "react"
import { Loader2, MoreHorizontal, RefreshCw, Star, Unlink } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useT } from "@/lib/i18n"
import type { SocialConnection } from "@/types/nodes"

/**
 * One connected account inside a network card.
 *
 * The handoff folds the row's three actions into a `⋯` menu and replaces the
 * inline "session expired" sentence with a coloured health dot. Both survive
 * the move, with one deliberate addition: Disconnect now asks. It used to be
 * a distinct red icon you had to aim at; in a menu it sits one row below
 * "Make default", and a mis-click there severs an account with no undo.
 */
interface AccountRowProps {
  readonly connection: SocialConnection
  readonly networkLabel: string
  /** Default is only meaningful with something to choose between. */
  readonly showsDefault: boolean
  readonly busy: boolean
  readonly onMakeDefault: () => void
  readonly onReconnect: () => void
  readonly onDisconnect: () => void
}

export function AccountRow({
  connection,
  networkLabel,
  showsDefault,
  busy,
  onMakeDefault,
  onReconnect,
  onDisconnect,
}: AccountRowProps) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)

  // Meta page/business tokens don't self-heal — the publish worker flags the
  // row and the account keeps LOOKING connected until we say otherwise. Per
  // account, not per card: a card can hold several and only one may be dead.
  const needsReconnect = connection.reconnect_needed === true
  const isDefault = connection.is_default === true
  const name = connection.display_name || connection.platform_username || t("integ.connected")
  const initial = name.replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "?"

  return (
    <>
      <div
        className="flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2"
        style={{ borderColor: "var(--integ-line-soft)", background: "var(--integ-sunken)" }}
      >
        {connection.platform_avatar_url ? (
          <img src={connection.platform_avatar_url} alt="" className="h-[22px] w-[22px] shrink-0 rounded-full" />
        ) : (
          <div
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
            style={{ background: "var(--integ-raised)", color: "var(--integ-muted)" }}
            aria-hidden
          >
            {initial}
          </div>
        )}

        <span className="truncate font-mono text-xs" style={{ color: "var(--integ-fg)" }} title={name}>
          {name}
        </span>

        {/* The dot IS the status. Title carries the words for anyone who
            cannot use colour to tell the two apart. */}
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: needsReconnect ? "var(--integ-warn)" : "var(--integ-ok)" }}
          title={needsReconnect ? t("integ.sessionExpired") : t("integ.connected")}
          role="img"
          aria-label={needsReconnect ? t("integ.sessionExpired") : t("integ.connected")}
        />

        {showsDefault && isDefault && (
          <span className="shrink-0 text-[11px] font-semibold" style={{ color: "var(--integ-muted)" }}>
            {t("integ.defaultAccount")}
          </span>
        )}

        <div className="ms-auto shrink-0">
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--integ-muted)" }} />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-6 w-6 items-center justify-center rounded-md outline-none hover:bg-black/5 dark:hover:bg-white/10"
                aria-label={t("integ.accountActions", { account: name })}
              >
                <MoreHorizontal className="h-4 w-4" style={{ color: "var(--integ-muted)" }} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {needsReconnect && (
                  <DropdownMenuItem onSelect={onReconnect}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t("integ.reconnect")}
                  </DropdownMenuItem>
                )}
                {showsDefault && !isDefault && (
                  <DropdownMenuItem onSelect={onMakeDefault}>
                    <Star className="h-3.5 w-3.5" />
                    {t("integ.makeDefault")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setConfirming(true)}
                >
                  <Unlink className="h-3.5 w-3.5" />
                  {t("integ.disconnect")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <DeleteConfirmationDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          onDisconnect()
        }}
        title={t("integ.disconnectTitle", { account: name })}
        description={t("integ.disconnectDesc")}
        confirmLabel={t("integ.disconnect")}
      />
    </>
  )
}
